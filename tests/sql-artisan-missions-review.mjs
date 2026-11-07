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

let checks=0;const actor=crypto.randomUUID(),client=crypto.randomUUID(),other=crypto.randomUUID();
for(const[id,role]of [[actor,'artisan'],[client,'client'],[other,'artisan']])await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role,full_name:'QA '+role}),id+'@example.invalid']);
for(const id of [actor,other]){await db.query('update public.profiles set artisan_approved=true where id=$1',[id]);await db.query("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)values($1,'QA entreprise','00000000000000','QA adresse',array['97200'],array['socket'],'approved',true)",[id]);}
const ids=[];for(let n=0;n<135;n++){const id=crypto.randomUUID();ids.push(id);await db.query("insert into public.interventions(id,client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,created_at)values($1,$2,'socket','QA description synthétique','QA adresse privée','97200','QA ville','scheduled',100,200,'2026-11-06T12:00:00Z')",[id,client]);}
await db.query("insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)values($1,'panel','QA description synthétique','QA adresse privée','97200','QA ville','scheduled',100,200),($1,'socket','QA description synthétique','QA adresse privée','75000','QA ville','scheduled',100,200)",[client]);
async function page(uid,at=null,id=null){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);try{return(await db.query('select public.available_missions_page($1,$2)v',[at,id])).rows[0].v;}finally{await db.exec('reset role');}}
const ok=(v,m)=>{assert.ok(v,m);checks++;};let cursor=null,seen=[];for(let n=0;n<4;n++){const p=await page(actor,cursor?.created_at??null,cursor?.id??null);ok(p.eligible,'approved available artisan');ok(p.items.length<=51,'bounded RPC projection');const batch=p.items.slice(0,50);for(const r of batch){ok(r.postal_code==='972**'&&r.address===undefined&&r.client_id===undefined&&r.artisan_id===undefined,'anonymized only');seen.push(r.id);}cursor=batch.at(-1);if(p.items.length<=50)break;}
ok(seen.length===135&&new Set(seen).size===135,'all135 offers after pagination, no duplicates');ok(ids.every(id=>seen.includes(id)),'no eligible offer lost beyond100');
await assert.rejects(()=>page(client),e=>e.code==='42501');checks++;await assert.rejects(()=>page('',null,null),e=>e.code==='42501');checks++;await assert.rejects(()=>page(actor,null,ids[0]),e=>e.code==='22023');checks++;
await db.query('update public.artisan_profiles set available=false where user_id=$1',[actor]);let p=await page(actor);ok(!p.eligible&&p.items.length===0,'paused no offers');await db.query("update public.artisan_profiles set available=true,application_status='suspended'where user_id=$1",[actor]);p=await page(actor);ok(!p.eligible&&p.items.length===0,'suspended no offers');await db.query("update public.artisan_profiles set application_status='approved'where user_id=$1",[actor]);await db.query("insert into public.mission_declines(intervention_id,artisan_id,reason)values($1,$2,'QA refus')",[ids[0],actor]);let all=[];cursor=null;for(let n=0;n<4;n++){p=await page(actor,cursor?.created_at??null,cursor?.id??null);const batch=p.items.slice(0,50);all.push(...batch.map(r=>r.id));cursor=batch.at(-1);if(p.items.length<=50)break;}ok(all.length===134&&!all.includes(ids[0]),'declined offers excluded');
await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);ok((await db.query('select count(*)::int n from public.interventions')).rows[0].n===0,'unassigned feed never grants private intervention reads');await db.exec('reset role');
ok(!(await db.query("select has_function_privilege('anon','public.available_missions_page(timestamptz,uuid,uuid)','execute')v")).rows[0].v,'anon cannot execute');
await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);let selected=(await db.query('select public.available_missions_page(null,null,$1)v',[ids[130]])).rows[0].v;ok(selected.items.length===1&&selected.items[0].id===ids[130],'selected eligible offer beyond100');selected=(await db.query('select public.available_missions_page(null,null,$1)v',[ids[0]])).rows[0].v;ok(selected.items.length===0,'selected declined hidden');await db.exec('reset role');
for(const count of [49,50,51]){await db.query("update public.interventions set status=case when id=any($1::uuid[])then 'requested'else 'cancelled'end",[ids.slice(1,count+1)]);ok((await page(actor)).items.length===count,'exact RPC boundary '+count);}
await db.close();console.log(JSON.stringify({sql:'PASS',checks,auth_storage_cron:'SIMULATED',offers:135,concurrency_cloud_proof:false}));
