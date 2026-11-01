// Pending recovery, actual migrations001–023 in isolated PGlite. Auth/Storage/cron stubs only.
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
 await db.exec(await readFile(new URL('202611010023_pending_booking.sql',dir),'utf8'));
 const immutable=async()=>(await db.query("select pg_get_functiondef('public.confirm_stripe_payment(text,text,text,uuid,integer,text)'::regprocedure) v")).rows[0].v;const original=await immutable();
 await db.exec(await readFile(new URL('202611010024_guest_settlement.sql',dir),'utf8'));eq(await immutable(),original);
 const ids={a:randomUUID(),b:randomUUID(),artisan:randomUUID()};for(const label of Object.keys(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[ids[label],JSON.stringify({role:label==='artisan'?'artisan':'client',full_name:'QA '+label}),label+'@example.invalid']);
 await db.query("update public.profiles set artisan_approved=true,stripe_account_id='acct_QArecipient' where id=$1",[ids.artisan]);
 const as=async(label,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[label]||'']);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const service=async(sql,args=[])=>{await db.exec('set role service_role');try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const nonce=randomUUID(),payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne synthétique QA règlement final',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune synthétique QA',urgency:'scheduled'},contact={first_name:'QA',last_name:'Essai',email:'',phone:'+596696000000'};
 await as('a','select public.prepare_phone_booking($1,$2,$3,$4)',[nonce,JSON.stringify(payload),JSON.stringify(contact),'card_hold']);
 const record='select public.record_phone_booking_provider($1,$2,$3,$4,$5,$6,$7,$8)';await service(record,[ids.a,nonce,'cs_test_QAsettle','pi_QAsettle','session',null,null,null]);await service(record,[ids.a,nonce,'cs_test_QAsettle','pi_QAsettle','authorize',18000,'eur','requires_capture']);
 const job=(await as('a','select public.submit_phone_booking($1) v',[nonce])).rows[0].v.intervention.id;await db.query("update public.interventions set status='completed',artisan_id=$2 where id=$1",[job,ids.artisan]);
 const q=randomUUID();await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at) values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted',now())",[q,job,ids.artisan]);
 const am=randomUUID();for(const[version,status,amount]of[[1,'accepted',3000],[2,'rejected',6000],[3,'proposed',9000]])await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,$5,'QA synthétique','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":2500}]',$6,0,0,$6,$7)",[version===1?am:randomUUID(),job,q,ids.artisan,version,amount,status]);
 const get=async label=>(await as(label,'select public.guest_settlement_status($1) v',[job])).rows[0].v;
 const status=await get('a');eq(status.status,'not_started');eq(status.amount_cents,15000);eq(status.available,true);eq(Object.keys(status).sort(),['method','status','amount_cents','currency','available','reason'].sort());
 await denied(get('b'),'P0002');await denied(get('artisan'),'42501');await denied(get(''),'42501');
 // Above hold is refused BEFORE intent, no arbitrary partial capture amount.
 await db.query('update public.quote_amendments set total_cents=7000 where id=$1',[am]);eq((await get('a')).reason,'quote_exceeds_hold');await denied(as('a','select public.begin_guest_settlement($1)',[job]),'P0001');eq(await scalar('select count(*)::int v from public.guest_settlements'),0);await db.query('update public.quote_amendments set total_cents=3000 where id=$1',[am]);
 const ledger=(await as('a','select public.begin_guest_settlement($1) v',[job])).rows[0].v;eq((await as('a','select public.begin_guest_settlement($1) v',[job])).rows[0].v,ledger);eq(await scalar("select count v from public.action_limits where actor_id=$1 and action='guest_settlement'",[ids.a]),1);
 const l=await scalar('select to_jsonb(s) v from public.guest_settlements s where id=$1',[ledger]);eq(l.amount_cents,15000);eq(l.amendments,[{id:am,version:1,total_cents:3000}]);
 for(const role of ['public','anon','authenticated'])eq(await scalar("select has_table_privilege($1,'public.guest_settlements','SELECT') v",[role]),false);
 await denied(as('a','select public.qualify_guest_settlement($1,$2,$3,$4)',[ledger,ids.a,'acct_QArecipient',2000]),'42501');
 await denied(service('select public.qualify_guest_settlement($1,$2,$3,$4)',[ledger,ids.a,'acct_QArecipient',10000]),'22023');await service('select public.qualify_guest_settlement($1,$2,$3,$4)',[ledger,ids.a,'acct_QArecipient',2000]);
 eq(await scalar('select transfer_cents v from public.guest_settlements where id=$1',[ledger]),12000);
 await denied(db.query('update public.quotes set total_cents=13000 where id=$1',[q]),'P0001');await denied(db.query('update public.quote_amendments set total_cents=3500 where id=$1',[am]),'P0001');await denied(db.query("update public.quote_amendments set status='accepted' where base_quote_id=$1 and status='proposed'",[q]),'P0001');await denied(db.query('update public.interventions set artisan_id=$2 where id=$1',[job,ids.b]),'P0001');await denied(db.query("update public.profiles set stripe_account_id='acct_OTHER' where id=$1",[ids.artisan]),'P0001');
 const paid='select public.record_guest_settlement($1,$2,$3,$4,$5,$6,$7)';await denied(as('a',paid,[ledger,ids.a,'ch_QAcharge',15000,null,null,null]),'42501');await denied(service(paid,[ledger,ids.a,'ch_QAcharge',12000,null,null,null]),'42501');await service(paid,[ledger,ids.a,'ch_QAcharge',15000,null,null,null]);
 eq((await get('a')).status,'captured_transfer_pending');eq(await scalar('select status v from public.interventions where id=$1',[job]),'completed');eq(await scalar('select count(*)::int v from public.payments'),0);
 await denied(db.query('update public.guest_settlements set amount_cents=14000 where id=$1',[ledger]),'P0001');await denied(db.query('update public.guest_settlements set transfer_started_at=now() where id=$1',[ledger]),'P0001');
 await db.exec(`create function public.qa_settlement_abort() returns trigger language plpgsql as $$begin raise exception 'QA atomic rollback' using errcode='55000';end;$$;create trigger qa_settlement_abort before update on public.interventions for each row when(new.status='paid') execute function public.qa_settlement_abort();`);
 await denied(service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_QAtransfer',12000,'acct_QArecipient']),'55000');eq(await scalar('select count(*)::int v from public.payments'),0);eq(await scalar('select count(*)::int v from public.payment_attempts'),0);eq((await get('a')).status,'captured_transfer_pending');await db.exec('drop trigger qa_settlement_abort on public.interventions;drop function public.qa_settlement_abort()');
 await denied(service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_QAtransfer',11999,'acct_QArecipient']),'42501');await service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_QAtransfer',12000,'acct_QArecipient']);await service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_QAtransfer',12000,'acct_QArecipient']);
 await service(paid,[ledger,ids.a,'ch_QAcharge',15000,null,null,null]);await denied(service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_OTHER',12000,'acct_QArecipient']),'42501');await denied(service(paid,[ledger,ids.a,'ch_QAcharge',15000,'tr_QAtransfer',11999,'acct_QArecipient']),'42501');
 eq((await get('a')).status,'paid');eq(await scalar('select status v from public.interventions where id=$1',[job]),'paid');eq(await scalar('select total_cents v from public.payments where quote_id=$1',[q]),15000);eq(await scalar('select total_cents v from public.payment_attempts where quote_id=$1',[q]),15000);eq(await scalar("select count(*)::int v from public.audit_log where intervention_id=$1 and action='payment_confirmed'",[job]),1);
 // Structural lock-order assertion, NOT a multi-connection concurrency proof.
 for(const f of ['qualify_guest_settlement(uuid,uuid,text,integer)','record_guest_settlement(uuid,uuid,text,integer,text,integer,text)']){const definition=await scalar('select pg_get_functiondef($1::regprocedure) v',['public.'+f]);eq(definition.indexOf('where id=job for update')<definition.indexOf('and intervention_id=job for update'),true)}
 console.log(JSON.stringify({sql:'PASS',checks,migrations:24,runtime:'PGlite0.5.4',provider:'INJECTED PROOF ONLY',real_capture_or_transfer:false}));
}finally{await db.close()}
