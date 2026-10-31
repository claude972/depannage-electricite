import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// Isolated PostgreSQL verification, not live Supabase: Auth and Storage are explicit stubs.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
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
console.log('PASS: all migrations execute in isolated PostgreSQL with explicit Auth/Storage stubs');
import { createHash } from 'node:crypto';
const ids={};let n=1;
for(const actor of ['owner','global','writer','reader','viewer','outside','otherOwner','invitee','staleInvitee','artisan','admin']){
 ids[actor]=`10000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role:actor==='artisan'?'artisan':'manager',full_name:actor}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
await db.query("update public.profiles set artisan_approved=true where id=$1",[ids.artisan]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function scalar(actor,sql,params=[]){return (await as(actor,sql,params)).rows[0].v}
const org=(await db.query('insert into public.organizations(name,owner_id) values(\'Test organization\',$1) returning id',[ids.owner])).rows[0].id;
const otherOrg=(await db.query('insert into public.organizations(name,owner_id) values(\'Other organization\',$1) returning id',[ids.otherOwner])).rows[0].id;
for(const actor of ['owner','global','writer','reader','viewer'])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[actor],actor==='owner'?'owner':actor==='viewer'?'viewer':'manager']);
await db.query("insert into public.organization_members values($1,$2,'owner')",[otherOrg,ids.otherOwner]);
async function site(o,name){return (await db.query("insert into public.sites(organization_id,name,type,address,budget_cents) values($1,$2,'office','Fixture address',10000) returning id",[o,name])).rows[0].id}
const a=await site(org,'Site A'),b=await site(org,'Site B'),c=await site(otherOrg,'Other A'),d=await site(otherOrg,'Other B');
const set='select public.set_organization_member_site_access($1,$2,$3,$4)';
const grant=(site_id,can_write)=>({site_id,can_write});
for(const [actor,write] of [['writer',true],['reader',false],['viewer',false]])await as('owner',set,[org,ids[actor],'selected',JSON.stringify([grant(a,write)])]);
assert.equal(await scalar('owner','select count(*)::int v from public.sites'),2);
assert.equal(await scalar('global','select count(*)::int v from public.sites'),2);
assert.equal(await scalar('writer','select count(*)::int v from public.sites'),1);
assert.equal(await scalar('reader','select public.can_manage_site($1) v',[a]),false);
assert.equal(await scalar('writer','select public.can_manage_site($1) v',[a]),true);
assert.equal(await scalar('viewer','select public.can_manage_site($1) v',[a]),false);
assert.equal(await scalar('outside','select count(*)::int v from public.sites'),0);
assert.equal(await scalar('otherOwner','select count(*)::int v from public.sites'),2);
assert.equal(await scalar('admin','select count(*)::int v from public.sites'),4);
console.log('PASS: default ALL, owner, selected read/write, viewer, platform admin and cross-organization isolation');
for(const actor of ['writer','reader','viewer','outside','admin'])await assert.rejects(()=>as(actor,set,[org,ids.global,'selected',JSON.stringify([])]));
await assert.rejects(()=>as('owner',set,[org,ids.owner,'selected',JSON.stringify([])]));
await assert.rejects(()=>as('owner',set,[org,ids.writer,'selected',JSON.stringify([grant(c,true)])]));
await assert.rejects(()=>as('owner',set,[org,ids.viewer,'selected',JSON.stringify([grant(a,true)])]));
for(const grants of [[grant(a,true),grant(a,false)],[{site_id:a,can_write:'true'}],[{site_id:a,can_write:true,extra:1}],[{site_id:'bad',can_write:false}]])await assert.rejects(()=>as('owner',set,[org,ids.writer,'selected',JSON.stringify(grants)]));
await assert.rejects(()=>as('owner',set,[org,ids.writer,'all',JSON.stringify([grant(a,true)])]));
assert.equal(await scalar('writer','select public.can_manage_site($1) v',[a]),true);
await assert.rejects(()=>as('writer','insert into public.organization_member_site_scopes values($1,$2,\'all\')',[org,ids.writer]));
await assert.rejects(()=>as('writer','update public.organization_member_site_grants set can_write=true'));
assert.equal(await scalar('writer','select count(*)::int v from public.organization_member_site_scopes'),1);
await assert.rejects(()=>as('writer','select public.can_access_site($1,$2)',[b,ids.owner]));
console.log('PASS: only canonical owner changes access; strict grants, no owner restriction, direct mutation or actor spoofing');
async function fixture(siteId){
 const job=(await db.query("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status) values($1,$2,$3,'panel','Electrical fixture description','Fixture address','97200','Test city','scheduled',100,200,'quoted') returning id",[ids.writer,ids.artisan,siteId])).rows[0].id;
 const quote=(await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status) values($1,$2,'[{"label":"Fixture","quantity":1,"unit_price_cents":100}]',100,0,0,100,'sent') returning id`,[job,ids.artisan])).rows[0].id;
 await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status) values($1,$2,100,'eur','pending')",[quote,`fixture_${job}`]);
 await db.query("insert into public.documents(intervention_id,owner_id,name,path,mime_type) values($1::uuid,$2,'Fixture','fixture/'||$1::text,'application/pdf')",[job,ids.writer]);
 await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents','fixture/'||$1::text)",[job]);
 await db.query("insert into public.messages(intervention_id,author_id,body) values($1,$2,'Private site message')",[job,ids.writer]);
 await db.query("insert into public.intervention_appointments(intervention_id,starts_at,ends_at,updated_by) values($1,now()+interval '1 day',now()+interval '2 days',$2)",[job,ids.writer]);
 await db.query("insert into public.intervention_reports(intervention_id,artisan_id,summary,checks,signature_name) values($1,$2,'Fixture report', '[]','Fixture')",[job,ids.artisan]);
 await db.query("insert into public.approval_rules(site_id,threshold_cents,required_role,enabled) values($1,0,'manager',true)",[siteId]);
 const approval=(await db.query('insert into public.approvals(site_id,quote_id) values($1,$2) returning id',[siteId,quote])).rows[0].id;
 await db.query("insert into public.compliance_records(site_id,title,kind,due_on,status,created_by) values($1,'Fixture','audit',current_date,'pending',$2)",[siteId,ids.owner]);
 return {job,quote,approval};
}
const ja=await fixture(a),jb=await fixture(b);
await db.exec('grant usage on schema storage to authenticated; grant select on storage.objects to authenticated');
await db.query("insert into public.contracts(organization_id,title,reference,starts_on,terms,status,created_by) values($1,'Secret contract','Fixture',current_date,'Site B confidential','draft',$2)",[org,ids.owner]);
await db.query("insert into public.professional_audit(organization_id,actor_id,subject_id,action) values($1,$2,$3,'Fixture site B')",[org,ids.owner,b]);
for(const table of ['interventions','quotes','payments','documents','messages','intervention_appointments','intervention_reports','approval_rules','approvals','compliance_records']){
 assert.equal(await scalar('writer',`select count(*)::int v from public.${table}`),1,table);
 assert.equal(await scalar('global',`select count(*)::int v from public.${table}`),2,table);
 assert.equal(await scalar('outside',`select count(*)::int v from public.${table}`),0,table);
}
assert.equal(await scalar('writer','select count(*)::int v from storage.objects'),1);
assert.equal(await scalar('writer','select public.can_access_intervention($1) v',[jb.job]),false); // creator has no bypass
assert.equal(await scalar('artisan','select public.can_access_intervention($1) v',[jb.job]),true); // assigned exception
for(const table of ['contracts','professional_audit'])assert.equal(await scalar('writer',`select count(*)::int v from public.${table}`),0);
assert.equal(await scalar('global','select count(*)::int v from public.contracts'),1);
assert.equal(await scalar('writer','select count(*)::int v from public.professional_report(null)'),1);
assert.equal(await scalar('writer','select count(*)::int v from public.professional_report($1)',[b]),0);
await assert.rejects(()=>as('writer','select public.intervention_participants($1)',[jb.job]));
console.log('PASS: real-site dossier helper scopes creator, quotes/payments, documents/Storage, chat, appointments/reports, approvals/compliance and exports; selected blocks organization-wide contracts/audit');
for(const actor of ['reader','viewer','outside']){
 await assert.rejects(()=>as(actor,'select public.set_site_budget($1,1)',[a]));
 await assert.rejects(()=>as(actor,"select public.save_compliance($1,'Fixture','audit',current_date,'pending','')",[a]));
 await assert.rejects(()=>as(actor,"select public.create_intervention('panel','Fixture description','Fixture address','97200','Test city','scheduled',$1)",[a]));
 await assert.rejects(()=>as(actor,"select public.decide_approval($1,'approved','')",[ja.approval]));
 await assert.rejects(()=>as(actor,"select public.intervention_action($1,'accept_quote',null,20,$2)",[ja.job,ja.quote]));
 await assert.rejects(()=>as(actor,"select public.reject_intervention_quote($1,$2,'Reason')",[ja.job,ja.quote]));
 await assert.rejects(()=>as(actor,"select public.save_intervention_appointment($1,now()+interval '3 days',now()+interval '4 days','')",[ja.job]));
}
for(const actor of ['writer','reader','viewer']){
 await assert.rejects(()=>as(actor,"select public.create_site('Fixture','office','Address',1,$1)",[org]));
 await assert.rejects(()=>as(actor,"select public.save_contract($1,'Fixture','Ref',current_date,null,'','draft')",[org]));
}
await as('writer','select public.set_site_budget($1,12000)',[a]);
await assert.rejects(()=>as('writer','select public.set_site_budget($1,1)',[b]));
await as('writer',"select public.save_compliance($1,'New fixture','audit',current_date,'pending','')",[a]);
await as('writer',"select public.decide_approval($1,'approved','')",[ja.approval]);
await as('writer',"select public.intervention_action($1,'accept_quote',null,20,$2)",[ja.job,ja.quote]);
await assert.rejects(()=>as('writer','select public.send_message($1,\'Excluded\')',[jb.job]));
await assert.rejects(()=>as('reader','select public.send_message($1,\'Read only\')',[ja.job]));
console.log('PASS: operational read-only grants cannot create requests/sites, edit budgets/compliance, approve/accept/refuse quotes or appointments; writer retains allowed-site workflow');
const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
await as('owner','select public.create_organization_invitation($1,$2,\'manager\',$3,7,\'selected\',$4)',[org,'invitee@example.invalid',hash,JSON.stringify([grant(a,false)])]);
const accepted=(await as('invitee','select public.accept_organization_invitation($1) v',[token])).rows[0].v;
assert.equal(accepted.site_access.scope,'selected');
assert.equal(await scalar('invitee','select count(*)::int v from public.sites'),1);
assert.equal(await scalar('invitee','select public.can_manage_site($1) v',[a]),false);
await assert.rejects(()=>as('invitee','select public.accept_organization_invitation($1)',[token]));
const obsolete=await site(org,'Temporary'),staleToken='b'.repeat(64);
await as('owner','select public.create_organization_invitation($1,$2,\'manager\',$3,7,\'selected\',$4)',[org,'staleinvitee@example.invalid',createHash('sha256').update(staleToken).digest('hex'),JSON.stringify([grant(obsolete,true)])]);
await db.query('delete from public.sites where id=$1',[obsolete]);
await assert.rejects(()=>as('staleInvitee','select public.accept_organization_invitation($1)',[staleToken]));
assert.equal(await scalar('staleInvitee','select count(*)::int v from public.organization_members where user_id=$1',[ids.staleInvitee]),0);
assert.equal((await db.query("select status from public.organization_invitations where email='staleinvitee@example.invalid'")).rows[0].status,'pending');
console.log('PASS: selected invitation accepted atomically without ALL, replay rejected; deleted-site invitation rolls back membership and consumption');
await as('owner',"select public.change_organization_member_role($1,$2,'viewer')",[org,ids.writer]);
assert.equal(await scalar('writer','select public.can_manage_site($1) v',[a]),false);
assert.equal(await scalar('writer','select public.can_access_site($1) v',[a]),true);
await as('owner','select public.transfer_organization_ownership($1,$2)',[org,ids.writer]);
assert.equal(await scalar('writer','select public.can_access_site($1) v',[b]),true);
assert.equal(await scalar('writer','select public.can_manage_site($1) v',[b]),true);
await assert.rejects(()=>as('writer',set,[org,ids.writer,'selected',JSON.stringify([])]));
await as('writer','select public.remove_organization_member($1,$2)',[org,ids.reader]);
assert.equal(await scalar('reader','select count(*)::int v from public.sites'),0);
assert.equal((await db.query('select count(*)::int v from public.organization_member_site_grants where user_id=$1',[ids.reader])).rows[0].v,0);
await assert.rejects(()=>as('reader','select public.organization_site_access_overview($1)',[org]));
await as('writer',set,[org,ids.viewer,'selected',JSON.stringify([])]);
assert.equal(await scalar('viewer','select count(*)::int v from public.sites'),0);
console.log('PASS: stale write grant bounded by current viewer role, canonical owner override after transfer, membership removal cascade and empty selected deny all sites');
const functions=await db.query(`select p.oid::regprocedure::text name,has_function_privilege('authenticated',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%before_site_access' or p.proname in ('validate_site_grants','lock_site_access','lock_intervention_organization'))`);
for(const f of functions.rows)assert.equal(f.allowed,false,f.name);
assert.equal(functions.rows.length,17);
await db.exec('set role anon');await assert.rejects(()=>db.query('select public.can_access_site($1)',[a]));await db.exec('reset role');
const overview=(await as('writer','select public.organization_member_overview($1) v',[org])).rows[0].v;
assert.equal(overview.permissions.site_scoped_roles,true);
assert.equal(JSON.stringify(overview).includes(hash),false);
assert.equal((await as('invitee','select public.organization_site_access_overview($1) v',[org])).rows[0].v.members.length,1);
console.log('PASS: all 17 renamed/internal entry points private, anonymous denied, overview no hashes and own metadata only for ordinary members');
await db.close();
