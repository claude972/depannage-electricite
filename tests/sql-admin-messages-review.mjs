import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ADM-07 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
const ids={admin:'10000000-0000-4000-8000-000000000001',client:'10000000-0000-4000-8000-000000000002',other:'10000000-0000-4000-8000-000000000003'};
for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:'client',full_name:'QA '+name}),name+'@example.invalid']);
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
const job=(await db.query("insert into public.interventions(client_id,category,urgency,description,address,city,postal_code,estimate_min_cents,estimate_max_cents)values($1,'socket','scheduled','QA issue fixture','QA address','QA city','97200',10000,20000)returning id",[ids.client])).rows[0].id;
async function as(actor,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function send(actor,id,body='Support reply',target=job){return(await as(actor,'select to_jsonb(public.admin_send_message($1,$2,$3))v',[id,target,body])).rows[0].v;}
function ok(value,label){assert.ok(value,label);checks++;}
async function denied(fn,code){await assert.rejects(fn,e=>!code||e.code===code);checks++;}
const id='20000000-0000-4000-8000-000000000001';
for(const actor of ['client','other'])await denied(()=>send(actor,id),'42501');
let r=await send('admin',id,'  Support reply  ');ok(r.id===id&&r.body==='Support reply'&&r.author_id===ids.admin,'exact attributed reply');
r=await send('admin',id);ok(r.id===id,'same retry');
ok((await db.query('select count(*)::int n from public.messages')).rows[0].n===1,'no duplicate message');
ok((await db.query("select count(*)::int n from public.audit_log where action=$1",['admin_message:'+id])).rows[0].n===1,'one audit without body');
await denied(()=>send('admin',id,'Changed'),'P0001');
await denied(()=>send('admin','20000000-0000-4000-8000-000000000002','  '),'22023');
await denied(()=>send('admin','20000000-0000-4000-8000-000000000002','x'.repeat(4001)),'22023');
await denied(()=>send('admin','20000000-0000-4000-8000-000000000002','test','20000000-0000-4000-8000-000000000099'),'P0002');
ok((await as('client','select count(*)::int n from public.messages')).rows[0].n===1,'requester reads reply');
ok((await as('other','select count(*)::int n from public.messages')).rows[0].n===0,'unrelated reader denied');
await denied(()=>as('admin',"insert into public.messages(intervention_id,author_id,body)values($1,$2,'direct')",[job,ids.admin]),'42501');
await as('admin','select public.send_message($1,$2)',[job,'Legacy caller audited']);ok((await db.query("select count(*)::int n from public.audit_log where action like 'admin_message:%'")).rows[0].n===2,'old command also audited');
await db.query("update public.profiles set role='admin' where id=$1",[ids.other]);await db.query("update public.profiles set role='client' where id=$1",[ids.admin]);await denied(()=>send('admin',id),'42501');
await db.exec('set role anon');await denied(()=>db.query('select public.admin_send_message($1,$2,$3)',[id,job,'test']),'42501');await db.exec('reset role');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
