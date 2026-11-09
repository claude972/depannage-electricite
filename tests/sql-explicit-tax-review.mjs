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
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
async function apply(file){await db.exec((await isolatedMigrationSql(db,file,await readFile(new URL(file,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- extension simulated'));}
for(const file of files.filter(n=>!n.includes('explicit_tax_rates')))await apply(file);
const ids={client:'10000000-0000-4000-8000-000000000001',artisan:'10000000-0000-4000-8000-000000000002',foreign:'10000000-0000-4000-8000-000000000003'};
for(const[n,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:n==='artisan'?'artisan':'client',full_name:'QA '+n}),n+'@example.invalid']);
await db.query('update public.profiles set artisan_approved=true where id=$1',[ids.artisan]);await db.query("insert into public.artisan_profiles(user_id,application_status,company_name,siret,address)values($1,'approved','QA artisan','12345678901234','QA adresse synthétique')",[ids.artisan]);
let checks=0;function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
async function as(who,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function job(){return(await db.query("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,report_evidence_required)values($1,$2,'socket','QA panne synthétique','QA adresse fixture','97200','QA ville','scheduled','assigned',10000,20000,false)returning id",[ids.client,ids.artisan])).rows[0].id;}
const legacy=await job();await db.query("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA historique\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[legacy,ids.artisan]);
const before=(await db.query('select row_to_json(q) v from public.quotes q where intervention_id=$1',[legacy])).rows[0].v;
const oldQuote=(await db.query('select id from public.quotes where intervention_id=$1',[legacy])).rows[0].id;const oldDoc=(await as('client','select public.generate_quote_document($1)v',[oldQuote])).rows[0].v.document.id;const oldDocBefore=(await db.query('select row_to_json(d)v from public.quote_documents d where id=$1',[oldDoc])).rows[0].v;
const grants=(await db.query("select oid,proacl::text acl from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
await apply(files.find(n=>n.includes('explicit_tax_rates')));
ok(JSON.stringify(before)===JSON.stringify((await db.query('select row_to_json(q) v from public.quotes q where intervention_id=$1',[legacy])).rows[0].v),'historical20 row unchanged');
ok(JSON.stringify(oldDocBefore)===JSON.stringify((await db.query('select row_to_json(d)v from public.quote_documents d where id=$1',[oldDoc])).rows[0].v),'historical document snapshot/hash unchanged');
ok(JSON.stringify(grants)===JSON.stringify((await db.query("select oid,proacl::text acl from pg_proc where pronamespace='public'::regnamespace order by oid")).rows),'all function grants/OIDs unchanged');
ok((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname like 'intervention_action%' and pg_get_function_arguments(oid)like '%DEFAULT 20%'")).rows[0].n===0,'no implicit20 in public/privatechain');
const lines=[{label:'QA taux explicite',quantity:1,unit_price_cents:101}];
for(const rate of [2.1,8.5]){const id=await job();await denied(()=>as('artisan',"select public.intervention_action($1,'send_quote',$2)",[id,lines]),'22023');await denied(()=>as('artisan',"select public.intervention_action($1,'send_quote',$2,7)",[id,lines]),'22023');
await as('artisan',"select public.intervention_action($1,'send_quote',$2,$3)",[id,lines,rate]);const q=(await as('client','select *from public.quotes where intervention_id=$1',[id])).rows[0];ok(Number(q.tax_rate)===rate&&q.tax_cents===Math.round(101*rate/100)&&q.total_cents===101+q.tax_cents,'SQL quote exactcents '+rate);
await denied(()=>as('foreign',"select public.intervention_action($1,'accept_quote',null,null,$2)",[id,q.id]),'42501');await as('client',"select public.intervention_action($1,'accept_quote',p_quote_id=>$2)",[id,q.id]);
const a=(await as('artisan','select public.propose_quote_amendment($1,$2,$3,$4) v',[q.id,lines,rate,'QA supplément explicite'])).rows[0].v;ok(Number(a.tax_rate)===rate&&a.tax_cents===q.tax_cents,'amendment same explicitrate');
await as('client',"select public.decide_quote_amendment($1,'accepted','')",[a.id]);const doc=(await as('client','select public.generate_quote_document($1,$2)v',[q.id,a.id])).rows[0].v;const snap=(await db.query('select snapshot from public.quote_documents where id=$1',[doc.document.id])).rows[0].snapshot;ok(Number(snap.quote.tax_rate)===rate&&Number(snap.amendment.tax_rate)===rate,'persisted immutable document carries both rates');await as('artisan',"select public.intervention_action($1,'start')",[id]);await as('artisan',"select public.intervention_action($1,'complete')",[id]);ok((await db.query('select status from public.interventions where id=$1',[id])).rows[0].status==='completed','non-taxactions omittedrate work');
await db.query('select public.validate_quote_draft_content($1,$2)',[lines,rate]);checks++;
}
const draftId=await job();await db.query("insert into public.quote_drafts(intervention_id,artisan_id,version,state,assignment_token,tax_rate)values($1,$2,1,'draft',repeat('a',64),null)",[draftId,ids.artisan]);for(const r of[2.1,8.5]){await db.query('update public.quote_drafts set tax_rate=$1 where intervention_id=$2',[r,draftId]);checks++;}await denied(()=>db.query('update public.quote_drafts set tax_rate=7 where intervention_id=$1',[draftId]),'23514');await db.query('select public.validate_quote_draft_content($1,null)',[[]]);checks++;await denied(()=>db.query('select public.validate_quote_draft_content($1,7)',[lines]),'22023');
for(const rate of [null,0,2.1,5.5,8.5,10,20]){await db.query('select public.platform_validate_issuer($1)',[{legal_name:'QA plateforme',siret:'12345678901234',address:'QA adresse fixture',vat_number:null,commission_vat_rate:rate}]);checks++;}
await denied(()=>db.query('select public.platform_validate_issuer($1)',[{legal_name:'QA plateforme',siret:'12345678901234',address:'QA adresse fixture',vat_number:null,commission_vat_rate:7}]),'22023');
for(const table of ['quotes','quote_drafts','quote_amendments','platform_invoices']){const d=(await db.query("select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='tax_rate'where c.conrelid=$1::regclass and c.conkey=array[a.attnum]::smallint[]",['public.'+table])).rows[0].d;ok(d.includes('2.1')&&d.includes('8.5'),'all monetarychecks widened '+table);}
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite0.5.13',auth_storage_cron:'SIMULATED',cloud_provider_concurrency_proof:false,history_unchanged:true}));await db.close();
