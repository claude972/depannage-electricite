import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// Customer invoices — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = (await isolatedMigrationSql(db, file, await readFile(new URL(file,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- pgcrypto omitted in isolated stub harness only');
  await db.exec(sql);
}

let checks=0;
const ids={client:'10000000-0000-4000-8000-000000000001',outside:'10000000-0000-4000-8000-000000000002',artisan:'10000000-0000-4000-8000-000000000003',nextArtisan:'10000000-0000-4000-8000-000000000004',owner:'10000000-0000-4000-8000-000000000005',reader:'10000000-0000-4000-8000-000000000006',admin:'10000000-0000-4000-8000-000000000007'};
for(const[name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:name.includes('rtisan')?'artisan':name==='owner'||name==='reader'?'manager':'client',full_name:'QA '+name}),name.toLowerCase()+'@example.invalid']);
await db.query("update public.profiles set role='admin'where id=$1",[ids.admin]);
async function as(actor,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function service(sql,args=[]){await db.exec('set role service_role');await db.query("select set_config('request.jwt.claim.sub','',false)");try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const scalar=async(actor,sql,args=[])=>(await as(actor,sql,args)).rows[0].v;
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
for(const actor of ['artisan','nextArtisan']){await as(actor,"select public.save_artisan_profile('Electricité QA','12345678901234','EI',0,'12 rue de test QA',array['97200'],array['panel'])");await as(actor,'select public.submit_artisan_application()');await as('admin','select public.approve_artisan($1,true)',[ids[actor]]);}
const org=(await db.query("insert into public.organizations(name,owner_id)values('Organisation QA',$1)returning id",[ids.owner])).rows[0].id;
for(const[name,role]of [['owner','owner'],['reader','viewer']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[name],role]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address)values($1,'Site QA','office','Adresse synthétique QA')returning id",[org])).rows[0].id;
const hiddenSite=(await db.query("insert into public.sites(organization_id,name,type,address)values($1,'Site non affecté QA','office','Adresse synthétique QA')returning id",[org])).rows[0].id;
await db.query("insert into public.organization_member_site_scopes values($1,$2,'selected')",[org,ids.reader]);await db.query('insert into public.organization_member_site_grants values($1,$2,$3,false)',[org,ids.reader,site]);
async function fixture(actor,siteId=null){
 const j=(await db.query("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,$3,'panel','Panne synthétique QA sans client réel','12 rue de test QA','97200','Commune QA','scheduled','completed',10000,20000)returning *",[ids[actor],ids.artisan,siteId])).rows[0];
 const q=(await db.query("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"Prestation synthétique QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')returning *",[j.id,ids.artisan])).rows[0];
 const session='cs_test_QA'+crypto.randomUUID().replaceAll('-','');await service("insert into public.payments(quote_id,session_id,total_cents,currency,status)values($1,$2,12000,'eur','pending')",[q.id,session]);await service('select public.confirm_stripe_payment($1,$2,$3,$4,12000,$5)',['evt_QA'+crypto.randomUUID().replaceAll('-',''),'checkout.session.completed',session,q.id,'eur']);
 const payment=(await db.query('select *from public.payments where quote_id=$1',[q.id])).rows[0];return{job:j,quote:q,payment,session};
}
const a=await fixture('client'),b=await fixture('owner',site);
await as('admin',"select public.platform_set_billing_contact('profile',$1,'Client synthétique QA','4 rue de test QA',null,null,null)",[ids.client]);await as('admin',"select public.platform_set_billing_contact('organization',$1,'Organisation synthétique QA','8 rue de test QA',null,null,null)",[org]);
const issue=async(basis,payment)=>(await scalar('admin','select public.platform_issue_invoice($1,$2,$3)v',[crypto.randomUUID(),basis,payment])).invoice;
const personal=await issue('service',a.payment.id),company=await issue('service',b.payment.id);
const credit=(await scalar('admin','select public.platform_issue_credit_note($1,$2,1000,$3)v',[crypto.randomUUID(),personal.id,'Avoir synthétique QA pour contrôle'])).invoice;
await as('admin','select public.platform_set_setting($1,$2,null)',['invoice_issuer',JSON.stringify({legal_name:'Plateforme synthétique QA',siret:'98765432109876',address:'16 rue de test QA',vat_number:null,commission_vat_rate:20})]);
await service('select public.platform_record_commission_withheld($1,$2,$3,$4,$5,$6,1200,$7)',[a.payment.id,'evt_fee_QA','application_fee.created',a.session,'fee_QA','succeeded','eur']);const commission=await issue('platform_commission',a.payment.id);
const page=async(actor,args=[])=>(await scalar(actor,'select public.customer_invoice_page($1,$2,$3,$4,$5,$6,$7,$8)v',[...args,...Array(Math.max(0,8-args.length)).fill(null)].map((v,i)=>i===5&&v===null?25:v)));
const doc=(actor,id)=>scalar(actor,'select public.customer_invoice_document($1)v',[id]);
for(const actor of ['client','artisan','reader'])ok((await as(actor,'select count(*)::int n from public.platform_invoices')).rows[0].n===0,'operator RLS unchanged for '+actor);
let p=await page('client');ok(p.total===2&&p.invoices.length===2&&p.invoices.every(i=>i.basis==='service'),'client own service invoice and credit only');
ok(!JSON.stringify(p).includes('content_fingerprint')&&!JSON.stringify(p).includes('request_id')&&!JSON.stringify(p).includes('issued_by'),'internal operator metadata omitted');
let d=await doc('client',personal.id);ok(d.invoice.issuer.legal_name==='Electricité QA'&&d.invoice.total_cents===12000&&d.credit_notes_total===1,'original issued issuer/amount and credit count');
d=await doc('client',credit.id);ok(d.related.id===personal.id&&d.related.number===personal.number,'credit linked stored parent');
for(const target of [personal.id,credit.id,commission.id,company.id])await denied(()=>doc('outside',target),'P0002');
await denied(()=>doc('client',commission.id),'P0002');await denied(()=>doc('client',company.id),'P0002');
p=await page('outside');ok(p.total===0&&p.invoices.length===0,'foreign list contains no data');
p=await page('admin');ok(p.total===0,'finance authority alone does not grant customer audience');
p=await page('artisan');ok(p.total===4&&p.invoices.some(i=>i.id===commission.id),'artisan reads issuer service and recipient commission');
ok((await doc('artisan',commission.id)).invoice.recipient.profile_id===ids.artisan,'commission only its artisan recipient');
p=await page('reader',[org,site]);ok(p.total===1&&p.invoices[0].id===company.id,'org readonly selected site invoice');
ok((await doc('reader',company.id)).invoice.recipient.subject_id===org,'org document scoped to immutable organization recipient');
await denied(()=>page('reader',[org,hiddenSite]),'P0002');await denied(()=>page('outside',[org]),'P0002');await denied(()=>page('client',[null,null,b.job.id]),'P0002');
await denied(()=>doc('reader',personal.id),'P0002');await denied(()=>doc('owner',commission.id),'P0002');
// Cursor pagination is atomic and exact, not a local100 fallback.
let first=await page('client',[null,null,null,null,null,1]);ok(first.total===2&&first.remaining===2&&first.invoices.length===1,'first page count exact');let last=await page('client',[null,null,null,null,null,1,first.invoices[0].issued_at,first.invoices[0].id]);ok(last.total===2&&last.remaining===1&&last.invoices.length===1&&last.invoices[0].id!==first.invoices[0].id,'cursor final page keeps global total');
await denied(()=>page('client',[null,null,null,'invalid']),'22023');
await db.query('update public.interventions set artisan_id=$1 where id=$2',[ids.nextArtisan,a.job.id]);await denied(()=>doc('nextArtisan',personal.id),'P0002');ok((await doc('artisan',personal.id)).invoice.id===personal.id,'reassignment never gives invoice to new artisan and original issuer keeps it');
await db.query("update public.artisan_profiles set company_name='Nouveau nom actuel QA'where user_id=$1",[ids.artisan]);ok((await doc('client',personal.id)).invoice.issuer.legal_name==='Electricité QA','live identity changes do not rewrite issued snapshot');
await db.query('delete from public.organization_member_site_grants where organization_id=$1 and user_id=$2',[org,ids.reader]);await denied(()=>doc('reader',company.id),'P0002');p=await page('reader',[org]);ok(p.total===0,'revoked grant returns no company invoices');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.reader]);await denied(()=>page('reader',[org]),'P0002');
for(const actor of ['client','artisan','reader'])await denied(()=>as(actor,'select public.customer_invoice_authorized($1)',[personal.id]),'42501');
await db.exec('set role anon');await denied(()=>db.query('select public.customer_invoice_document($1)',[personal.id]),'42501');await db.exec('reset role');await db.exec('set role service_role');await denied(()=>db.query('select public.customer_invoice_document($1)',[personal.id]),'42501');await db.exec('reset role');
await denied(()=>as('none','select public.customer_invoice_page()'),'42501');
ok((await db.query('select count(*)::int n from public.platform_invoices')).rows[0].n===4,'readers issue or mutate no financial document');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',provider_events:'SYNTHETIC_SQL_QA_NOT_REAL_STRIPE',concurrency_cloud_proof:false}));await db.close();
