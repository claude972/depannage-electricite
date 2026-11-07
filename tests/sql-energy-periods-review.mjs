import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ADV-B2B-OPERATIONS-001 — isolated PostgreSQL verification of migration 017 (not live Supabase).
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
// Every fixture below is synthetic QA data: no real site, rate, delay, calendar or regulation.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
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
const ids={owner:'10000000-0000-4000-8000-000000000001',reader:'10000000-0000-4000-8000-000000000002',outside:'10000000-0000-4000-8000-000000000003',writer:'10000000-0000-4000-8000-000000000004'};
for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:'manager',full_name:'QA '+name}),name+'@example.invalid']);
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA energy org',$1)returning id",[ids.owner])).rows[0].id;
for(const [name,role]of [['owner','owner'],['reader','viewer'],['writer','manager']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[name],role]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA fixture address',0)returning id",[org])).rows[0].id;
const siteB=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site B','office','QA fixture address',0)returning id",[org])).rows[0].id;
await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.writer]);
await db.query('insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,true)',[org,ids.writer,site]);
async function as(name,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function save(actor,id,version,values,scope=site){return (await as(actor,'select public.save_site_energy_period($1,$2,$3,$4) v',[scope,id,version,values])).rows[0].v;}
async function archive(actor,id,version){return(await as(actor,'select public.archive_site_energy_period($1,$2,$3)v',[site,id,version])).rows[0].v;}
function ok(value,message){assert.ok(value,message);checks++;}
async function denied(fn,code){await assert.rejects(fn,e=>!code||e.code===code);checks++;}
const id='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const values={meter_label:'Compteur A',period_start:'2026-01-01',period_end:'2026-01-31',consumption_wh:1250500,cost_cents:null,source_kind:'meter',source_reference:'Relevé synthétique QA',note:''};
let r=await save('owner',id,null,values);ok(r.id===id&&r.version===1&&r.consumption_wh===1250500&&r.cost_cents===null,'create exact period');
let again=await save('owner',id,null,values);ok(again.version===1,'lost reply replay does not duplicate or bump version');
ok((await db.query('select count(*)::int n from public.site_energy_events')).rows[0].n===1,'one event for replay');
for(const actor of ['owner','reader','writer'])ok((await as(actor,'select count(*)::int n from public.site_energy_periods')).rows[0].n===1,'authorized site read '+actor);
ok((await as('outside','select count(*)::int n from public.site_energy_periods')).rows[0].n===0,'outside reads no rows');
for(const actor of ['reader','outside'])await denied(()=>save(actor,other,null,values),'42501');
await denied(()=>save('writer',other,null,{...values,meter_label:'B'},siteB),'42501');
await denied(()=>as('owner',"insert into public.site_energy_periods(id,site_id,meter_label,period_start,period_end,consumption_wh,source_kind,source_reference,created_by,updated_by)values($1,$2,'bad','2026-01-01','2026-01-31',1,'manual','bad',$3,$3)",[other,site,ids.owner]),'42501');
await denied(()=>save('owner',other,null,{...values,meter_label:'  COMPTEUR A  ',period_start:'2026-01-15',period_end:'2026-02-15'}),'P0001');
await denied(()=>save('owner',other,null,{...values,period_start:'2026-02-30'}));
await denied(()=>save('owner',other,null,{...values,consumption_wh:-1}),'22023');
await denied(()=>save('owner',other,null,{...values,extra:true}),'22023');
await denied(()=>save('owner',other,null,{...values,source_reference:''}),'22023');
r=await save('writer',id,1,{...values,consumption_wh:1500000,cost_cents:23000});ok(r.version===2&&r.updated_by===ids.writer,'authorized scoped writer updates with version');
r=await save('writer',id,1,{...values,consumption_wh:1500000,cost_cents:23000});ok(r.version===2,'update lost reply replay');
await denied(()=>save('owner',id,1,{...values,consumption_wh:5000}),'P0001');
await denied(()=>save('owner',id,2,values,siteB),'P0002');
r=await archive('owner',id,2);ok(r.version===3&&r.archived_at!==null,'archive keeps record and audit');
r=await archive('owner',id,2);ok(r.version===3,'archive replay stays idempotent');
await denied(()=>save('owner',id,null,values),'P0001');
ok((await db.query('select count(*)::int n from public.site_energy_events')).rows[0].n===3,'exact three business changes');
// After archival, a genuinely new reading of this meter period can be entered.
r=await save('owner',other,null,values);ok(r.version===1,'new record can replace archived period');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.writer]);
ok((await as('writer','select count(*)::int n from public.site_energy_periods')).rows[0].n===0,'removed member reads nothing');
await denied(()=>save('writer',other,1,{...values,note:'revoked'}),'42501');
await db.exec('set role anon');await denied(()=>db.query('select public.save_site_energy_period($1,$2,null,$3)',[site,id,values]),'42501');await db.exec('reset role');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
