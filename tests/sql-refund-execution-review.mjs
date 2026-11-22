import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// Explicit-tax SQL execution. Auth/Storage/cron are simulated, never cloud evidence.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
// Every fixture below is synthetic QA data: no real site, rate, delay, calendar or regulation.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
async function apply(file){await db.exec((await isolatedMigrationSql(db,file,await readFile(new URL(file,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- extension simulated'));}
// Seed the historical refund before installing the execution tables and their MFA guard.
const executionMigrations = files.filter(name => /_(refund_execution|refund_preparation_handoff|platform_mfa)\.sql$/.test(name));
for (const file of files.filter(name => !executionMigrations.includes(name))) await apply(file);
const ids={admin:'10000000-0000-4000-8000-000000000001',operator:'10000000-0000-4000-8000-000000000002',client:'10000000-0000-4000-8000-000000000003',artisan:'10000000-0000-4000-8000-000000000004'};let checks=0;
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
for(const[n,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:n==='artisan'?'artisan':'client',full_name:'QA '+n}),n+'@example.invalid']);await db.query("update public.profiles set role='admin'where id=$1",[ids.admin]);
await db.query("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,'finance_write',$2),($1,'finance_read',$2)",[ids.operator,ids.admin]);
async function as(actor,sql,args=[]){await db.exec('set role '+(actor==='service'?'service_role':'authenticated'));await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[actor]||'',JSON.stringify({aal:actor==='admin'||actor==='operator'?'aal2':'aal1'})]);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA org',$1)returning id",[ids.client])).rows[0].id;await db.query("insert into public.organization_members values($1,$2,'owner')",[org,ids.client]);const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA adresse fixture',100000)returning id",[org])).rows[0].id;
async function fixture(siteId=site){const job=(await db.query("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,$3,'panel','QA panne synthétique','QA adresse fixture','97200','QA ville','scheduled','completed',10000,20000)returning id",[ids.client,ids.artisan,siteId])).rows[0].id;
const quote=(await db.query("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA prestation\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')returning id",[job,ids.artisan])).rows[0].id;
const session='cs_test_QA'+crypto.randomUUID().replaceAll('-',''),checkout=crypto.randomUUID();await db.query("insert into public.platform_checkouts(id,quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)values($1,$2,$3,$4,$5,12000,'[]','acct_QA','https://app.example',2000,2400,'open',$6,clock_timestamp()+interval'1hour')",[checkout,quote,job,ids.client,ids.artisan,session]);
await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,12000,'eur','pending','stripe')",[quote,session]);await as('service','select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)',['evt_QA'+crypto.randomUUID().replaceAll('-',''),'checkout.session.completed',session,quote,12000,'eur']);return{job,quote,session,checkout,payment:(await db.query('select id from public.payments where quote_id=$1',[quote])).rows[0].id};}
const legacy=await fixture(null);const legacyRefund=(await as('admin','select public.platform_request_refund($1,$2,1000,$3)v',[crypto.randomUUID(),legacy.payment,'QA historique réel dans SQL isolé'])).rows[0].v.request;await as('admin',"select public.platform_decide_refund($1,'approve',1,'QA')",[legacyRefund.id]);await as('service',"select public.platform_settle_refund($1,'evt_legacy','refund.updated',$2,'re_legacy','succeeded',1000,'eur')",[legacyRefund.id,legacy.session]);const historical=(await db.query('select row_to_json(r)v from public.platform_refund_requests r where id=$1',[legacyRefund.id])).rows[0].v;
for (const file of executionMigrations) await apply(file);
ok(JSON.stringify(historical)===JSON.stringify((await db.query('select row_to_json(r)v from public.platform_refund_requests r where id=$1',[legacyRefund.id])).rows[0].v),'historical settled refund unchanged');
const f=await fixture();
async function request(amount=3000){const r=(await as('admin','select public.platform_request_refund($1,$2,$3,$4)v',[crypto.randomUUID(),f.payment,amount,'QA motif remboursement synthétique'])).rows[0].v.request;await as('admin',"select public.platform_decide_refund($1,'approve',1,'QA')",[r.id]);return r.id;}
const legacyUnbound=await fixture(null);await db.query('delete from public.platform_checkouts where id=$1',[legacyUnbound.checkout]);const unboundRequest=(await as('admin','select public.platform_request_refund($1,$2,1000,$3)v',[crypto.randomUUID(),legacyUnbound.payment,'QA historique sans snapshot'])).rows[0].v.request;await as('admin',"select public.platform_decide_refund($1,'approve',1,'QA')",[unboundRequest.id]);const availability=(await as('admin','select public.read_refund_execution($1)v',[unboundRequest.id])).rows[0].v;ok(!availability.eligible&&availability.reason==='legacy_binding_missing','perrequest GET refuses missing historical binding');ok((await as('admin','select public.refund_execution_capability()v')).rows[0].v===true,'installed capability checks current role');await denied(()=>as('client','select public.read_refund_execution($1)',[unboundRequest.id]),'42501');
const r=await request(),cmd=crypto.randomUUID();await denied(()=>as('client','select public.begin_refund_execution($1,$2,2)',[r,cmd]),'42501');await denied(()=>as('operator','select public.begin_refund_execution($1,$2,1)',[r,cmd]),'P0001');
await as('operator','select public.begin_refund_execution($1,$2,2)',[r,cmd]);ok((await as('admin','select public.read_refund_execution($1)v',[r])).rows[0].v.reason==='operator_mismatch','globalwritecap does not authorize another operator execution');await as('operator','select public.begin_refund_execution($1,$2,2)',[r,cmd]);ok((await db.query('select count(*)::int n from public.platform_refund_executions')).rows[0].n===1,'exact replay no duplicate');await denied(()=>as('operator','select public.begin_refund_execution($1,$2,2)',[r,crypto.randomUUID()]),'P0001');
await denied(()=>as('admin',"select public.platform_decide_refund($1,'cancel',2,'QA')",[r]),'P0001');await denied(()=>as('operator','select public.authorize_refund_execution($1)',[cmd]),'P0001');
const policy={version:'qa-v1',reverse_transfer:true,refund_application_fee:false,livemode:false};
await denied(()=>as('operator','select public.qualify_refund_execution($1,$2,$3,$4,$5)',[cmd,ids.operator,policy,'ch_QA','pi_QA']),'42501');
await as('service','select public.qualify_refund_execution($1,$2,$3,$4,$5)',[cmd,ids.operator,policy,'ch_QA','pi_QA']);await denied(()=>as('service','select public.qualify_refund_execution($1,$2,$3,$4,$5)',[cmd,ids.operator,{...policy,reverse_transfer:false},'ch_QA','pi_QA']),'P0001');
await as('operator','select public.authorize_refund_execution($1)',[cmd]);ok((await db.query('select state from public.platform_refund_executions where id=$1',[cmd])).rows[0].state==='unknown','uncertainty durable BEFORE provider');
await as('service','select public.bind_refund_execution($1,$2,$3,$4)',[cmd,ids.operator,'re_QA','submitted']);ok((await db.query('select status from public.platform_refund_requests where id=$1',[r])).rows[0].status==='approved','HTTP binding never settled');
const event=async(id,state='succeeded',amount=3000,ref='re_QA',execution=cmd)=>as('service','select public.apply_refund_execution_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)v',[execution,id,'refund.updated',ref,'ch_QA','pi_QA',amount,'eur',state,false]);
await denied(()=>event('evt_bad','succeeded',3001),'P0001');ok((await db.query("select count(*)::int n from public.stripe_events where id='evt_bad'")).rows[0].n===0,'mismatch event not consumed');
await event('evt_pending','pending');ok((await db.query('select status from public.platform_refund_requests where id=$1',[r])).rows[0].status==='approved','pending no settlement');
await event('evt_success');await event('evt_success');await event('evt_duplicate_object');ok((await db.query("select count(*)::int n from public.platform_ledger_entries where entry_kind='refund_settled'and payment_id=$1",[f.payment])).rows[0].n===1,'same refund across distinct eventIDs one ledger');
ok((await db.query('select status from public.platform_refund_requests where id=$1',[r])).rows[0].status==='settled','qualified webhook only settles');
// Second partial approved request, webhook before HTTP bind, terminal failure and no new autoattempt.
const r2=await request(2000),cmd2=crypto.randomUUID();await as('operator','select public.begin_refund_execution($1,$2,2)',[r2,cmd2]);await as('service','select public.qualify_refund_execution($1,$2,$3,$4,$5)',[cmd2,ids.operator,policy,'ch_QA','pi_QA']);await as('operator','select public.authorize_refund_execution($1)',[cmd2]);await event('evt_second','succeeded',2000,'re_QA2',cmd2);
ok((await db.query("select sum(amount_cents)::int n from public.platform_ledger_entries where entry_kind='refund_settled'and payment_id=$1",[f.payment])).rows[0].n===5000,'two partial refunds not aggregatedcharge');
await denied(()=>request(8000),'P0001');
const report=(await as('client','select *from public.professional_report($1,$2)',[site,org])).rows[0];ok(Number(report.refunded_cents)===5000&&Number(report.net_paid_cents)===7000,'existing report reflects qualified partial refunds');
await denied(()=>event('evt_second','succeeded',3000,'re_QA',cmd),'P0001');
// Current confirmed failure after success is quarantined, immutable ledger not rewritten.
await event('evt_conflict','failed');ok((await db.query('select state from public.platform_refund_executions where id=$1',[cmd])).rows[0].state==='needs_review','terminal contradiction explicit');ok((await db.query("select sum(amount_cents)::int n from public.platform_ledger_entries where entry_kind='refund_settled'and payment_id=$1",[f.payment])).rows[0].n===5000,'history immutable');
await denied(()=>as('client','select *from public.professional_report($1,$2)',[site,org]),'P0003');
const r3=await request(1000);await denied(()=>as('operator','select public.begin_refund_execution($1,$2,2)',[r3,crypto.randomUUID()]),'P0001');
await db.query("update public.platform_operator_grants set status='revoked',revoked_by=$1,revoked_at=now()where user_id=$2 and scope='finance_write'",[ids.admin,ids.operator]);await denied(()=>as('service','select public.refund_execution_private($1,$2)',[cmd2,ids.operator]),'42501');await denied(()=>as('operator','select public.begin_refund_execution($1,$2,2)',[r2,cmd2]),'42501');
ok((await as('operator','select public.refund_execution_capability()v')).rows[0].v===false,'capability revocation current');ok((await as('operator','select public.read_refund_execution($1)v',[r2])).rows[0].v.reason==='read_only','requestGET readonly afterrevocation');
for(const role of ['anon','authenticated']){ok((await db.query("select has_table_privilege($1,'public.platform_refund_executions','SELECT')v",[role])).rows[0].v===false,'no direct private ledger reader');ok((await db.query("select has_function_privilege($1,'public.platform_settle_refund_before_execution(uuid,text,text,text,text,text,integer,text)','EXECUTE')v",[role])).rows[0].v===false,'private historical writer closed');}
ok((await db.query("select has_function_privilege('anon','public.professional_report(uuid,uuid)','EXECUTE')v")).rows[0].v===false,'report wrapper not PUBLIC');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite0.5.13',auth_storage_cron:'SIMULATED',provider_events:'SYNTHETIC_SQL_QA',cloud_provider_concurrency_proof:false}));await db.close();
