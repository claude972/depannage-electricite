import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// CLI-09 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const ids={client:'10000000-0000-4000-8000-000000000001',foreign:'10000000-0000-4000-8000-000000000002',admin:'10000000-0000-4000-8000-000000000003'};
for(const[name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:'client',full_name:'QA '+name}),name+'@example.invalid']);
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
const before=(await db.query('select id,full_name,phone from public.profiles order by id')).rows;
async function as(actor,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function write(actor,id,version,values,action='save',cmd=crypto.randomUUID()){return(await as(actor,'select public.write_client_address($1,$2,$3,$4,$5)v',[id,cmd,version,action,values])).rows[0].v;}
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>!code||e.code===code);checks++;}
const id='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002',third='20000000-0000-4000-8000-000000000003';
const values={label:'Domicile QA',first_name:'Léa',last_name:'Martin',address:'12 rue de test QA',postal_code:'97200',city:'Fort-de-France',country_code:'MQ',latitude:null,longitude:null,geo_source:null,is_preferred:true};
const create=crypto.randomUUID();let r=await write('client',id,null,values,'save',create);ok(r.id===id&&r.user_id===ids.client&&r.version===1&&r.is_preferred,'private address created');
r=await write('client',id,null,values,'save',create);ok(r.version===1,'lost response replay');
ok((await db.query('select count(*)::int n from public.client_address_events')).rows[0].n===1,'no audit duplicate');
ok((await as('client','select count(*)::int n from public.client_addresses')).rows[0].n===1,'own read');
for(const actor of ['foreign','admin']){ok((await as(actor,'select count(*)::int n from public.client_addresses')).rows[0].n===0,'self-only even '+actor);ok((await as(actor,'select count(*)::int n from public.client_address_events')).rows[0].n===0,'audit self-only even '+actor);await denied(()=>write(actor,id,1,{...values,label:'Foreign'}),'P0002');await denied(()=>write(actor,id,null,values,'save',create),'P0001');}
await denied(()=>write('client',other,null,values),'23505'); // explicit preferred conflict; no silent replacement
await denied(()=>write('client',id,null,{...values,label:'Changed replay'},'save',create),'P0001');
await denied(()=>write('client',other,null,values,'save',create),'P0001');
for(const v of [{...values,first_name:''},{...values,last_name:'a'.repeat(101)},{...values,label:'bad\ncontrol'},{...values,address:'a'},{...values,city:''},{...values,country_code:'France'},{...values,postal_code:'bad!'},{...values,latitude:91,longitude:0,geo_source:'manual_pin'},{...values,latitude:14,longitude:null,geo_source:'manual_pin'},{...values,latitude:14,longitude:-61,geo_source:null},{...values,latitude:14,longitude:-61,geo_source:'verified_gps'},{...values,latitude:'14',longitude:-61,geo_source:'device_reported'},{...values,is_preferred:'true'},{...values,extra:true}])await denied(()=>write('client',other,null,v),'22023');
await denied(()=>write('client',other,null,null),'22023');
const geo={...values,latitude:14.61,longitude:-61.07,geo_source:'device_reported',is_preferred:false};const second=crypto.randomUUID();r=await write('client',other,null,geo,'save',second);ok(r.latitude===14.61&&r.longitude===-61.07&&r.geo_source==='device_reported','explicit declared geo saved no invented point');
const change=crypto.randomUUID();r=await write('client',id,1,{...values,label:'Version 2'},'save',change);ok(r.version===2,'versioned update');r=await write('client',id,1,{...values,label:'Version 2'},'save',change);ok(r.version===2,'lost update response replay');
await denied(()=>write('client',id,1,values),'P0001');await denied(()=>write('client',id,null,values,'save',create),'P0001');
const archive=crypto.randomUUID();r=await write('client',id,2,null,'archive',archive);ok(r.archived_at!==null&&!r.is_preferred&&r.version===3,'archive preserves history');r=await write('client',id,2,null,'archive',archive);ok(r.version===3,'archive replay');await denied(()=>write('client',id,3,values),'P0001');
r=await write('client',other,1,{...geo,is_preferred:true});ok(r.version===2&&r.is_preferred,'explicit new preferred after archive');
const foreign=await write('foreign',third,null,values);ok(foreign.user_id===ids.foreign&&foreign.is_preferred,'independent preference per user');
// Quota serialization executes under the same profile row lock as preference writes.
const generated=[];for(let n=0;n<49;n++){const a=crypto.randomUUID();generated.push(a);await write('client',a,null,{...values,label:'QA address '+n,is_preferred:false});}
ok((await as('client','select count(*)::int n from public.client_addresses where archived_at is null')).rows[0].n===50,'fifty active addresses reached');
const over=crypto.randomUUID();await denied(()=>write('client',over,null,{...values,is_preferred:false}),'P0001');
r=await write('client',other,null,geo,'save',second).catch(e=>e);ok(r.code==='P0001','old changed command does not bypass current persistence check at quota');
let existing=await write('client',generated[0],1,null,'archive');ok(existing.archived_at!==null,'archive frees exactly one slot');
r=await write('client',over,null,{...values,is_preferred:false});ok(r.version===1,'new address after archive');
const capReplay=crypto.randomUUID();r=await write('client',generated[1],1,{...values,label:'Still updateable at quota',is_preferred:false},'save',capReplay);ok(r.version===2,'updates remain allowed at fifty active');r=await write('client',generated[1],1,{...values,label:'Still updateable at quota',is_preferred:false},'save',capReplay);ok(r.version===2,'replay allowed at fifty');
for(const sql of ["update public.client_addresses set label='Injected' where id=$1",'delete from public.client_addresses where id=$1'])await denied(()=>as('client',sql,[other]),'42501');
await denied(()=>as('client',"insert into public.client_addresses(id,user_id,label,first_name,last_name,address,postal_code,city,country_code) values($1,$2,'A','B','C','QA full address','97200','QA city','MQ')",[crypto.randomUUID(),ids.client]),'42501');
await db.exec('set role anon');await denied(()=>db.query('select * from public.client_addresses'),'42501');await denied(()=>db.query("select public.write_client_address($1,$2,null,'save',$3)",[id,crypto.randomUUID(),values]),'42501');await db.exec('reset role');
await db.exec('set role service_role');await denied(()=>db.query('delete from public.client_addresses where id=$1',[other]),'42501');await denied(()=>db.query("select public.write_client_address($1,$2,null,'save',$3)",[id,crypto.randomUUID(),values]),'42501');await db.exec('reset role');
assert.deepEqual((await db.query('select id,full_name,phone from public.profiles order by id')).rows,before);checks++;
ok((await db.query('select fingerprint from public.client_address_events')).rows.every(r=>/^[0-9a-f]{64}$/.test(r.fingerprint)),'fingerprint audit no PII duplicate');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
