// Platform-only receipt retirement against real migrations in isolated PGlite. Auth/Storage/cron stubs only.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const denied=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),target='202611010022_guest_booking.sql';const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort();eq(files.length,21);
 for(const f of files)await db.exec((await isolatedMigrationSql(db,f,await readFile(new URL(f,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- TEST ONLY extension omitted'));
 const defs=async()=>Promise.all(['create_intervention(text,text,text,text,text,text,uuid)','create_intervention_once(uuid,text,text,text,text,text,text,uuid)','can_access_intervention(uuid)'].map(async f=>(await db.query('select pg_get_functiondef($1::regprocedure) v',['public.'+f])).rows[0].v));
 const before=await defs();await db.exec(await readFile(new URL(target,dir),'utf8'));eq(await defs(),before);
 await db.exec(await readFile(new URL('202611010023_pending_booking.sql',dir),'utf8'));await db.exec(await readFile(new URL('202611010024_guest_settlement.sql',dir),'utf8'));
 const attemptFunctionBefore=(await db.query("select pg_get_functiondef('public.record_payment_attempt()'::regprocedure) v")).rows[0].v;await db.exec(await readFile(new URL('202611010025_onsite_receipt.sql',dir),'utf8'));eq((await db.query("select pg_get_functiondef('public.record_payment_attempt()'::regprocedure) v")).rows[0].v,attemptFunctionBefore);

 await db.exec(await readFile(new URL('202611010026_invoice_settlement_total.sql',dir),'utf8'));
 await db.exec(await readFile(new URL('202611010027_accepted_quote_totals.sql',dir),'utf8'));
 const ids={a:randomUUID(),b:randomUUID(),artisan:randomUUID(),other:randomUUID(),admin:randomUUID()};
 for(const label of Object.keys(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[ids[label],JSON.stringify({role:['artisan','other'].includes(label)?'artisan':'client',full_name:'QA '+label}),label+'@example.invalid']);
 await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
 for(const id of[ids.artisan,ids.other]){await db.query('update public.profiles set artisan_approved=true where id=$1',[id]);await db.query("insert into public.artisan_profiles(user_id,application_status)values($1,'approved')on conflict(user_id)do update set application_status='approved'",[id]);}
 const as=async(label,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[label]||'']);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const asService=async(sql,args=[])=>{await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne synthétique QA plateforme uniquement',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune synthétique QA',urgency:'scheduled'},contact={first_name:'QA',last_name:'Essai',email:'',phone:'+596696000000'};
 const makeJob=async()=>{
  const nonce=randomUUID();const book=(await as('a','select public.create_on_site_booking($1,$2,$3) v',[nonce,JSON.stringify(payload),JSON.stringify(contact)])).rows[0].v;
  const job=book.intervention.id;await db.query("update public.interventions set artisan_id=$2,status='completed' where id=$1",[job,ids.artisan]);const quote=randomUUID();
  await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[quote,job,ids.artisan]);return{job,quote,nonce};
 };
 const get=async(label,job)=>(await as(label,'select public.onsite_receipt_context($1) v',[job])).rows[0].v;
 const old=await makeJob();const historical=(await as('artisan','select public.declare_onsite_receipt($1) v',[old.job])).rows[0].v;
 eq(historical.method,'on_site_declared');eq(historical.amount_cents,12000);
 const snapshotBefore=await scalar("select jsonb_build_object('receipt',(select to_jsonb(r)from public.on_site_receipts r where intervention_id=$1),'payment',(select to_jsonb(p)from public.payments p where quote_id=$2),'attempt',(select to_jsonb(a)from public.payment_attempts a where quote_id=$2)) v",[old.job,old.quote]);
 const pending=await makeJob();const migration=(await readdir(dir)).filter(n=>n.endsWith('_platform_only_payments.sql'));eq(migration.length,1);await db.exec(await readFile(new URL(migration[0],dir),'utf8'));
 eq(await get('a',old.job),historical);eq(await get('artisan',old.job),historical);
 eq(await scalar("select jsonb_build_object('receipt',(select to_jsonb(r)from public.on_site_receipts r where intervention_id=$1),'payment',(select to_jsonb(p)from public.payments p where quote_id=$2),'attempt',(select to_jsonb(a)from public.payment_attempts a where quote_id=$2)) v",[old.job,old.quote]),snapshotBefore);
 const due={method:'on_site',status:'due_on_site',amount_cents:12000,currency:'eur',can_declare:false,available:false,reason:'platform_only'};
 eq(await get('a',pending.job),due);eq(await get('artisan',pending.job),due);await denied(get('b',pending.job),'P0002');await denied(get('other',pending.job),'P0002');await denied(get('admin',pending.job),'42501');await denied(get('',pending.job),'42501');
 for(const name of ['anon','authenticated','service_role'])eq(await scalar("select has_function_privilege($1,'public.declare_onsite_receipt(uuid)','EXECUTE') v",[name]),false);
 for(const label of ['a','b','artisan','other','admin'])await denied(as(label,'select public.declare_onsite_receipt($1)',[pending.job]),'42501');
 await denied(asService('select public.declare_onsite_receipt($1)',[pending.job]),'42501');
 // Even a table owner cannot accidentally invoke the obsolete implementation.
 await denied(db.query('select public.declare_onsite_receipt($1)',[pending.job]),'42501');
 const insertReceipt="insert into public.on_site_receipts(intervention_id,quote_id,actor_id,amount_cents,amendments)values($1,$2,$3,12000,'[]')";
 await denied(asService(insertReceipt,[pending.job,pending.quote,ids.artisan]),'42501');await denied(db.query(insertReceipt,[pending.job,pending.quote,ids.artisan]),'42501');
 const insertPayment="insert into public.payments(quote_id,session_id,total_cents,currency,status,paid_at,method)values($1,$2,12000,'eur','paid',now(),'on_site_declared')";
 await denied(asService(insertPayment,[pending.quote,'onsite:'+pending.job]),'42501');await denied(db.query(insertPayment,[pending.quote,'onsite:'+pending.job]),'42501');
 // Attempt history cannot be forged independently of the payment table either.
 const insertAttempt="insert into public.payment_attempts(quote_id,session_id,total_cents,currency,status,paid_at,method)values($1,$2,12000,'eur','paid',now(),'on_site_declared')";
 await denied(asService(insertAttempt,[pending.quote,'onsite:'+pending.job]),'42501');
 await denied(db.query("update public.payments set total_cents=1 where quote_id=$1",[old.quote]),'P0001');
 await denied(db.query("update public.payment_attempts set method='stripe' where quote_id=$1",[old.quote]),'P0001');
 await denied(db.query("update public.payment_attempts set total_cents=1 where quote_id=$1",[old.quote]),'P0001');
 eq(await scalar('select count(*)::int v from public.on_site_receipts'),1);eq(await scalar('select count(*)::int v from public.payments'),1);eq(await scalar('select count(*)::int v from public.payment_attempts'),1);
 eq(await scalar('select status v from public.interventions where id=$1',[pending.job]),'completed');
 eq(await scalar("select count(*)::int v from public.audit_log where intervention_id=$1 and action='on_site_receipt_declared'",[pending.job]),0);
 eq(await scalar("select count(*)::int v from public.action_limits where actor_id=$1 and action='declare_onsite_receipt'",[ids.artisan]),1);
 // Retiring direct collection does not remove normal deferred booking or nonce replay.
 const book=await as('a','select public.create_on_site_booking($1,$2,$3) v',[pending.nonce,JSON.stringify(payload),JSON.stringify(contact)]);eq(book.rows[0].v.intervention.id,pending.job);eq(book.rows[0].v.payment.status,'due_on_site');
 const next=(await as('a','select public.create_on_site_booking($1,$2,$3) v',[randomUUID(),JSON.stringify(payload),JSON.stringify(contact)])).rows[0].v;eq(next.payment.status,'due_on_site');eq(next.intervention.status,'requested');
 await denied(as('a','select public.guard_phone_booking_checkout($1)',[pending.quote]),'P0001');
 // Ordinary Stripe provenance still works for trusted bank-provider recording.
 await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,'cs_test_ONLY_FIXTURE',12000,'eur','pending','stripe')",[pending.quote]);
 eq(await scalar('select method v from public.payment_attempts where quote_id=$1',[pending.quote]),'stripe');
 console.log(JSON.stringify({sql:'PASS',checks,migrations:28,scope:'new direct receipts denied; historical declarations unchanged; deferred Checkout guard still closed',runtime:'PGlite isolated only',cloud:false}));
}finally{await db.close()}
