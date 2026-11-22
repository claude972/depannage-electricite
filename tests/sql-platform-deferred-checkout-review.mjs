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
 const historical=await makeJob();await as('artisan','select public.declare_onsite_receipt($1)',[historical.job]);
 for(const suffix of ['_platform_only_payments.sql','_platform_deferred_checkout.sql']){const names=(await readdir(dir)).filter(n=>n.endsWith(suffix));eq(names.length,1);await db.exec(await readFile(new URL(names[0],dir),'utf8'));}
 await db.query("update public.profiles set stripe_account_id='acct_QARecipient' where id=$1",[ids.artisan]);
 const begin=async(label,quote)=>(await as(label,'select public.begin_platform_checkout($1) v',[quote])).rows[0].v;
 const privateRead=async(id,actor=ids.a)=>(await asService('select public.platform_checkout_private($1,$2) v',[id,actor])).rows[0].v;
 const qualify=async(id,fee=2000,origin='https://preview.example.test')=>asService('select public.qualify_platform_checkout($1,$2,$3,$4,$5)',[id,ids.a,'acct_QARecipient',fee,origin]);
 const bind=async(id,session,amount,expires=null)=>{const l=await privateRead(id);return asService('select public.bind_platform_checkout($1,$2,$3,$4,$5,$6)',[id,ids.a,session,amount,'eur',expires||new Date(Date.parse(l.created_at)+24*3600000).toISOString()]);};
 const reconcile=async(id,session,state)=>asService('select public.reconcile_platform_checkout($1,$2,$3,$4)',[id,ids.a,session,state]);
 const event=async(paid,job,session,amount,eventId=randomUUID())=>asService(`select public.${paid?'confirm_stripe_payment':'record_stripe_payment_failure'}($1,$2,$3,$4,$5,$6) v`,[eventId,paid?'checkout.session.completed':'checkout.session.expired',session,job.quote,amount,'eur']);
 const addAmendment=async(job,amount=3000)=>{const id=randomUUID();await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,1,'QA supplémentaire','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":2500}]',2500,20,500,$5,'accepted')",[id,job.job,job.quote,ids.artisan,amount]);return id;};
 await denied(begin('a',historical.quote),'P0001');
 const j=await makeJob();const amendment=await addAmendment(j);
 for(const who of ['b','artisan','other','admin'])await denied(begin(who,j.quote),'P0002');await denied(begin('',j.quote),'42501');
 await as('a','select public.guard_phone_booking_checkout($1)',[j.quote]);
 const id=await begin('a',j.quote);eq(await begin('a',j.quote),id);const l=await privateRead(id);eq(l.amount_cents,15000);eq(l.amendments.length,1);eq(l.amendments[0].id,amendment);eq(l.account_id,'acct_QARecipient');eq(l.status,'preparing');
 await denied(as('a','select public.platform_checkout_private($1,$2)',[id,ids.a]),'42501');await denied(asService('select public.platform_checkout_private($1,$2)',[id,ids.b]),'P0002');
 for(const table of ['quotes','quote_amendments']){const key=table==='quotes'?j.quote:amendment;await denied(db.query(`update public.${table} set total_cents=total_cents+1 where id=$1`,[key]),'P0001');}
 await denied(db.query('update public.interventions set artisan_id=$2 where id=$1',[j.job,ids.other]),'P0001');
 await denied(db.query("update public.profiles set stripe_account_id='acct_CHANGED' where id=$1",[ids.artisan]),'P0001');
 await denied(addAmendment(j),'P0001');await denied(qualify(id,10000),'42501');await denied(qualify(id,2000,'javascript:alert(1)'),'42501');
 await qualify(id);eq((await privateRead(id)).fee_cents,3000);eq((await privateRead(id)).return_origin,'https://preview.example.test');await denied(qualify(id,1000),'P0001');await denied(qualify(id,2000,'https://different.example.test'),'P0001');
 await denied(bind(id,'cs_test_QAPlatform',12000),'P0001');eq(await scalar('select count(*)::int v from public.payments where quote_id=$1',[j.quote]),0);
 await bind(id,'cs_test_QAPlatform',15000);await bind(id,'cs_test_QAPlatform',15000);
 eq((await privateRead(id)).status,'open');eq(await scalar('select total_cents v from public.payments where quote_id=$1',[j.quote]),15000);eq(await scalar('select total_cents v from public.payment_attempts where quote_id=$1',[j.quote]),15000);
 await denied(asService('select public.assert_platform_checkout_event($1,$2,$3,$4)',[id,j.quote,'cs_FOREIGN',15000]),'42501');
 await denied(event(true,j,'cs_test_QAPlatform',12000),'P0001');eq(await scalar("select count(*)::int v from public.stripe_events"),0);eq(await scalar('select status v from public.interventions where id=$1',[j.job]),'completed');
 const ev=randomUUID();eq((await event(true,j,'cs_test_QAPlatform',15000,ev)).rows[0].v,true);eq((await event(true,j,'cs_test_QAPlatform',15000,ev)).rows[0].v,false);eq((await event(true,j,'cs_test_QAPlatform',15000)).rows[0].v,false);
 eq((await privateRead(id)).status,'paid');eq(await scalar('select status v from public.interventions where id=$1',[j.job]),'paid');eq((await event(false,j,'cs_test_QAPlatform',15000)).rows[0].v,false);eq(await scalar('select status v from public.payments where quote_id=$1',[j.quote]),'paid');
 eq(await scalar("select count(*)::int v from public.audit_log where intervention_id=$1 and action='payment_confirmed'",[j.job]),1);await denied(begin('a',j.quote),'P0001');
 // Expiry releases a new snapshot; a late event for the old attempt never mutates it.
 const retry=await makeJob();const r1=await begin('a',retry.quote);await qualify(r1);await bind(r1,'cs_test_RetryOld',12000);
 await denied(event(false,retry,'cs_test_RetryOld',1),'P0001');eq((await event(false,retry,'cs_test_RetryOld',12000)).rows[0].v,true);eq((await privateRead(r1)).status,'expired');
 await addAmendment(retry);const r2=await begin('a',retry.quote);assert.notEqual(r1,r2);checks++;eq((await privateRead(r2)).amount_cents,15000);await qualify(r2);await bind(r2,'cs_test_RetryNew',15000);
 eq((await event(false,retry,'cs_test_RetryOld',12000)).rows[0].v,false);eq(await scalar('select session_id v from public.payments where quote_id=$1',[retry.quote]),'cs_test_RetryNew');eq(await scalar('select status v from public.payments where quote_id=$1',[retry.quote]),'pending');
 await denied(event(true,retry,'cs_test_RetryOld',12000),'P0001');
 await reconcile(r2,'cs_test_RetryNew','awaiting_bank');eq((await privateRead(r2)).status,'awaiting_bank');eq(await begin('a',retry.quote),r2);
 // Unknown creation response past idempotency retention is never silently retried.
 const unknown=await makeJob();const u=await begin('a',unknown.quote);await reconcile(u,null,'needs_review');eq((await privateRead(u)).status,'needs_review');eq(await begin('a',unknown.quote),u);await denied(qualify(u),'42501');
 // Requiring completed work is a server invariant, not a UI-only restriction.
 const unfinished=await makeJob();await db.query("update public.interventions set status='in_progress' where id=$1",[unfinished.job]);await denied(begin('a',unfinished.quote),'P0001');

 // A stale requester ID is not enough after site write access or membership
 // is removed. This executes the real authenticated RPC, not just a UI predicate.
 await db.query("update public.interventions set status='completed' where id=$1",[unfinished.job]);
 const org=(await db.query("insert into public.organizations(name,owner_id)values('QA organization',$1)returning id",[ids.b])).rows[0].id;
 await db.query("insert into public.organization_members(organization_id,user_id,role)values($1,$2,'manager')",[org,ids.a]);
 const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','Fixture address',10000)returning id",[org])).rows[0].id;
 await db.query('update public.interventions set site_id=$2 where id=$1',[unfinished.job,site]);
 await as('a','select public.guard_phone_booking_checkout($1)',[unfinished.quote]);
 await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.a]);
 await denied(begin('a',unfinished.quote),'P0002');await denied(as('a','select public.guard_phone_booking_checkout($1)',[unfinished.quote]),'P0002');
 await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.a]);
 await denied(begin('a',unfinished.quote),'P0002');
 await db.query('update public.interventions set site_id=null where id=$1',[unfinished.job]);
 // Legacy/non-booking sessions must include accepted amendments too: base-only
 // paid/failure events are rejected by the real SQL writers, not only the route.
 await db.query("update public.interventions set status='completed' where id=$1",[unfinished.job]);
 await db.query('delete from public.phone_booking_requests where intervention_id=$1',[unfinished.job]);await addAmendment(unfinished);
 await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,'cs_test_LegacyAmended',15000,'eur','pending','stripe')",[unfinished.quote]);
 await denied(event(true,unfinished,'cs_test_LegacyAmended',12000),'P0001');await denied(event(false,unfinished,'cs_test_LegacyAmended',12000),'P0001');
 eq(await scalar('select status v from public.payments where quote_id=$1',[unfinished.quote]),'pending');
 eq((await event(true,unfinished,'cs_test_LegacyAmended',15000)).rows[0].v,true);
 for(const name of ['anon','authenticated'])eq(await scalar("select has_table_privilege($1,'public.platform_checkouts','SELECT') v",[name]),false);
 console.log(JSON.stringify({sql:'PASS',checks,migrations:'001–027 + platform-only + deferred checkout',scope:'base+amendments immutable, provider refs, event replay, expiry, privacy',runtime:'PGlite0.5.13',cloud:false,realProvider:false,realConcurrentSessions:false}));
}finally{await db.close()}
