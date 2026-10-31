process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// NATIVE-DOCUMENT-GATEWAY-001: isolated PostgreSQL review of migration 013 (finalize_document_upload).
// Auth/Storage are explicit stubs; the gateway's server-side object write is simulated by a direct
// insert into the storage.objects stub. This is not a live Supabase or network-concurrency test.
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
const target='202610310013_document_finalization.sql';
assert.ok(files.includes(target));
const before=files.filter(n=>n<target);
for(const name of before)await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists pgcrypto;','-- extension omitted only in local harness'));
// Snapshot of the helpers and policies 013 must leave untouched.
const helpers=['is_admin()','owns_intervention(uuid)','can_access_intervention(uuid)','can_access_site(uuid)','can_manage_site(uuid)','is_org_member(uuid,boolean)','lock_intervention_organization(uuid)'];
async function snapshot(){
 const defs={};
 for(const h of helpers)defs[h]=(await db.query(`select pg_get_functiondef('public.${h}'::regprocedure) v`)).rows[0].v;
 const policies=(await db.query("select schemaname,tablename,policyname,cmd,roles::text,qual,with_check from pg_policies where (schemaname='public' and tablename='documents') or (schemaname='storage' and tablename='objects') order by 1,2,3")).rows;
 const grants=(await db.query("select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='documents' order by 1,2")).rows;
 const bucket=(await db.query("select * from storage.buckets where id='intervention-documents'")).rows;
 return JSON.stringify({defs,policies,grants,bucket});
}
const snapshotBefore=await snapshot();
const source=await readFile(new URL(target,dir),'utf8');
await db.exec(source.replace('create extension if not exists pgcrypto;','-- extension omitted only in local harness'));
console.log(`PASS: ${files.length} migrations execute under isolated PostgreSQL with Auth/Storage stubs`);
assert.equal(await snapshot(),snapshotBefore);
assert.doesNotMatch(source,/create\s+or\s+replace\s+function/i);
assert.doesNotMatch(source,/create\s+policy|drop\s+policy|alter\s+policy|alter\s+table|storage\.buckets/i);
assert.match(source,/security definer/i);
assert.ok(source.indexOf('lock_intervention_organization(p_intervention_id)')<source.indexOf('for share'),'organisation lock precedes the dossier lock');
assert.doesNotMatch(source,/for update/i,'no exclusive lock on dossiers or profiles');
assert.doesNotMatch(source,/public\.profiles[^;]*for /i,'no profile lock');
assert.ok(source.includes("set search_path=''"));
console.log('PASS: 013 is additive; helpers, documents/storage policies, grants and bucket are byte-identical before and after');
for(const role of['anon','authenticated','public'])assert.equal((await db.query("select has_function_privilege($1,'public.finalize_document_upload(uuid,text,text,text,uuid)','execute') v",[role])).rows[0].v,role==='authenticated');
const ids={};let i=1;
for(const actor of['client','other','manager','viewer','selected','artisan','otherArtisan','admin']){
 ids[actor]=`50000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 const role=actor==='artisan'||actor==='otherArtisan'?'artisan':actor==='manager'||actor==='viewer'||actor==='selected'?'manager':'client';
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role,full_name:actor}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function scalar(actor,sql,params=[]){return(await as(actor,sql,params)).rows[0].v}
async function denied(promise,code){await assert.rejects(promise,error=>error.code===code||(console.error('unexpected code',error.code,error.message),false))}
let seq=0;
const newId=()=>`60000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
// The gateway writes the object with its server key before calling the RPC; simulate that write.
async function putObject(path){await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents',$1)",[path])}
const finalize='select * from public.finalize_document_upload($1,$2,$3,$4,$5)';
async function attempt(actor,{id=newId(),owner=actor,name='photo.jpg',mime='image/jpeg',intervention=null,path,stored=true}={}){
 const objectPath=path??`${ids[owner]}/${id}`;
 if(stored)await putObject(objectPath);
 return{id,path:objectPath,run:()=>as(actor,finalize,[id,objectPath,name,mime,intervention])};
}
async function documentsCount(where,params){return(await db.query(`select count(*)::int v from public.documents where ${where}`,params)).rows[0].v}
// Anonymous and tampered paths.
{const a=await attempt('client');await db.exec('set role anon');await assert.rejects(db.query(finalize,[a.id,a.path,'photo.jpg','image/jpeg',null]));await db.exec('reset role');}
{const a=await attempt('client',{owner:'other'});await denied(a.run(),'42501');}
{const a=await attempt('client');await denied(as('client',finalize,[newId(),a.path,'photo.jpg','image/jpeg',null]),'42501');}
{const a=await attempt('client',{path:`${ids.client}/../${ids.other}/x`});await denied(a.run(),'42501');}
assert.equal(await documentsCount('true',[]),0);
console.log('PASS: anonymous, foreign owner path, mismatched id and traversal-like paths are refused without metadata');
// Object must really exist; MIME and name are validated.
{const a=await attempt('client',{stored:false});await denied(a.run(),'P0002');}
{const a=await attempt('client',{mime:'image/gif'});await denied(a.run(),'22023');}
{const a=await attempt('client',{mime:'text/html'});await denied(a.run(),'22023');}
{const a=await attempt('client',{name:''});await denied(a.run(),'22023');}
{const a=await attempt('client',{name:'x'.repeat(161)});await denied(a.run(),'22023');}
assert.equal(await documentsCount('true',[]),0);
console.log('PASS: missing object, disallowed MIME and invalid names are refused');
// Personal document (no dossier): any authenticated user, visible to the owner only.
const personal=await attempt('artisan',{name:'kbis.pdf',mime:'application/pdf'});
const personalRow=(await personal.run()).rows[0];
assert.equal(personalRow.owner_id,ids.artisan);assert.equal(personalRow.intervention_id,null);assert.equal(personalRow.path,personal.path);assert.equal(personalRow.mime_type,'application/pdf');
assert.equal(await scalar('artisan','select count(*)::int v from public.documents where id=$1',[personal.id]),1);
for(const actor of['client','other','manager','otherArtisan'])assert.equal(await scalar(actor,'select count(*)::int v from public.documents where id=$1',[personal.id]),0);
assert.equal(await scalar('admin','select count(*)::int v from public.documents where id=$1',[personal.id]),1);
assert.equal(await scalar('artisan','select count(*)::int v from storage.objects where name=$1',[personal.path]),1);
assert.equal(await scalar('other','select count(*)::int v from storage.objects where name=$1',[personal.path]),0);
await as('artisan',"select public.link_artisan_credential($1,'registration',null)",[personal.id]);
await denied(as('otherArtisan',"select public.link_artisan_credential($1,'registration',null)",[personal.id]),'42501');
console.log('PASS: personal document finalized, readable by owner/admin only, artisan credential path preserved');
{await denied(as('artisan',finalize,[personal.id,personal.path,'again.pdf','application/pdf',null]),'23505');}
console.log('PASS: re-finalizing the same id/path is a conflict, never a duplicate');
// Client dossier with an assigned artisan.
for(const name of['artisan','otherArtisan']){
 await as(name,"select public.save_artisan_profile('Entreprise test','12345678901234','EI',0,'12 rue de test',array['97200'],array['outage','panel','socket','lighting','diagnostic'])");
 await as(name,'select public.submit_artisan_application()');
 await as(name,'select public.set_artisan_availability(true)');
 await as('admin','select public.approve_artisan($1,true)',[ids[name]]);
}
const job=(await as('client',"select * from public.create_intervention('panel','Le disjoncteur se déclenche régulièrement.','12 rue de test','97200','Fort-de-France','urgent',null)")).rows[0];
await as('artisan',"select public.intervention_action($1,'accept_mission')",[job.id]);
{const a=await attempt('client',{intervention:job.id});const r=(await a.run()).rows[0];assert.equal(r.intervention_id,job.id);assert.equal(r.owner_id,ids.client);}
{const a=await attempt('artisan',{intervention:job.id});assert.equal((await a.run()).rows[0].owner_id,ids.artisan);}
{const a=await attempt('admin',{intervention:job.id});assert.equal((await a.run()).rows[0].owner_id,ids.admin);}
for(const actor of['other','otherArtisan','manager']){const a=await attempt(actor,{intervention:job.id});await denied(a.run(),'42501');}
{const unknown=await attempt('client',{intervention:'70000000-0000-4000-8000-000000000001'});await denied(unknown.run(),'42501');}
assert.equal(await documentsCount('intervention_id=$1',[job.id]),3);
assert.equal(await scalar('artisan','select count(*)::int v from public.documents where intervention_id=$1',[job.id]),3);
assert.equal(await scalar('other','select count(*)::int v from public.documents where intervention_id=$1',[job.id]),0);
console.log('PASS: client owner, assigned artisan and admin attach; third parties, other artisans and unknown dossiers refused');
// Reassignment before finalization: the former artisan's object never becomes a document.
const late=await attempt('artisan',{intervention:job.id});
await as('admin',"select public.reassign_intervention($1,$2,'Réaffectation de contrôle')",[job.id,ids.otherArtisan]);
await denied(late.run(),'42501');
{const a=await attempt('otherArtisan',{intervention:job.id});assert.equal((await a.run()).rows[0].owner_id,ids.otherArtisan);}
assert.equal(await documentsCount('path=$1',[late.path]),0);
console.log('PASS: artisan reassigned before finalization cannot attach; the new artisan can');
// Organisation dossier: manager writes, viewer and scoped member without grant do not; revoked member refused.
const site=(await as('manager',"select * from public.create_site('Site test','office','12 rue des bureaux',100000,null)")).rows[0];
await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer'),($1,$3,'manager')",[site.organization_id,ids.viewer,ids.selected]);
await db.query("insert into public.organization_member_site_scopes values($1,$2,'selected')",[site.organization_id,ids.selected]);
const siteJob=(await as('manager',"select * from public.create_intervention('panel','Le tableau du bureau est en panne.','12 rue des bureaux','97200','Fort-de-France','urgent',$1)",[site.id])).rows[0];
assert.equal(await scalar('viewer','select count(*)::int v from public.interventions where id=$1',[siteJob.id]),1,'viewer can read the dossier');
{const a=await attempt('manager',{intervention:siteJob.id});assert.equal((await a.run()).rows[0].owner_id,ids.manager);}
{const a=await attempt('viewer',{intervention:siteJob.id});await denied(a.run(),'42501');}
{const a=await attempt('selected',{intervention:siteJob.id});await denied(a.run(),'42501');}
await db.query("insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write) values($1,$2,$3,true)",[site.organization_id,ids.selected,site.id]);
{const a=await attempt('selected',{intervention:siteJob.id});assert.equal((await a.run()).rows[0].owner_id,ids.selected);}
await db.query("update public.organization_member_site_grants set can_write=false where user_id=$1",[ids.selected]);
{const a=await attempt('selected',{intervention:siteJob.id});await denied(a.run(),'42501');}
// Membership withdrawn after the object was written but before finalization.
const withdrawn=await attempt('selected',{intervention:siteJob.id});
await db.query("delete from public.organization_members where organization_id=$1 and user_id=$2",[site.organization_id,ids.selected]);
await denied(withdrawn.run(),'42501');
assert.equal(await documentsCount('path=$1',[withdrawn.path]),0);
assert.equal(await scalar('selected','select count(*)::int v from public.documents where intervention_id=$1',[siteJob.id]),0);
console.log('PASS: viewer, scoped member without write grant and withdrawn member refused; manager and granted member attach');
// No direct writes by API roles; objects without metadata stay invisible.
await denied(as('client',"insert into public.documents(id,owner_id,name,path,mime_type) values(gen_random_uuid(),auth.uid(),'x','y','image/png')"),'42501');
await denied(as('admin','delete from public.documents'),'42501');
assert.equal(await scalar('selected','select count(*)::int v from storage.objects where name=$1',[withdrawn.path]),0,'orphan object is unreadable');
console.log('PASS: no direct metadata writes for API roles; an orphan object is unreadable until compensated');
console.log('ALL PASS: finalize_document_upload isolated review (sequential withdrawals; not a network concurrency proof)');
