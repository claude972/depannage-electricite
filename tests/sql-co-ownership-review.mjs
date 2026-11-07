import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ENT-05 documentary governance — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA contacts org',$1)returning id",[ids.owner])).rows[0].id;
for(const [name,role]of [['owner','owner'],['reader','viewer'],['writer','manager']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[name],role]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA fixture address',0)returning id",[org])).rows[0].id;
const siteB=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site B','office','QA fixture address',0)returning id",[org])).rows[0].id;
await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.writer]);
await db.query('insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,true)',[org,ids.writer,site]);
async function as(name,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
await db.query("update public.sites set type='syndic'where id in($1,$2)",[site,siteB]);
const office=(await db.query("insert into public.sites(organization_id,name,type,address)values($1,'Bureaux QA','office','Adresse synthétique QA')returning id",[org])).rows[0].id;
const page=async(actor,kind='meeting',scope=site,after=null)=>(await as(actor,'select public.coownership_page($1,$2,$3)v',[scope,kind,after])).rows[0].v;
const write=async(actor,kind,id,version,values,action='save',cmd=crypto.randomUUID(),scope=site)=>(await as(actor,'select public.write_coownership_record($1,$2,$3,$4,$5,$6,$7)v',[scope,kind,id,cmd,version,action,values])).rows[0].v;
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
const m=crypto.randomUUID(),f=crypto.randomUUID();
const meeting={title:'AG documentaire QA',starts_at:'2026-10-01T14:00:00Z',ends_at:'2026-10-01T15:00:00Z',location:'Salle synthétique QA',agenda:'Sujet saisi par organisation',minutes:'',decisions:[],status:'draft'};
const create=crypto.randomUUID();let r=await write('owner','meeting',m,null,meeting,'save',create);ok(r.version===1&&r.kind==='meeting'&&r.values.starts_at==='2026-10-01T14:00:00.000000Z','human meeting stored UTC without notification');r=await write('owner','meeting',m,null,meeting,'save',create);ok(r.version===1,'lost reply exact replay');
ok((await db.query('select count(*)::int n from public.site_coownership_events')).rows[0].n===1,'one audit receipt for replay');
for(const actor of ['owner','reader','writer'])ok((await page(actor)).records.length===1,'visible read '+actor);ok((await page('reader')).can_write===false,'readonly explicit');ok((await as('outside','select count(*)::int n from public.site_coownership_records')).rows[0].n===0,'foreign RLS zero');await denied(()=>page('outside'),'P0002');
for(const actor of ['reader','outside'])await denied(()=>write(actor,'meeting',crypto.randomUUID(),null,meeting),'42501');await denied(()=>write('writer','meeting',crypto.randomUUID(),null,meeting,'save',crypto.randomUUID(),siteB),'42501');
await denied(()=>page('owner','meeting',office),'22023');await denied(()=>write('owner','meeting',crypto.randomUUID(),null,meeting,'save',crypto.randomUUID(),office),'22023');
for(const data of [{...meeting,status:'legally_valid'},{...meeting,ends_at:'2026-09-30T10:00:00Z'},{...meeting,status:'scheduled',starts_at:null},{...meeting,status:'held',location:''},{...meeting,status:'held',starts_at:'2035-01-01T10:00:00Z',ends_at:null},{...meeting,decisions:Array(21).fill('A')},{...meeting,decisions:[1]},{...meeting,extra:true}])await denied(()=>write('owner','meeting',crypto.randomUUID(),null,data),'22023');
r=await write('writer','meeting',m,1,{...meeting,status:'scheduled'});ok(r.version===2,'planned state is human entered');await denied(()=>write('owner','meeting',m,2,meeting),'P0001');
const held={...meeting,status:'held',minutes:'Compte rendu humain saisi',decisions:['Décision déclarée, sans quorum calculé']};r=await write('writer','meeting',m,2,held);ok(r.version===3&&r.values.decisions.length===1,'held minutes and decisions entered not certified');await denied(()=>write('owner','meeting',m,3,{...held,status:'scheduled'}),'P0001');
const alien=crypto.randomUUID();await write('owner','meeting',alien,null,meeting,'save',crypto.randomUUID(),siteB);
const cancelled=crypto.randomUUID();await write('owner','meeting',cancelled,null,{...meeting,status:'cancelled'});
const fund={label:'Appel documentaire QA',reference:'CF-QA-01',due_on:'2026-12-01',amount_cents:12000,document_reference:'Référence de pièce saisie QA',issued_on:null,note:'Déclaratif, aucun encaissement',meeting_id:m,status:'draft'};
for(const link of [alien,cancelled,crypto.randomUUID()])await denied(()=>write('owner','fund_call',f,null,{...fund,meeting_id:link}),'P0002');
for(const data of [{...fund,status:'paid'},{...fund,amount_cents:-1},{...fund,amount_cents:1.5},{...fund,document_reference:''},{...fund,status:'issued'},{...fund,status:'issued',issued_on:'2035-01-01',due_on:'2035-02-01'},{...fund,issued_on:'2026-12-02'},{...fund,note:'x'.repeat(4001)}])await denied(()=>write('owner','fund_call',f,null,data),'22023');
const fcmd=crypto.randomUUID();r=await write('owner','fund_call',f,null,fund,'save',fcmd);ok(r.version===1&&r.values.amount_cents===12000&&r.values.status==='draft','notice stores only declared positive amount and documentary reference');r=await write('owner','fund_call',f,null,fund,'save',fcmd);ok(r.version===1,'notice replay idempotent');
await denied(()=>write('owner','fund_call',crypto.randomUUID(),null,{...fund,reference:' cf-qa-01 '}),'23505');await denied(()=>write('owner','meeting',m,3,null,'archive'),'P0001');
const issued={...fund,status:'issued',issued_on:'2026-10-02'};r=await write('writer','fund_call',f,1,issued);ok(r.version===2&&r.values.status==='issued','issued is documented human record, not payment');
await denied(()=>write('writer','fund_call',f,2,{...issued,amount_cents:13000}),'P0001');await denied(()=>write('owner','fund_call',f,2,{...issued,status:'draft'}),'P0001');
r=await write('writer','fund_call',f,2,{...issued,status:'cancelled',note:'Annulation documentaire QA'});ok(r.version===3&&r.values.amount_cents===12000,'cancellation preserves declared financial data');await denied(()=>write('owner','fund_call',f,3,{...issued,status:'issued'}),'P0001');await denied(()=>write('owner','meeting',m,3,null,'archive'),'P0001');
const archived=crypto.randomUUID();r=await write('owner','fund_call',f,3,null,'archive',archived);ok(r.version===4&&r.archived_at!==null,'archive retains cancelled notice');r=await write('owner','fund_call',f,3,null,'archive',archived);ok(r.version===4,'archive replay exact');r=await write('owner','meeting',m,3,null,'archive');ok(r.version===4&&r.archived_at!==null,'AG archive after explicit dependent archive');await denied(()=>write('owner','fund_call',crypto.randomUUID(),null,fund),'P0002');
await denied(()=>write('owner','meeting',m,4,held),'P0001');await denied(()=>write('owner','meeting',m,null,meeting,'save',create),'P0001');
// Fresh documentary notice may reuse reference after archived history, no monetary action.
r=await write('owner','fund_call',crypto.randomUUID(),null,{...fund,meeting_id:null});ok(r.version===1,'explicit new UUID after archival, reference freed');
const current=(await db.query("select count(*)::int n from public.site_coownership_records where site_id=$1 and kind='meeting'and archived_at is null",[site])).rows[0].n;
await db.query("insert into public.site_coownership_records(id,site_id,kind,data,created_by,updated_by)select gen_random_uuid(),$1,'meeting',$2::jsonb,$3,$3 from generate_series(1,$4::int)",[site,meeting,ids.owner,500-current]);
let p=await page('owner');ok(p.total===500&&p.records.length===50,'exact bounded pagination at500');await denied(()=>write('owner','meeting',crypto.randomUUID(),null,meeting),'P0001');const next=await page('owner','meeting',site,p.records.at(-1).id);ok(next.total===500&&next.remaining===450&&next.records.length===50,'remaining count does not masquerade as total');
for(const sql of ["update public.site_coownership_records set data='{}'where site_id=$1",'delete from public.site_coownership_records where site_id=$1'])await denied(()=>as('owner',sql,[site]),'42501');
await db.query('update public.organization_member_site_grants set can_write=false where organization_id=$1 and user_id=$2',[org,ids.writer]);await denied(()=>write('writer','fund_call',f,1,issued),'42501');await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.writer]);await denied(()=>page('writer'),'P0002');
for(const role of ['anon','service_role']){await db.exec('set role '+role);await denied(()=>db.query('select public.write_coownership_record($1,$2,$3,$4,null,$5,$6)',[site,'meeting',crypto.randomUUID(),crypto.randomUUID(),'save',meeting]),'42501');await denied(()=>db.query('delete from public.site_coownership_records where site_id=$1',[site]),'42501');await db.exec('reset role');}
ok((await db.query('select fingerprint from public.site_coownership_events')).rows.every(e=>/^[0-9a-f]{64}$/.test(e.fingerprint)),'audit no text/PII copies');
for(const table of ['payments','stripe_events','messages'])ok((await db.query('select count(*)::int n from public.'+table)).rows[0].n===0,'documentary module does not write '+table);
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite0.5.13',auth_storage_cron:'SIMULATED',no_real_legal_or_fund_action:true,concurrency_cloud_proof:false}));await db.close();
