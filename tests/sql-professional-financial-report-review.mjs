import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ENT-04 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const executionMigration=files.find(n=>n.endsWith('_refund_execution.sql'));assert.ok(executionMigration,'reviewed refundexecution migration required');
for(const file of files.filter(n=>n<'20261107000000'))await apply(file);
let checks=0;const ids={owner:'10000000-0000-4000-8000-000000000001',reader:'10000000-0000-4000-8000-000000000002',outside:'10000000-0000-4000-8000-000000000003',artisan:'10000000-0000-4000-8000-000000000004',admin:'10000000-0000-4000-8000-000000000005',stranger:'10000000-0000-4000-8000-000000000006'};
for(const[name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:name==='artisan'?'artisan':'manager',full_name:'QA '+name}),name+'@example.invalid']);await db.query("update public.profiles set role='admin'where id=$1",[ids.admin]);await db.query('update public.profiles set artisan_approved=true where id=$1',[ids.artisan]);await db.query("insert into public.artisan_profiles(user_id,application_status)values($1,'approved')",[ids.artisan]);
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA org',$1)returning id",[ids.owner])).rows[0].id;for(const[a,r]of [['owner','owner'],['reader','viewer']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[a],r]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA address fixture',100000)returning id",[org])).rows[0].id;
const siteB=(await db.query("insert into public.sites(organization_id,name,type,address)values($1,'QA other site','office','QA address fixture')returning id",[org])).rows[0].id;await db.query("insert into public.organization_member_site_scopes values($1,$2,'selected')",[org,ids.reader]);await db.query('insert into public.organization_member_site_grants values($1,$2,$3,false)',[org,ids.reader,site]);
async function as(actor,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function service(sql,args=[]){await db.exec('set role service_role');await db.query("select set_config('request.jwt.claim.sub','',false)");try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
// Genuine historical receipt is seeded BEFORE the retirement migration, with old RPC.
const payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne synthétique QA déclaration historique',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune QA',urgency:'scheduled'},contact={first_name:'QA',last_name:'Essai',email:'',phone:'+596696000000'};
await db.query("update public.profiles set role='client'where id=$1",[ids.owner]);
const old=(await as('owner','select public.create_on_site_booking($1,$2,$3)v',[crypto.randomUUID(),payload,contact])).rows[0].v;const historical=old.intervention.id;await db.query("update public.interventions set site_id=$1,artisan_id=$2,status='completed'where id=$3",[site,ids.artisan,historical]);await db.query("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA historique\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[historical,ids.artisan]);await as('artisan','select public.declare_onsite_receipt($1)',[historical]);await db.query("update public.profiles set role='manager'where id=$1",[ids.owner]);
for(const file of files.filter(n=>n>='20261107000000'&&n<executionMigration))await apply(file);
async function fixture(amend=0,paid=true,scope=site){const j=(await db.query("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,$3,'panel','Description synthétique QA','QA address fixture','97200','Commune QA','scheduled','completed',10000,20000)returning id",[ids.owner,ids.artisan,scope])).rows[0].id;const q=(await db.query("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA base\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')returning id",[j,ids.artisan])).rows[0].id;
 if(amend)await db.query("insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,1,'Supplément synthétique QA',$4,$5,20,$6,$7,'accepted')",[j,q,ids.artisan,JSON.stringify([{label:'QA supplement',quantity:1,unit_price_cents:amend*5/6}]),amend*5/6,amend/6,amend]);
 const session='cs_test_QA'+crypto.randomUUID().replaceAll('-','');let payment=null;if(paid){await service("insert into public.payments(quote_id,session_id,total_cents,currency,status)values($1,$2,$3,'eur','pending')",[q,session,12000+amend]);await service('select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)',['evt_QA'+crypto.randomUUID().replaceAll('-',''),'checkout.session.completed',session,q,12000+amend,'eur']);payment=(await db.query('select id from public.payments where quote_id=$1',[q])).rows[0].id;}return{j,q,session,payment};}
const a=await fixture(3000),b=await fixture(6000),c=await fixture(0,false);await db.query("update public.interventions set status='paid'where id=$1",[c.j]);
// Attempt history must never multiply monetary amounts.
for(let i=0;i<3;i++)await db.query("insert into public.payment_attempts(quote_id,session_id,total_cents,currency,status)values($1,$2,15000,'eur','failed')",[a.q,'cs_test_attempt_QA'+i]);
async function refund(amount,settle=true){const r=(await as('admin','select public.platform_request_refund($1,$2,$3,$4)v',[crypto.randomUUID(),a.payment,amount,'Motif synthétique QA de remboursement'])).rows[0].v.request;await as('admin',"select public.platform_decide_refund($1,'approve',1,'QA')",[r.id]);if(settle){const event='evt_refund_QA'+crypto.randomUUID().replaceAll('-','');await service('select public.platform_settle_refund($1,$2,$3,$4,$5,$6,$7,$8)',[r.id,event,'refund.updated',a.session,'re_QA'+crypto.randomUUID().replaceAll('-',''),'succeeded',amount,'eur']);}return r.id;}
await refund(2000);await refund(1000);await refund(500,false);
const report=async(actor,scope=site,organization=org)=>(await as(actor,'select *from public.professional_report($1,$2)',[scope,organization])).rows;
let r=(await report('owner'))[0];ok(Number(r.accepted_cents)===57000&&Number(r.active_accepted_cents)===57000,'base+all accepted amendments exactly once across4jobs');ok(Number(r.paid_cents)===33000,'two real recorded Stripe settlements, not job.status');ok(Number(r.declared_paid_cents)===12000,'historical manual receipt separate not bank');ok(Number(r.refunded_cents)===3000,'two settled refunds, approved-only500 excluded');ok(Number(r.net_paid_cents)===30000,'netclientexpense not commission/payout');ok(Number(r.committed_cents)===12000,'refund does not reopen debt; falsepaidjob remains committed');ok(Number(r.interventions)===4,'no Cartesian duplication from payments/attempts/refunds/amendments');ok(r.financial_complete===true,'known source facts complete');
let reader=(await report('reader'))[0];ok(Number(reader.refunded_cents)===3000,'readonly sees scoped aggregate despite no rawfinance ledger access');ok((await as('reader','select count(*)::int n from public.platform_ledger_entries')).rows[0].n===0,'no finance RLS expansion');await denied(()=>report('reader',siteB),'P0002');await denied(()=>report('stranger'),'P0002');ok((await as('stranger','select *from public.professional_report(null,null)')).rows.length===0,'foreign defaultreport has no visible site');
// Same organization filtering never bypasses the selected-site grant.
ok((await report('reader',null)).length===1,'selected visible universe only');ok((await report('owner',null)).length===2,'owner sees two visible sites, empty site remains honest zeros');
const orgB=(await db.query("insert into public.organizations(name,owner_id)values('QA foreign org',$1)returning id",[ids.outside])).rows[0].id;await db.query("insert into public.organization_members values($1,$2,'owner')",[orgB,ids.outside]);const foreign=(await db.query("insert into public.sites(organization_id,name,type,address)values($1,'QA foreign','office','QA foreign address')returning id",[orgB])).rows[0].id;await fixture(0,true,foreign);await denied(()=>report('owner',foreign,orgB),'P0002');ok((await report('owner',null))[0].site_id===site||(await report('owner',null))[1].site_id===site,'other org payment never added');
// A dated methodstripe record is explicit. Legacy paid-without-date stays visible as unverified.
const unknown=await fixture(0,false);await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status)values($1,'cs_test_unverified_QA',12000,'eur','paid')",[unknown.q]);r=(await report('owner'))[0];ok(Number(r.unverified_paid_cents)===12000&&!r.financial_complete&&Number(r.paid_cents)===33000,'unverified record not silentlybankpaid or zero');
// Accepted historical amount persists but cancelled work is not an active commitment.
await db.query("update public.interventions set status='cancelled'where id=$1",[unknown.j]);r=(await report('owner'))[0];ok(Number(r.accepted_cents)===69000&&Number(r.active_accepted_cents)===57000,'cancelled accepted quote remains historical only');
await db.query('delete from public.organization_member_site_grants where organization_id=$1 and user_id=$2',[org,ids.reader]);await denied(()=>report('reader'),'P0002');await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.reader]);await denied(()=>report('reader',null),'P0002');
for(const role of ['anon','service_role']){await db.exec('set role '+role);await denied(()=>db.query('select *from public.professional_report(null,null)'),'42501');await db.exec('reset role');}
// These settlement fixtures belong to the historical service contract. Seed them BEFORE
// the new intent/binding requirement, then execute that migration and prove unchanged facts.
const historicalRows=(await db.query("select row_to_json(r)v from public.platform_refund_requests r order by id")).rows;
const historicalReport=await report('owner');
for(const file of files.filter(n=>n>=executionMigration))await apply(file);
ok(JSON.stringify(historicalRows)===JSON.stringify((await db.query("select row_to_json(r)v from public.platform_refund_requests r order by id")).rows),'execution migration preserves historical refund rows');
ok(JSON.stringify(historicalReport)===JSON.stringify(await report('owner')),'historical report remains identical after execution guard');
const approved=(await db.query("select id from public.platform_refund_requests where status='approved' limit 1")).rows[0].id;
await denied(()=>service("select public.platform_settle_refund($1,'evt_NEW_UNQUALIFIED_QA','refund.updated',$2,'re_NEW_UNQUALIFIED_QA','succeeded',500,'eur')",[approved,a.session]),'P0001');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite0.5.13',auth_storage_cron:'SIMULATED',provider_events:'SYNTHETIC_SQL_QA_NOT_REAL_STRIPE',legacy_receipt_seeded_before_retirement:true,concurrency_cloud_proof:false}));await db.close();
