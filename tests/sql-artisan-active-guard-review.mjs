import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// Isolated PostgreSQL with explicit Auth/Storage stubs, not a real multi-session race proof.
import {readFile,readdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const{PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
const dir=new URL('../supabase/migrations/',import.meta.url);
for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec((await isolatedMigrationSql(db, name, await readFile(new URL(name,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- extension omitted only in local harness'));
console.log('PASS: all twelve migrations execute under isolated PostgreSQL/Auth/Storage stubs');
const ids={};let n=1;for(const actor of['client','artisan','otherArtisan','admin','manager']){ids[actor]=`50000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role:actor==='artisan'||actor==='otherArtisan'?'artisan':actor==='manager'?'manager':'client',full_name:actor}),`${actor.toLowerCase()}@example.invalid`]);}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function denied(promise,code){await assert.rejects(promise,error=>error.code===code)}
const save="select * from public.save_artisan_profile('Entreprise QA','12345678901234','EI',0,'12 rue du Test',array['97200'],array['panel'])";
async function approve(actor){await as(actor,'select public.submit_artisan_application()');await as('admin','select public.decide_artisan_application($1,\'approve\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0),gen_random_uuid())',[ids[actor]]);await as(actor,'select public.set_artisan_availability(true)');}
for(const actor of['artisan','otherArtisan']){await as(actor,save);await approve(actor);}
async function job(){return(await as('client',"select * from public.create_intervention('panel','Déclenchements électriques du tableau.','12 rue du Test','97200','Fort-de-France','urgent',null)")).rows[0].id;}
async function dossier(actor){return(await db.query('select to_jsonb(p) as profile,to_jsonb(a) as dossier from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=$1',[ids[actor]])).rows[0];}
const first=await job();await as('artisan',"select public.intervention_action($1,'accept_mission')",[first]);
const lines=JSON.stringify([{label:'Travail QA',quantity:1,unit_price_cents:10000}]);let quote;
for(const stage of['assigned','quoted','accepted','in_progress','completed']){
 if(stage==='quoted')await as('artisan',"select public.intervention_action($1,'send_quote',$2,20)",[first,lines]);
 if(stage==='accepted'){quote=(await db.query("select * from public.quotes where intervention_id=$1 and status='sent'",[first])).rows[0];await as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[first,quote.id]);}
 if(stage==='in_progress')await as('artisan',"select public.intervention_action($1,'start')",[first]);
 if(stage==='completed')await as('artisan',"select public.intervention_action($1,'complete')",[first]);
 const before=await dossier('artisan');await denied(as('artisan',save),'P0001');assert.deepEqual(await dossier('artisan'),before);assert.equal((await db.query('select status from public.interventions where id=$1',[first])).rows[0].status,stage);
}
console.log('PASS: assigned, quoted, accepted, in-progress and completed-unpaid block dossier edits without changing approval or any dossier field');
await as('artisan',"select public.update_profile('Contact QA modifié','0600000000')");await as('artisan','select public.set_artisan_availability(false)');
assert.equal((await db.query('select artisan_approved from public.profiles where id=$1',[ids.artisan])).rows[0].artisan_approved,true);
await db.query("insert into public.payments(quote_id,session_id,total_cents) values($1,'cs_active_guard_fixture',$2)",[quote.id,quote.total_cents]);
await db.exec('set role service_role');await db.query("select public.confirm_stripe_payment('evt_active_guard_fixture','checkout.session.completed','cs_active_guard_fixture',$1,$2,'eur')",[quote.id,quote.total_cents]);await db.exec('reset role');
await as('artisan',save);assert.equal((await dossier('artisan')).profile.artisan_approved,false);assert.equal((await dossier('artisan')).dossier.application_status,'draft');
assert.equal((await db.query('select status from public.interventions where id=$1',[first])).rows[0].status,'paid');
console.log('PASS: availability/contact remain separate and paid work releases dossier editing without weakening payment approval rules');
await approve('artisan');const cancelled=await job();await as('artisan',"select public.intervention_action($1,'accept_mission')",[cancelled]);
await denied(as('artisan',save),'P0001');await as('client',"select public.intervention_action($1,'cancel')",[cancelled]);await as('artisan',save);assert.equal((await dossier('artisan')).profile.artisan_approved,false);
await approve('artisan');const suspended=await job();await as('artisan',"select public.intervention_action($1,'accept_mission')",[suspended]);await as('admin','select public.decide_artisan_application($1,\'suspend\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0),gen_random_uuid())',[ids.artisan]);
const suspension=await dossier('artisan');await denied(as('artisan',save),'42501');assert.deepEqual(await dossier('artisan'),suspension);await denied(as('artisan','select public.set_artisan_availability(true)'),'42501');
await as('admin','select public.decide_artisan_application($1,\'reinstate\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0),gen_random_uuid())',[ids.artisan]);await as('artisan','select public.set_artisan_availability(true)');
await as('admin',"select public.reassign_intervention($1,$2,'Réaffectation QA protection dossier')",[suspended,ids.otherArtisan]);
const targetBefore=await dossier('otherArtisan');await denied(as('otherArtisan',save),'P0001');assert.deepEqual(await dossier('otherArtisan'),targetBefore);
await as('artisan',save);assert.equal((await dossier('artisan')).profile.artisan_approved,false);
console.log('PASS: cancellation/reassignment release old obligations, while explicit suspension remains prioritary and cannot be reset by self-edit');
const candidate=await job();
await denied(as('artisan',"select public.intervention_action($1,'accept_mission')",[candidate]),'42501');
await denied(as('admin',"select public.reassign_intervention($1,$2,'Cible non approuvée')",[candidate,ids.artisan]),'42501');
assert.equal((await db.query('select status from public.interventions where id=$1',[candidate])).rows[0].status,'requested');
await approve('artisan');await as('artisan',"select public.intervention_action($1,'accept_mission')",[candidate]);await denied(as('artisan',save),'P0001');
for(const actor of['client','manager','admin'])await denied(as(actor,save),'42501');
await denied(as('client',"select public.reassign_intervention($1,$2,'Opérateur usurpé')",[candidate,ids.otherArtisan]),'42501');
for(const actor of['artisan','admin']){
 await denied(as(actor,"select public.save_artisan_profile_before_active_work_guard('Bypass','12345678901234','EI',0,'12 rue du Test',array['97200'],array['panel'])"),'42501');
 await denied(as(actor,"select public.intervention_action_before_active_work_guard($1,'accept_mission')",[candidate]),'42501');
 await denied(as(actor,"select public.reassign_intervention_before_active_work_guard($1,$2,'Bypass')",[candidate,ids.otherArtisan]),'42501');
}
console.log('PASS: edit-first makes claim/reassignment ineligible, claim-first blocks edit, foreign roles and renamed helper bypasses remain denied');
const definitions={};for(const[alias,signature]of Object.entries({save:'public.save_artisan_profile(text,text,text,integer,text,text[],text[])',claim:'public.intervention_action(uuid,text,jsonb,numeric,uuid)',reassign:'public.reassign_intervention(uuid,uuid,text)'}))definitions[alias]=(await db.query('select pg_get_functiondef($1::regprocedure) as value',[signature])).rows[0].value;
assert.ok(!definitions.save.includes('for update'));assert.ok(definitions.save.indexOf('public.guard_artisan_self_edit()')<definitions.save.indexOf('from public.interventions'));
for(const alias of['claim','reassign']){const d=definitions[alias];const profileLock=alias==='claim'?d.indexOf('from public.profiles where id=auth.uid() for update'):d.indexOf("from public.profiles where id=p_artisan_id and role='artisan' for update");assert.ok(d.indexOf('public.lock_intervention_organization')<d.indexOf('from public.interventions where id=p_id for update'));assert.ok(d.indexOf('from public.interventions where id=p_id for update')<profileLock);assert.ok(profileLock<d.indexOf('from public.artisan_profiles'));}
assert.ok(definitions.reassign.indexOf('if not public.is_admin()')<definitions.reassign.indexOf('from public.profiles'));
console.log('PASS: source lock order is organization/job/profile/dossier; edit uses a non-locking job read and operator validation precedes another profile lock');
await db.close();
