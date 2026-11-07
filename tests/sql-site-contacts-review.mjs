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
async function write(actor,id,version,values,action='save',cmd=crypto.randomUUID(),scope=site){return (await as(actor,'select public.write_site_contact($1,$2,$3,$4,$5,$6) v',[scope,id,cmd,version,action,values])).rows[0].v;}
function ok(value,message){assert.ok(value,message);checks++;}
async function denied(fn,code){await assert.rejects(fn,e=>!code||e.code===code);checks++;}
const id='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002',third='20000000-0000-4000-8000-000000000003';
const values={first_name:'Léa',last_name:'Martin',role_label:'Responsable QA',phone:'+596 696 00 00 00',email:null,note:'Donnée synthétique QA',is_primary:true};
const create=crypto.randomUUID();let r=await write('owner',id,null,values,'save',create);ok(r.id===id&&r.version===1&&r.is_primary,'created real declared fields');
r=await write('owner',id,null,values,'save',create);ok(r.version===1,'lost create response replay');
ok((await db.query('select count(*)::int n from public.site_contact_events')).rows[0].n===1,'replay no audit duplicate');
for(const actor of ['owner','reader','writer'])ok((await as(actor,'select count(*)::int n from public.site_contacts')).rows[0].n===1,'RLS permitted read '+actor);
ok((await as('outside','select count(*)::int n from public.site_contacts')).rows[0].n===0,'foreign no contact');
ok((await as('outside','select count(*)::int n from public.site_contact_events')).rows[0].n===0,'foreign no audit');
for(const actor of ['reader','outside'])await denied(()=>write(actor,other,null,values),'42501');
await denied(()=>write('writer',other,null,values,'save',crypto.randomUUID(),siteB),'42501');
await denied(()=>as('owner',`insert into public.site_contacts(id,site_id,first_name,last_name,role_label,phone,created_by,updated_by) values($1,$2,'A','B','C','123456',$3,$3)`,[other,site,ids.owner]),'42501');
await denied(()=>as('owner',"update public.site_contacts set first_name='Injected' where id=$1",[id]),'42501');
await denied(()=>as('owner','delete from public.site_contacts where id=$1',[id]),'42501');
await denied(()=>write('owner',other,null,values),'23505'); // primary never silently moved
await denied(()=>write('owner',id,null,{...values,note:'changed replay'},'save',create),'P0001');
await denied(()=>write('writer',id,null,values,'save',create),'P0001');
await denied(()=>write('owner',other,null,values,'save',create),'P0001');
for(const invalid of [{...values,first_name:''},{...values,last_name:'x'.repeat(101)},{...values,role_label:'bad\ncontrol'},{...values,phone:null},{...values,email:'bad email'},{...values,phone:'bad'},{...values,is_primary:'true'},{...values,note:'x'.repeat(2001)},{...values,extra:true}])await denied(()=>write('owner',other,null,invalid),'22023');
await denied(()=>write('owner',other,null,null),'22023');
const second=crypto.randomUUID();r=await write('writer',other,null,{...values,is_primary:false,phone:null,email:'contact@example.invalid'},'save',second);ok(r.version===1&&!r.is_primary,'scoped writer with email only');
const change=crypto.randomUUID();r=await write('writer',id,1,{...values,note:'Version 2'},'save',change);ok(r.version===2&&r.updated_by===ids.writer,'optimistic update');
r=await write('writer',id,1,{...values,note:'Version 2'},'save',change);ok(r.version===2,'lost update response replay');
await denied(()=>write('owner',id,1,values),'P0001');
await denied(()=>write('owner',id,null,values,'save',create),'P0001'); // old successful command cannot falsely report stale persistence
const archive=crypto.randomUUID();r=await write('owner',id,2,null,'archive',archive);ok(r.version===3&&r.archived_at!==null&&!r.is_primary,'archive keeps history and releases principal');
r=await write('owner',id,2,null,'archive',archive);ok(r.version===3,'archive replay');
await denied(()=>write('writer',id,2,null,'archive',archive),'P0001');
await denied(()=>write('owner',id,3,values),'P0001');
await denied(()=>write('owner',id,3,null,'archive'),'P0001');
await denied(()=>write('owner',third,1,null,'archive'),'P0002');
r=await write('owner',other,1,{...values,phone:null,email:'contact@example.invalid'});ok(r.version===2&&r.is_primary,'explicitly select new primary after old archival');
const siteOther=await write('owner',third,null,values,'save',crypto.randomUUID(),siteB);ok(siteOther.is_primary,'independent primary per site');
ok((await db.query('select count(*)::int n from public.site_contact_events')).rows[0].n===6,'six actual business writes only');
ok((await db.query('select fingerprint from public.site_contact_events')).rows.every(r=>/^[0-9a-f]{64}$/.test(r.fingerprint)),'audit contains fingerprint not PII copy');
await db.query('update public.organization_member_site_grants set can_write=false where organization_id=$1 and user_id=$2',[org,ids.writer]);
await denied(()=>write('writer',other,2,{...values,note:'Revoked write'}),'42501');
await denied(()=>write('writer',other,null,{...values,is_primary:false,phone:null,email:'contact@example.invalid'},'save',second),'42501'); // replay also checks current rights
ok((await as('writer','select count(*)::int n from public.site_contacts')).rows[0].n===2,'readonly scoped grant can still read site only');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.writer]);
ok((await as('writer','select count(*)::int n from public.site_contacts')).rows[0].n===0,'revoked member no reads');
await denied(()=>write('writer',other,2,values),'42501');
await db.exec('set role anon');await denied(()=>db.query('select * from public.site_contacts'),'42501');await denied(()=>db.query("select public.write_site_contact($1,$2,$3,null,'save',$4)",[site,id,crypto.randomUUID(),values]),'42501');await db.exec('reset role');
await db.exec('set role service_role');await denied(()=>db.query('delete from public.site_contacts where id=$1',[id]),'42501');await denied(()=>db.query("select public.write_site_contact($1,$2,$3,null,'save',$4)",[site,id,crypto.randomUUID(),values]),'42501');await db.exec('reset role');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
