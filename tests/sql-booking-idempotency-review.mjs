// Isolated PostgreSQL logic/RLS/ACL proof; Auth/Storage and native pg_cron are explicit stubs.
// PGlite is SINGLE-CONNECTION: queued Promise.all checks are NOT a live concurrent race proof.
// Use an already installed runtime via PGLITE_MODULE; no dependency installation is performed.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const deny=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),target='202611010021_booking_idempotency.sql';
 const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort();eq(files.length,20);
 for(const f of files)await db.exec((await isolatedMigrationSql(db,f,await readFile(new URL(f,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- TEST ONLY: pgcrypto omitted'));
 const untouched=['create_intervention(text,text,text,text,text,text,uuid)','create_intervention_before_site_access(text,text,text,text,text,text,uuid)','lock_site_access(uuid)','can_access_intervention(uuid)','consume_action(text,integer)'];
 const defs=async()=>Promise.all(untouched.map(async f=>(await db.query('select pg_get_functiondef($1::regprocedure) v',['public.'+f])).rows[0].v));
 const before=await defs(),sql=await readFile(new URL(target,dir),'utf8');await db.exec(sql);eq(await defs(),before);
 assert.doesNotMatch(sql,/create\s+or\s+replace|drop\s|alter\s+(?:function|policy)/i);checks++;
 const definition=(await db.query("select pg_get_functiondef('public.create_intervention_once(uuid,text,text,text,text,text,text,uuid)'::regprocedure) v")).rows[0].v;
 assert.ok(definition.indexOf('pg_advisory_xact_lock')<definition.indexOf('select * into kept'));checks++;
 eq((await db.query("select relrowsecurity v from pg_class where oid='public.intervention_request_keys'::regclass")).rows[0].v,true);
 for(const role of ['anon','authenticated','public'])for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])eq((await db.query("select has_table_privilege($1,'public.intervention_request_keys',$2) v",[role,p])).rows[0].v,false);
 for(const role of ['anon','authenticated','public','service_role'])eq((await db.query("select has_function_privilege($1,'public.create_intervention_once(uuid,text,text,text,text,text,text,uuid)','EXECUTE') v",[role])).rows[0].v,role==='authenticated');
 const ids=Object.fromEntries(['a','b','manager','owner','artisan','admin'].map(x=>[x,randomUUID()]));
 for(const [label,id]of Object.entries(ids))await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',[id,label+'@qa.invalid',JSON.stringify({role:['owner','manager'].includes(label)?'manager':label==='artisan'?'artisan':'client',full_name:'QA '+label})]);
 await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
 const as=async(actor,statement,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]||'']);try{return await db.query(statement,args)}finally{await db.exec('reset role')}};
 const once='select * from public.create_intervention_once($1,$2,$3,$4,$5,$6,$7,$8)';
 const payload=['socket','Prises sans courant dans le salon','Adresse technique QA','97200','Commune QA','scheduled',null];
 const call=(actor,key=randomUUID(),p=payload)=>as(actor,once,[key,...p]);
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const key=randomUUID(),first=(await call('a',key)).rows[0],again=(await call('a',key)).rows[0];eq(first.id,again.id);
 eq(await scalar('select count(*)::int v from public.interventions where client_id=$1',[ids.a]),1);
 eq(await scalar("select count(*)::int v from public.audit_log where intervention_id=$1 and action='created'",[first.id]),1);
 eq(await scalar("select count::int v from public.action_limits where actor_id=$1 and action='create_intervention'",[ids.a]),1);
 eq(first.estimate_min_cents,8000);eq(first.estimate_max_cents,18000);
 const padded=payload.map((v,i)=>typeof v==='string'&&i!==3?'  '+v+'  ':v);eq((await call('a',key,padded)).rows[0].id,first.id);
 const conflict=[...payload];conflict[1]='Autre description de panne';await deny(call('a',key,conflict),'P0001');
 eq(await scalar('select count(*)::int v from public.intervention_request_keys where actor_id=$1',[ids.a]),1);
 // Concurrently submitted calls queue in this single connection. Advisory/PK source contracts above
 // and this result cover duplicate scheduling; ROOT must prove real concurrent HTTP separately.
 const queuedKey=randomUUID();await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.a]);
 let queued;try{queued=await Promise.all([db.query(once,[queuedKey,...payload]),db.query(once,[queuedKey,...payload])])}finally{await db.exec('reset role')}
 eq(queued[0].rows[0].id,queued[1].rows[0].id);
 eq(await scalar("select count(*)::int v from public.audit_log where actor_id=$1 and action='created'",[ids.a]),2);
 const b=(await call('b',key)).rows[0];assert.notEqual(b.id,first.id);checks++;eq(b.client_id,ids.b);eq((await as('b','select id from public.interventions where id=$1',[first.id])).rows.length,0);
 // Replay returns current state, not the originally stored response.
 await db.query("update public.interventions set status='cancelled',city='Commune actualisée' where id=$1",[first.id]);
 const current=(await call('a',key)).rows[0];eq(current.status,'cancelled');eq(current.city,'Commune actualisée');
 await db.query("update public.profiles set role='artisan' where id=$1",[ids.a]);await deny(call('a',key),'42501');await db.query("update public.profiles set role='client' where id=$1",[ids.a]);
 await deny(call('artisan',randomUUID()),'42501');await deny(call('',randomUUID()),'42501');await deny(call('a',null),'22023');
 // Direct table access is forbidden even to an authenticated actor who owns the request key.
 await deny(as('a','select * from public.intervention_request_keys'),'42501');
 await deny(as('a','delete from public.intervention_request_keys'),'42501');
 await db.exec('set role anon');try{await deny(db.query(once,[key,...payload]),'42501')}finally{await db.exec('reset role')}
 // Payload failure rolls back creation, quota and ledger together.
 const invalid=[...payload];invalid[1]='x';const badKey=randomUUID();await deny(call('b',badKey,invalid),'23514');
 eq(await scalar('select count(*)::int v from public.intervention_request_keys where actor_id=$1 and request_id=$2',[ids.b,badKey]),0);
 eq(await scalar("select count::int v from public.action_limits where actor_id=$1 and action='create_intervention'",[ids.b]),1);
 // Replay consumes no further quota, even after new creations exhaust the five-per-minute limit.
 for(let i=0;i<3;i++)await call('a');
 await deny(call('a'),'53300');eq((await call('a',key)).rows[0].id,first.id);
 eq(await scalar("select count::int v from public.action_limits where actor_id=$1 and action='create_intervention'",[ids.a]),5);
 const org=randomUUID(),site=randomUUID(),secondSite=randomUUID();
 await db.query("insert into public.organizations(id,name,owner_id) values($1,'QA organisation',$2)",[org,ids.owner]);
 await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'manager')",[org,ids.owner,ids.manager]);
 await db.query("insert into public.sites(id,organization_id,name,type,address) values($1,$3,'QA site A','office','Adresse QA'),($2,$3,'QA site B','office','Adresse QA')",[site,secondSite,org]);
 await db.query("insert into public.organization_member_site_scopes values($1,$2,'selected')",[org,ids.manager]);
 await db.query('insert into public.organization_member_site_grants values($1,$2,$3,true),($1,$2,$4,false)',[org,ids.manager,site,secondSite]);
 const sitePayload=[...payload];sitePayload[6]=site;const siteKey=randomUUID(),siteJob=(await call('manager',siteKey,sitePayload)).rows[0];
 await db.query('update public.organization_member_site_grants set can_write=false where site_id=$1 and user_id=$2',[site,ids.manager]);
 eq((await as('manager','select public.can_access_intervention($1) v',[siteJob.id])).rows[0].v,true);
 await deny(call('manager',siteKey,sitePayload),'42501');
 await db.query('update public.organization_member_site_grants set can_write=true where site_id=$1 and user_id=$2',[site,ids.manager]);
 // Current site write scope is checked too, even when the original payload site remains writable.
 await db.query('update public.interventions set site_id=$1 where id=$2',[secondSite,siteJob.id]);await deny(call('manager',siteKey,sitePayload),'42501');
 await db.query('update public.interventions set site_id=$1 where id=$2',[site,siteJob.id]);
 await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.manager]);await deny(call('manager',siteKey,sitePayload),'42501');
 // Ownership changed while a key still exists: an old creator cannot replay another client's row.
 await db.query('update public.interventions set client_id=$1 where id=$2',[ids.b,first.id]);await deny(call('a',key),'42501');
 const admin=(await call('admin')).rows[0];eq(admin.client_id,ids.admin);
 const legacy=(await as('b','select * from public.create_intervention($1,$2,$3,$4,$5,$6,$7)',payload)).rows[0];eq(legacy.client_id,ids.b);
 eq(await scalar('select count(*)::int v from public.intervention_request_keys where intervention_id=$1',[legacy.id]),0);
 // Both required cascade links are real constraints, exercised with safe local fixtures.
 await db.query('delete from public.audit_log where intervention_id=$1',[b.id]);await db.query('delete from public.interventions where id=$1',[b.id]);
 eq(await scalar('select count(*)::int v from public.intervention_request_keys where actor_id=$1 and request_id=$2',[ids.b,key]),0);
 const authOnly=randomUUID(),fakeKey=randomUUID();await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'cascade@qa.invalid','{}')",[authOnly]);
 await db.query("insert into public.intervention_request_keys(actor_id,request_id,payload,intervention_id) values($1,$2,'{}',$3)",[authOnly,fakeKey,first.id]);await db.query('delete from auth.users where id=$1',[authOnly]);
 eq(await scalar('select count(*)::int v from public.intervention_request_keys where actor_id=$1',[authOnly]),0);
 console.log(JSON.stringify({sql:'PASS',checks,migrations:21,auth_storage_cron:'STUBS',single_connection:true,real_concurrency_proved:false}));
}finally{await db.close()}
