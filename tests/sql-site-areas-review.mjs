import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ENT site hierarchy — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const ids={owner:'10000000-0000-4000-8000-000000000001',reader:'10000000-0000-4000-8000-000000000002',outside:'10000000-0000-4000-8000-000000000003',writer:'10000000-0000-4000-8000-000000000004'};
for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:'manager',full_name:'QA '+name}),name+'@example.invalid']);
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA contacts org',$1)returning id",[ids.owner])).rows[0].id;
for(const [name,role]of [['owner','owner'],['reader','viewer'],['writer','manager']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[name],role]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA fixture address',0)returning id",[org])).rows[0].id;
const siteB=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site B','office','QA fixture address',0)returning id",[org])).rows[0].id;
await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.writer]);
await db.query('insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,true)',[org,ids.writer,site]);
async function as(name,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
const page=async(actor,scope=site,after=null)=>(await as(actor,'select public.site_area_page($1,$2)v',[scope,after])).rows[0].v;
const write=async(actor,id,version,values,action='save',command=crypto.randomUUID(),scope=site)=>(await as(actor,'select public.write_site_area($1,$2,$3,$4,$5,$6)v',[scope,id,command,version,action,values])).rows[0].v;
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID(),d=crypto.randomUUID(),x=crypto.randomUUID();
const values={label:'Bâtiment A',kind:'floor',reference:'A-01',note:'Saisie synthétique QA',parent_id:null};
const create=crypto.randomUUID();let r=await write('owner',a,null,values,'save',create);ok(r.version===1&&r.depth===1&&r.parent_id===null,'root created and visible to depth helper within writer');
r=await write('owner',a,null,values,'save',create);ok(r.version===1&&r.depth===1,'lost reply exact replay');
ok((await db.query('select count(*)::int n from public.site_area_events')).rows[0].n===1,'one audit receipt');
for(const actor of ['owner','reader','writer'])ok((await page(actor)).records.length===1,'site read '+actor);
ok((await page('reader')).can_write===false,'readonly permission explicit');
ok((await as('outside','select count(*)::int n from public.site_areas')).rows[0].n===0,'foreign direct read zero');await denied(()=>page('outside'),'P0002');
for(const actor of ['reader','outside'])await denied(()=>write(actor,b,null,values),'42501');await denied(()=>write('writer',b,null,values,'save',crypto.randomUUID(),siteB),'42501');
await denied(()=>write('owner',b,null,{...values,label:'  BÂTIMENT a  ',reference:''}),'23505');
await denied(()=>write('owner',b,null,{...values,label:'Autre label',reference:' a-01 '}),'23505');
for(const v of [{...values,label:''},{...values,kind:'certified_erp'},{...values,reference:'x'.repeat(81)},{...values,note:'x'.repeat(2001)},{...values,label:'bad\nname'},{...values,extra:true}])await denied(()=>write('owner',b,null,v),'22023');
await denied(()=>write('owner',b,null,{...values,label:'Foreign parent',reference:'',parent_id:crypto.randomUUID()}),'P0002');
const alien=crypto.randomUUID();await write('owner',alien,null,{...values,label:'Zone autre site',reference:''},'save',crypto.randomUUID(),siteB);await denied(()=>write('owner',b,null,{...values,label:'Foreign parent',reference:'',parent_id:alien}),'P0002');
const child=(label,parent,kind='zone')=>({label,kind,reference:'',note:'QA',parent_id:parent});
await write('owner',b,null,child('Étage 1',a));await write('writer',c,null,child('Zone 1',b));const dCommand=crypto.randomUUID();r=await write('owner',d,null,child('Local 1',c,'common_area'),'save',dCommand);ok(r.depth===4,'four levels supported');
await denied(()=>write('owner',crypto.randomUUID(),null,child('Too deep',d)),'P0001');
await denied(()=>write('owner',a,1,{...values,parent_id:b}),'P0001');await denied(()=>write('owner',c,1,child('Zone 1',c)),'P0001');await denied(()=>write('owner',c,1,child('Zone 1',d)),'P0001');
await write('owner',x,null,child('Bâtiment X',null,'floor'));await denied(()=>write('owner',a,1,{...values,parent_id:x}),'P0001'); // subtree height4+new parent1 exceeds4
const hallA=crypto.randomUUID(),hallX=crypto.randomUUID();await write('owner',hallA,null,child('Hall',a));await write('owner',hallX,null,child('Hall',x));ok(true,'same label under distinct parents allowed');await denied(()=>write('owner',crypto.randomUUID(),null,child(' hall ',a,'common_area')),'23505');
const move=crypto.randomUUID();r=await write('writer',c,1,child('Zone 1',a),'save',move);ok(r.depth===2&&r.version===2,'move updates its own version');
r=await write('writer',c,1,child('Zone 1',a),'save',move);ok(r.depth===2&&r.version===2,'move replay exact');
const p=await page('owner');ok(p.records.find(row=>row.id===d).depth===3,'descendant depth derives from current complete parent path');await denied(()=>write('owner',d,null,child('Local 1',c,'common_area'),'save',dCommand),'P0001'); // topology changed since receipt
await denied(()=>write('owner',c,1,child('Zone 1',a)),'P0001');
await denied(()=>write('owner',a,1,null,'archive'),'P0001');await denied(()=>write('owner',c,2,null,'archive'),'P0001');
const archiveD=crypto.randomUUID();r=await write('owner',d,1,null,'archive',archiveD);ok(r.archived_at!==null&&r.depth===3&&r.version===2,'archive leaf without erasing');r=await write('owner',d,1,null,'archive',archiveD);ok(r.version===2,'archive replay exact');
await denied(()=>write('owner',crypto.randomUUID(),null,child('Archived parent',d)),'P0002');
await write('owner',c,2,null,'archive');await write('owner',b,1,null,'archive');await write('owner',hallA,1,null,'archive');r=await write('owner',a,1,null,'archive');ok(r.archived_at!==null,'parent archived only after every active child archived');
r=await write('owner',d,1,null,'archive',archiveD);ok(r.depth===3,'historical archived path remains readable after ancestors archived');
await denied(()=>write('owner',a,2,values),'P0001');r=await write('owner',crypto.randomUUID(),null,values);ok(r.version===1,'archived label/reference freed for explicit replacement UUID');
await denied(()=>as('owner',"update public.site_areas set parent_id=id where id=$1",[x]),'42501');await denied(()=>as('owner','delete from public.site_areas where id=$1',[x]),'42501');
// Privileged fixture setup reaches quota without a thousand network-style calls;
// assertions exercise the real writer gate and its profile/site serialization.
const n=(await db.query('select count(*)::int n from public.site_areas where site_id=$1 and archived_at is null',[site])).rows[0].n;
await db.query("insert into public.site_areas(id,site_id,label,kind,created_by,updated_by)select gen_random_uuid(),$1,'Quota fixture QA '||n,'zone',$2,$2 from generate_series(1,$3::int)n",[site,ids.owner,1000-n]);
let cap=await page('owner');ok(cap.total===1000&&cap.records.length===100&&cap.remaining===1000,'quota and pagination use exact SQL count');await denied(()=>write('owner',crypto.randomUUID(),null,child('Overflow',null)),'P0001');
let next=await page('owner',site,cap.records.at(-1).id);ok(next.remaining===900&&next.total===1000&&next.records.every(row=>row.id>cap.records.at(-1).id),'second page stable, remaining never false total');
r=await write('owner',x,1,{...child('Bâtiment X',null,'floor'),note:'Still editable at quota'});ok(r.version===2,'update allowed at quota');
await write('owner',hallX,1,null,'archive');r=await write('owner',crypto.randomUUID(),null,child('Released slot',null));ok(r.version===1,'archive releases one active slot');
await db.query('update public.organization_member_site_grants set can_write=false where organization_id=$1 and user_id=$2',[org,ids.writer]);await denied(()=>write('writer',c,1,child('Zone 1',a),'save',move),'42501');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.writer]);await denied(()=>page('writer'),'P0002');
for(const role of ['anon','service_role']){await db.exec('set role '+role);await denied(()=>db.query('select public.write_site_area($1,$2,$3,null,$4,$5)',[site,crypto.randomUUID(),crypto.randomUUID(),'save',values]),'42501');await denied(()=>db.query('delete from public.site_areas where site_id=$1',[site]),'42501');await db.exec('reset role');}
ok((await db.query('select fingerprint from public.site_area_events')).rows.every(e=>/^[0-9a-f]{64}$/.test(e.fingerprint)),'audit stores command fingerprints, no copied notes');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
