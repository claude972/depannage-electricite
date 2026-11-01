// Pending recovery, actual migrations001–023 in isolated PGlite. Auth/Storage/cron stubs only.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const denied=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),target='202611010022_guest_booking.sql';const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort();eq(files.length,21);
 for(const f of files)await db.exec((await isolatedMigrationSql(db,f,await readFile(new URL(f,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- TEST ONLY extension omitted'));
 const defs=async()=>Promise.all(['create_intervention(text,text,text,text,text,text,uuid)','create_intervention_once(uuid,text,text,text,text,text,text,uuid)','can_access_intervention(uuid)'].map(async f=>(await db.query('select pg_get_functiondef($1::regprocedure) v',['public.'+f])).rows[0].v));
 const before=await defs();await db.exec(await readFile(new URL(target,dir),'utf8'));eq(await defs(),before);
 const pendingBefore=(await db.query("select pg_get_functiondef('public.prepare_phone_booking(uuid,jsonb,jsonb,text)'::regprocedure) v")).rows[0].v;
 await db.exec(await readFile(new URL('202611010023_pending_booking.sql',dir),'utf8'));
 eq((await db.query("select pg_get_functiondef('public.prepare_phone_booking(uuid,jsonb,jsonb,text)'::regprocedure) v")).rows[0].v,pendingBefore);
 const actors={};for(const label of ['a','b','phone','unverified','artisan','onsite']){const id=randomUUID();actors[label]=id;await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at,phone,phone_confirmed_at) values($1,$2,$3,$4,$5,$6)',[id,JSON.stringify({role:label==='artisan'?'artisan':'client',full_name:'QA pending '+label}),'qa@example.invalid',['unverified','phone'].includes(label)?null:'2026-11-01T00:00:00Z','596696000000',label==='phone'?'2026-11-01T00:00:00Z':null])}
 const as=async(label,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actors[label]||'']);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne synthétique QA de récupération',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune synthétique QA',urgency:'scheduled'};
 const contact={first_name:'QA',last_name:'Essai',email:'',phone:'+596696000000'};
 const prepare=(label,key,method='card_hold')=>as(label,'select public.prepare_phone_booking($1,$2,$3,$4) v',[key,JSON.stringify(payload),JSON.stringify(contact),method]);
 const pending=async label=>(await as(label,'select public.guest_booking_pending() v')).rows[0].v;
 for(const role of ['public','anon','authenticated','service_role'])eq(await scalar("select has_function_privilege($1,'public.guest_booking_pending()','EXECUTE') v",[role]),role==='authenticated');
 for(const role of ['anon','authenticated'])eq(await scalar("select has_table_privilege($1,'public.phone_booking_requests','SELECT') v",[role]),false);
 eq(await pending('a'),{pending:null});const key=randomUUID();await prepare('a',key);
 const restored=(await pending('a')).pending;eq(restored.request_id,key);eq(restored.method,'card_hold');eq(restored.status,'prepared');eq(restored.expected_max_cents,18000);eq(typeof restored.created_at,'string');eq(Object.keys(restored).sort(),['request_id','method','status','expected_max_cents','created_at'].sort());
 eq(await pending('b'),{pending:null});const bkey=randomUUID();await prepare('b',bkey);eq((await pending('b')).pending.request_id,bkey);eq((await pending('a')).pending.request_id,key);
 for(const status of ['checkout_open','authorized','cancelling']){await db.query('update public.phone_booking_requests set status=$1 where actor_id=$2',[status,actors.a]);eq((await pending('a')).pending.status,status)}
 const phoneKey=randomUUID();await prepare('phone',phoneKey);eq((await pending('phone')).pending.request_id,phoneKey);
 for(const actor of ['unverified','artisan',''])await denied(pending(actor),'42501');
 await db.query("update public.profiles set role='artisan' where id=$1",[actors.a]);await denied(pending('a'),'42501');await db.query("update public.profiles set role='client' where id=$1",[actors.a]);
 const duplicate=randomUUID();await db.query("insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified) select actor_id,$1,payload,contact,method,expected_max_cents,phone_verified from public.phone_booking_requests where actor_id=$2",[duplicate,actors.a]);await denied(pending('a'),'55000');await db.query('delete from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actors.a,duplicate]);
 await prepare('onsite',randomUUID(),'on_site');await denied(pending('onsite'),'55000');
 await db.query("update public.phone_booking_requests set status='cancelled' where actor_id=$1",[actors.a]);eq(await pending('a'),{pending:null});
 const confirmedKey=randomUUID();await as('a','select public.create_on_site_booking($1,$2,$3)',[confirmedKey,JSON.stringify(payload),JSON.stringify(contact)]);eq(await pending('a'),{pending:null});
 const beforeRead=await scalar("select jsonb_agg(to_jsonb(b) order by request_id) v from public.phone_booking_requests b where actor_id=$1",[actors.b]);await pending('b');eq(await scalar("select jsonb_agg(to_jsonb(b) order by request_id) v from public.phone_booking_requests b where actor_id=$1",[actors.b]),beforeRead);
 eq(await scalar('select count(*)::int v from public.interventions'),1);
 console.log(JSON.stringify({sql:'PASS',checks,migrations:23,runtime:'PGlite0.5.4',auth_storage_cron:'STUBS',provider:'NONE',reads_only_recovery:true}));
}finally{await db.close()}
