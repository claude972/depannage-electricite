import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ADV-B2B-OPERATIONS-001 — isolated PostgreSQL verification of migration 017 (not live Supabase).
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
console.log('PASS: migrations 001-017 execute in isolated PostgreSQL with explicit Auth/Storage stubs');
const ids={};let n=1;
for(const actor of ['owner','global','writer','reader','viewer','outside','otherOwner','artisan','admin']){
 ids[actor]=`10000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role:actor==='artisan'?'artisan':'manager',full_name:`QA ${actor}`}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
await db.query("update public.profiles set artisan_approved=true where id=$1",[ids.artisan]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function scalar(actor,sql,params=[]){return (await as(actor,sql,params)).rows[0].v}
async function rpc(actor,fn,args){const keys=Object.keys(args);const r=await as(actor,`select public.${fn}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,keys.map(k=>args[k]));return r.rows[0].v}
async function refused(actor,fn,args,code){await assert.rejects(()=>rpc(actor,fn,args),e=>{if(code&&e.code!==code){console.error('unexpected code',e.code,e.message);return false}return true},`${actor} ${fn} should be refused`)}
const org=(await db.query("insert into public.organizations(name,owner_id) values('QA organization',$1) returning id",[ids.owner])).rows[0].id;
const otherOrg=(await db.query("insert into public.organizations(name,owner_id) values('QA other organization',$1) returning id",[ids.otherOwner])).rows[0].id;
for(const actor of ['owner','global','writer','reader','viewer'])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[actor],actor==='owner'?'owner':actor==='viewer'?'viewer':'manager']);
await db.query("insert into public.organization_members values($1,$2,'owner')",[otherOrg,ids.otherOwner]);
async function site(o,name){return (await db.query("insert into public.sites(organization_id,name,type,address,budget_cents) values($1,$2,'erp','QA fixture address',0) returning id",[o,name])).rows[0].id}
const a=await site(org,'QA site A'),b=await site(org,'QA site B'),c=await site(otherOrg,'QA other site');
const grant=(site_id,can_write)=>({site_id,can_write});
for(const [actor,write] of [['writer',true],['reader',false],['viewer',false]])await as('owner','select public.set_organization_member_site_access($1,$2,$3,$4)',[org,ids[actor],'selected',JSON.stringify([grant(a,write)])]);
const equipmentPayload={name:'QA tableau général',category:'panel',criticality:'high',location:'Local technique',reference:'QA-REF-1',installed_on:null,status:'in_service',notes:'Donnée synthétique QA'};

// ---------------------------------------------------------------- equipment CRUD, versions, history
const eq=await rpc('writer','save_site_equipment',{p_site_id:a,p_payload:equipmentPayload});
assert.equal(eq.version,1);assert.equal(eq.site_id,a);assert.equal(eq.created_by,ids.writer);
const eq2=await rpc('writer','save_site_equipment',{p_site_id:a,p_payload:{...equipmentPayload,status:'degraded'},p_id:eq.id,p_expected_version:1});
assert.equal(eq2.version,2);assert.equal(eq2.status,'degraded');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:equipmentPayload,p_id:eq.id,p_expected_version:1},'P0001');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:equipmentPayload,p_id:eq.id},'P0001');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:{...equipmentPayload,extra:1}},'22023');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:{...equipmentPayload,category:'nuclear'}},'22023');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:{...equipmentPayload,name:''}},'22023');
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:{...equipmentPayload,installed_on:'yesterday'}},'22023');
assert.equal(await scalar('writer',"select count(*)::int v from public.site_operations_events where entity='equipment' and entity_id=$1",[eq.id]),2);
assert.equal(await scalar('writer',"select (snapshot->>'status') v from public.site_operations_events where entity='equipment' and entity_id=$1 and version=2",[eq.id]),'degraded');
console.log('PASS: equipment create/update with optimistic versions, strict payload, history rows with snapshots');

// ---------------------------------------------------------------- refusal matrix (site writes)
for(const [actor,site_id,code] of [['reader',a,'42501'],['viewer',a,'42501'],['writer',b,'42501'],['outside',a,'42501'],['otherOwner',a,'42501'],['admin',a,'42501'],['artisan',a,'42501'],['owner',c,'42501']])
 await refused(actor,'save_site_equipment',{p_site_id:site_id,p_payload:equipmentPayload},code);
await refused('writer','save_site_equipment',{p_site_id:'00000000-0000-4000-8000-000000000000',p_payload:equipmentPayload},'42501');
await refused('writer','save_site_equipment',{p_site_id:b,p_payload:equipmentPayload,p_id:eq.id,p_expected_version:2},'42501');
for(const [actor,expected] of [['owner',1],['global',1],['writer',1],['reader',1],['viewer',1],['outside',0],['otherOwner',0],['admin',1],['artisan',0]])
 assert.equal(await scalar(actor,'select count(*)::int v from public.site_equipment'),expected,`${actor} reads`);
await assert.rejects(()=>as('writer',"insert into public.site_equipment(site_id,name,category,criticality,status,created_by) values($1,'x','panel','low','in_service',$2)",[a,ids.writer]));
await assert.rejects(()=>as('owner',"update public.site_equipment set name='direct'"));
await assert.rejects(()=>as('owner',"delete from public.site_equipment"));
await assert.rejects(()=>as('owner',"insert into public.site_operations_events(organization_id,actor_id,entity,entity_id,action,version,snapshot) values($1,$2,'equipment',$3,'created',9,'{}')",[org,ids.owner,eq.id]));
await assert.rejects(()=>as('writer',"select public.so_log($1,$2,'equipment',$3,'created',1,'{}')",[org,a,eq.id]));
await assert.rejects(()=>as('writer',"select public.so_lock_organization($1)",[org]));
console.log('PASS: read-only grant, viewer, other site, other organization, admin, artisan and unknown site are refused; no direct table or private helper access');

// ---------------------------------------------------------------- revocation is immediate
await as('owner','select public.set_organization_member_site_access($1,$2,$3,$4)',[org,ids.writer,'selected',JSON.stringify([grant(a,false)])]);
await refused('writer','save_site_equipment',{p_site_id:a,p_payload:equipmentPayload},'42501');
assert.equal(await scalar('writer','select count(*)::int v from public.site_equipment'),1);
await as('owner','select public.set_organization_member_site_access($1,$2,$3,$4)',[org,ids.writer,'selected',JSON.stringify([])]);
assert.equal(await scalar('writer','select count(*)::int v from public.site_equipment'),0);
assert.equal(await scalar('writer','select count(*)::int v from public.site_operations_events'),0);
await assert.rejects(()=>as('writer','select public.site_operations_snapshot($1)',[a]));
await as('owner','select public.set_organization_member_site_access($1,$2,$3,$4)',[org,ids.writer,'selected',JSON.stringify([grant(a,true)])]);
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.reader]);
assert.equal(await scalar('reader','select count(*)::int v from public.site_equipment'),0);
await assert.rejects(()=>as('reader','select public.site_operations_snapshot($1)',[a]));
console.log('PASS: grant downgrade, grant removal and membership removal refuse immediately (writes, reads, snapshot, history)');

// ---------------------------------------------------------------- maintenance plans and visits
const planPayload={equipment_id:eq.id,title:'QA visite annuelle',frequency_kind:'months',frequency_value:12,next_due_on:'2027-01-15',last_done_on:null,status:'active',notes:''};
const plan=await rpc('writer','save_maintenance_plan',{p_site_id:a,p_payload:planPayload});
assert.equal(plan.frequency_value,12);
await refused('writer','save_maintenance_plan',{p_site_id:a,p_payload:{...planPayload,frequency_kind:'none'}},'22023');
await refused('writer','save_maintenance_plan',{p_site_id:a,p_payload:{...planPayload,frequency_value:null}},'22023');
const otherEq=await rpc('owner','save_site_equipment',{p_site_id:b,p_payload:equipmentPayload});
await refused('owner','save_maintenance_plan',{p_site_id:a,p_payload:{...planPayload,equipment_id:otherEq.id}},'42501');
const unscheduled=await rpc('writer','save_maintenance_plan',{p_site_id:a,p_payload:{...planPayload,equipment_id:null,frequency_kind:'none',frequency_value:null,next_due_on:null}});
assert.equal(unscheduled.next_due_on,null);
const visit=await rpc('writer','record_maintenance_visit',{p_plan_id:plan.id,p_done_on:'2026-10-10',p_summary:'QA visite réalisée'});
assert.equal(visit.plan.next_due_on,'2027-10-10');assert.equal(visit.plan.last_done_on,'2026-10-10');assert.equal(visit.plan.version,2);
const visit2=await rpc('writer','record_maintenance_visit',{p_plan_id:unscheduled.id,p_done_on:'2026-10-11',p_summary:''});
assert.equal(visit2.plan.next_due_on,null,'no frequency: no invented next date');
await refused('viewer','record_maintenance_visit',{p_plan_id:plan.id,p_done_on:'2026-10-10',p_summary:'x'},'42501');
await refused('otherOwner','record_maintenance_visit',{p_plan_id:plan.id,p_done_on:'2026-10-10',p_summary:'x'},'42501');
await refused('writer','record_maintenance_visit',{p_plan_id:'00000000-0000-4000-8000-000000000001',p_done_on:'2026-10-10',p_summary:'x'},'42501');
const foreignJob=(await db.query("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status) values($1,$2,'panel','QA fixture description','QA fixture address','97200','QA city','scheduled',100,200,'requested') returning id",[ids.owner,b])).rows[0].id;
await refused('writer','record_maintenance_visit',{p_plan_id:plan.id,p_done_on:'2026-10-10',p_summary:'x',p_intervention_id:foreignJob},'42501');
assert.equal(await scalar('writer',"select count(*)::int v from public.site_operations_events where entity='maintenance_visit'"),2);
console.log('PASS: maintenance plans require an explicit frequency or none, visits compute next due only from configuration, cross-site equipment/dossier refused');

// ---------------------------------------------------------------- fiscal years and budget lines
const fy=await rpc('owner','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA exercice 2026',starts_on:'2026-01-01',ends_on:'2026-12-31',status:'open'}});
await refused('owner','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA chevauchement',starts_on:'2026-12-01',ends_on:'2027-11-30',status:'open'}},'P0001');
await refused('owner','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA trop long',starts_on:'2027-01-01',ends_on:'2029-12-31',status:'open'}},'22023');
const fy2=await rpc('global','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA exercice 2027',starts_on:'2027-01-01',ends_on:'2027-12-31',status:'open'}});
await refused('writer','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA',starts_on:'2028-01-01',ends_on:'2028-12-31',status:'open'}},'42501');
await refused('viewer','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA',starts_on:'2028-01-01',ends_on:'2028-12-31',status:'open'}},'42501');
await refused('otherOwner','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA',starts_on:'2028-01-01',ends_on:'2028-12-31',status:'open'}},'42501');
await refused('admin','save_fiscal_year',{p_organization_id:org,p_payload:{label:'QA',starts_on:'2028-01-01',ends_on:'2028-12-31',status:'open'}},'42501');
assert.equal(await scalar('writer','select count(*)::int v from public.organization_fiscal_years'),2,'selected-scope member reads organisation fiscal years');
assert.equal(await scalar('otherOwner','select count(*)::int v from public.organization_fiscal_years'),0);
const line=await rpc('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:fy.id,p_category:'maintenance',p_amount_cents:250000,p_note:'QA'});
assert.equal(line.version,1);
const line2=await rpc('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:fy.id,p_category:'maintenance',p_amount_cents:300000,p_note:'QA',p_expected_version:1});
assert.equal(line2.id,line.id);assert.equal(line2.version,2);assert.equal(line2.amount_cents,300000);
await refused('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:fy.id,p_category:'maintenance',p_amount_cents:1,p_note:'QA'},'P0001');
await refused('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:fy.id,p_category:'repairs',p_amount_cents:1,p_note:'QA',p_expected_version:1},'P0001');
const otherFy=(await db.query("insert into public.organization_fiscal_years(organization_id,label,starts_on,ends_on,status,created_by) values($1,'QA other',' 2026-01-01','2026-12-31','open',$2) returning id",[otherOrg,ids.otherOwner])).rows[0].id;
await refused('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:otherFy,p_category:'repairs',p_amount_cents:1,p_note:'QA'},'42501');
await refused('writer','save_budget_line',{p_site_id:a,p_fiscal_year_id:fy.id,p_category:'bonus',p_amount_cents:1,p_note:'QA'},'22023');
// Consumption: an accepted quote dated inside the fiscal year on this site counts; another site's does not.
const job=(await db.query("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status) values($1,$2,$3,'panel','QA fixture description','QA fixture address','97200','QA city','scheduled',100,200,'paid') returning id",[ids.owner,ids.artisan,a])).rows[0].id;
await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at) values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":12000}]',12000,0,0,12000,'accepted','2026-03-01T10:00:00Z')`,[job,ids.artisan]);
await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at) values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":5000}]',5000,0,0,5000,'accepted','2027-03-01T10:00:00Z')`,[foreignJob,ids.artisan]);
console.log('PASS: fiscal years need organisation-wide write, overlap and length refused, budget lines upsert with versions and same-organisation fiscal year');

// ---------------------------------------------------------------- versioned contract grids
const gridPayload={label:'QA grille 2026',contract_id:null,effective_from:'2026-01-01',lines:[{label:'Déplacement',unit:'visit',amount_cents:4500,note:''},{label:'Main d’œuvre',unit:'hour',amount_cents:6000,note:'QA'}]};
const g1=await rpc('owner','save_contract_grid',{p_organization_id:org,p_payload:gridPayload});
assert.equal(g1.status,'draft');assert.equal(g1.version_number,1);assert.equal(g1.lines.length,2);
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,lines:[{label:'x',unit:'day',amount_cents:1,note:''}]}},'22023');
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,lines:[{label:'x',unit:'hour',amount_cents:-1,note:''}]}},'22023');
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,lines:[{label:'x',unit:'hour',amount_cents:1.5,note:''}]}},'22023');
const g1b=await rpc('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,label:'QA grille 2026 v1'},p_id:g1.id,p_expected_version:1});
assert.equal(g1b.version,2);
const published=await rpc('owner','publish_contract_grid',{p_id:g1.id,p_expected_version:2});
assert.equal(published.status,'published');assert.ok(published.published_at);
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:gridPayload,p_id:g1.id,p_expected_version:published.version},'P0001');
await refused('owner','publish_contract_grid',{p_id:g1.id,p_expected_version:published.version},'P0001');
const g2=await rpc('global','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,from_grid_id:g1.id,label:'QA grille 2027'}});
assert.equal(g2.lineage_id,g1.lineage_id);assert.equal(g2.version_number,2);assert.equal(g2.status,'draft');
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,from_grid_id:g1.id}},'P0001');
const g2p=await rpc('owner','publish_contract_grid',{p_id:g2.id,p_expected_version:g2.version});
assert.equal(g2p.status,'published');
assert.equal(await scalar('owner','select status v from public.organization_contract_grids where id=$1',[g1.id]),'superseded');
await refused('writer','save_contract_grid',{p_organization_id:org,p_payload:gridPayload},'42501');
await refused('viewer','publish_contract_grid',{p_id:g2.id,p_expected_version:g2p.version},'42501');
await refused('otherOwner','publish_contract_grid',{p_id:g2.id,p_expected_version:g2p.version},'42501');
await refused('otherOwner','save_contract_grid',{p_organization_id:org,p_payload:gridPayload},'42501');
assert.equal(await scalar('writer','select count(*)::int v from public.organization_contract_grids'),0,'selected-scope member cannot read contractual amounts');
assert.equal(await scalar('viewer','select count(*)::int v from public.organization_contract_grids'),0);
assert.equal(await scalar('global','select count(*)::int v from public.organization_contract_grids'),2);
assert.equal(await scalar('admin','select count(*)::int v from public.organization_contract_grids'),2);
const otherContract=(await db.query("insert into public.contracts(organization_id,title,starts_on,status,created_by) values($1,'QA other contract','2026-01-01','active',$2) returning id",[otherOrg,ids.otherOwner])).rows[0].id;
await refused('owner','save_contract_grid',{p_organization_id:org,p_payload:{...gridPayload,contract_id:otherContract}},'42501');
console.log('PASS: contract grids draft/publish/supersede lineage, published immutable, one draft per lineage, amounts strictly as entered, readers limited to organisation-wide members');

// ---------------------------------------------------------------- SLA calendars, policies, cases, pauses
const calPayload={name:'QA jours ouvrés',timezone:'Europe/Paris',windows:[{weekday:1,start:'08:00',end:'12:00'},{weekday:1,start:'13:00',end:'17:00'}],closed_dates:['2026-12-25']};
const cal=await rpc('owner','save_sla_calendar',{p_organization_id:org,p_payload:calPayload});
assert.deepEqual(cal.windows[0],{weekday:1,start:'08:00',end:'12:00'});assert.deepEqual(cal.closed_dates,['2026-12-25']);
await refused('owner','save_sla_calendar',{p_organization_id:org,p_payload:{...calPayload,windows:[{weekday:8,start:'08:00',end:'12:00'}]}},'22023');
await refused('owner','save_sla_calendar',{p_organization_id:org,p_payload:{...calPayload,windows:[{weekday:1,start:'12:00',end:'08:00'}]}},'22023');
await refused('owner','save_sla_calendar',{p_organization_id:org,p_payload:{...calPayload,windows:[{weekday:1,start:'25:00',end:'26:00'}]}},'22023');
await refused('owner','save_sla_calendar',{p_organization_id:org,p_payload:{...calPayload,closed_dates:['2026-13-01']}});
await refused('writer','save_sla_calendar',{p_organization_id:org,p_payload:calPayload},'42501');
await refused('otherOwner','save_sla_calendar',{p_organization_id:org,p_payload:calPayload},'42501');
assert.equal(await scalar('writer','select count(*)::int v from public.organization_sla_calendars'),1);
assert.equal(await scalar('otherOwner','select count(*)::int v from public.organization_sla_calendars'),0);
const otherCal=(await db.query("insert into public.organization_sla_calendars(organization_id,name,timezone,created_by) values($1,'QA other','UTC',$2) returning id",[otherOrg,ids.otherOwner])).rows[0].id;
const polPayload={name:'QA urgences',calendar_id:cal.id,urgency:'urgent',response_target_minutes:120,resolution_target_minutes:null,status:'active'};
const pol=await rpc('writer','save_sla_policy',{p_site_id:a,p_payload:polPayload});
assert.equal(pol.resolution_target_minutes,null,'no target invented');
await refused('writer','save_sla_policy',{p_site_id:a,p_payload:{...polPayload,calendar_id:otherCal}},'42501');
await refused('writer','save_sla_policy',{p_site_id:a,p_payload:{...polPayload,response_target_minutes:0}},'22023');
await refused('writer','save_sla_policy',{p_site_id:a,p_payload:{...polPayload,urgency:'critical'}},'22023');
await refused('viewer','save_sla_policy',{p_site_id:a,p_payload:polPayload},'42501');
const unconfigured=await rpc('writer','save_sla_policy',{p_site_id:a,p_payload:{...polPayload,name:'QA sans calendrier',calendar_id:null,response_target_minutes:null}});
assert.equal(unconfigured.calendar_id,null);
const casePayload={policy_id:pol.id,intervention_id:job,reference:'QA-001',opened_at:'2026-10-05T07:30:00Z',responded_at:null,resolved_at:null,notes:''};
const kase=await rpc('writer','save_sla_case',{p_site_id:a,p_payload:casePayload});
assert.equal(kase.version,1);
await refused('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,responded_at:'2026-10-05T07:00:00Z'}},'22023');
await refused('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,intervention_id:foreignJob}},'42501');
await refused('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,opened_at:'2026-10-05 07:30'}},'22023');
await refused('owner','save_sla_case',{p_site_id:b,p_payload:{...casePayload,intervention_id:null}},'42501','policy of another site');
const paused=await rpc('writer','pause_sla_case',{p_case_id:kase.id,p_started_at:'2026-10-05T09:00:00Z',p_reason:'QA attente pièce',p_expected_version:1});
assert.equal(paused.case.version,2);assert.equal(paused.pause.ended_at,null);
await refused('writer','pause_sla_case',{p_case_id:kase.id,p_started_at:'2026-10-05T10:00:00Z',p_reason:'x',p_expected_version:2},'P0001');
await refused('writer','pause_sla_case',{p_case_id:kase.id,p_started_at:'2026-10-05T10:00:00Z',p_reason:'x',p_expected_version:1},'P0001');
await refused('viewer','resume_sla_case',{p_case_id:kase.id,p_ended_at:'2026-10-05T10:00:00Z',p_expected_version:2},'42501');
await refused('writer','resume_sla_case',{p_case_id:kase.id,p_ended_at:'2026-10-05T08:00:00Z',p_expected_version:2},'22023');
const resumed=await rpc('writer','resume_sla_case',{p_case_id:kase.id,p_ended_at:'2026-10-05T10:00:00Z',p_expected_version:2});
assert.equal(resumed.pause.ended_at.slice(0,13),'2026-10-05T10'.slice(0,13));assert.equal(resumed.case.version,3);
await refused('writer','resume_sla_case',{p_case_id:kase.id,p_ended_at:'2026-10-05T11:00:00Z',p_expected_version:3},'P0001');
const closed=await rpc('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,responded_at:'2026-10-05T11:00:00Z',resolved_at:'2026-10-06T11:00:00Z'},p_id:kase.id,p_expected_version:3});
assert.equal(closed.version,4);
await refused('writer','pause_sla_case',{p_case_id:kase.id,p_started_at:'2026-10-07T10:00:00Z',p_reason:'x',p_expected_version:4},'P0001','resolved case cannot pause');
await refused('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,opened_at:'2026-10-05T09:30:00Z'},p_id:kase.id,p_expected_version:4},'22023','pause before new opened_at');
await refused('otherOwner','pause_sla_case',{p_case_id:kase.id,p_started_at:'2026-10-07T10:00:00Z',p_reason:'x',p_expected_version:4},'42501');
assert.equal(await scalar('viewer','select count(*)::int v from public.site_sla_pauses'),1);
assert.equal(await scalar('otherOwner','select count(*)::int v from public.site_sla_pauses'),0);
console.log('PASS: calendars validated (weekday, windows, dates), policies bound to same-organisation calendar, case chronology, single open pause, resume/pause versions, resolved case frozen');

// ---------------------------------------------------------------- ERP declarative checklists
const checklistPayload={title:'QA contrôle éclairage de sécurité',description:'Liste déclarative QA',performed_on:'2026-10-01',performed_by_label:'QA responsable',status:'completed',items:[{key:'bloc-1',label:'Blocs autonomes testés',state:'ok',note:'',reserve_resolved_on:null},{key:'bloc-2',label:'Pictogramme manquant',state:'reserve',note:'QA réserve',reserve_resolved_on:null}]};
const list=await rpc('writer','save_erp_checklist',{p_site_id:a,p_payload:checklistPayload});
assert.equal(list.nature,'declarative');assert.equal(list.items.length,2);assert.equal(list.items[1].state,'reserve');
await refused('writer','save_erp_checklist',{p_site_id:a,p_payload:{...checklistPayload,items:[{key:'dup',label:'a',state:'ok',note:''},{key:'dup',label:'b',state:'ok',note:''}]}},'22023');
await refused('writer','save_erp_checklist',{p_site_id:a,p_payload:{...checklistPayload,items:[{key:'k',label:'a',state:'certified',note:''}]}},'22023');
await refused('writer','save_erp_checklist',{p_site_id:a,p_payload:{...checklistPayload,nature:'certified'}},'22023');
await assert.rejects(()=>db.query("update public.site_erp_checklists set nature='certified' where id=$1",[list.id]),'nature is constrained even for service role');
const resolved=await rpc('writer','save_erp_checklist',{p_site_id:a,p_payload:{...checklistPayload,items:[checklistPayload.items[0],{...checklistPayload.items[1],reserve_resolved_on:'2026-10-20'}]},p_id:list.id,p_expected_version:1});
assert.equal(resolved.items[1].reserve_resolved_on,'2026-10-20');
await refused('viewer','save_erp_checklist',{p_site_id:a,p_payload:checklistPayload},'42501');
await refused('writer','save_erp_checklist',{p_site_id:b,p_payload:checklistPayload},'42501');
console.log('PASS: ERP checklists are declarative by constraint, items validated with unique keys and bounded states, reserves tracked with resolution dates');

// ---------------------------------------------------------------- snapshot under RLS and completeness facts
const snap=await scalar('writer','select public.site_operations_snapshot($1) v',[a]);
assert.equal(snap.site.id,a);assert.equal(snap.equipment.length,1);assert.equal(snap.maintenance_plans.length,2);
assert.equal(snap.maintenance_plans.find(p=>p.id===plan.id).visits.length,1);
assert.equal(snap.fiscal_years.length,2);assert.equal(snap.budget_lines.length,1);
const consumption=snap.budget_consumption.find(x=>x.fiscal_year_id===fy.id);
assert.equal(consumption.accepted_cents,12000);assert.equal(consumption.paid_cents,12000);assert.equal(consumption.interventions,1);
assert.equal(snap.budget_consumption.find(x=>x.fiscal_year_id===fy2.id).accepted_cents,0,'other site quote not counted');
assert.equal(snap.contract_grids,null,'selected-scope member: grids not readable, flagged not hidden');
assert.equal(snap.limits.contract_grids_readable,false);assert.equal(snap.limits.can_write_site,true);assert.equal(snap.limits.can_write_organization,false);
assert.equal(snap.sla_calendars.length,1);assert.equal(snap.sla_policies.length,2);assert.equal(snap.sla_cases.length,1);assert.equal(snap.sla_cases[0].pauses.length,1);assert.equal(snap.sla_cases[0].pauses_total,1);
assert.equal(snap.maintenance_plans.find(p=>p.id===plan.id).visits_total,1);
assert.equal(snap.erp_checklists.length,1);assert.ok(snap.events.length>=10);assert.ok(!snap.events.some(e=>e.snapshot),'event list carries no snapshot payload');
const ownerSnap=await scalar('owner','select public.site_operations_snapshot($1) v',[a]);
assert.equal(ownerSnap.contract_grids.length,2);assert.equal(ownerSnap.limits.can_write_organization,true);
const viewerSnap=await scalar('viewer','select public.site_operations_snapshot($1) v',[a]);
assert.equal(viewerSnap.limits.can_write_site,false);assert.equal(viewerSnap.equipment.length,1);
const adminSnap=await scalar('admin','select public.site_operations_snapshot($1) v',[a]);
assert.equal(adminSnap.limits.can_write_site,false);assert.equal(adminSnap.contract_grids.length,2);
for(const actor of ['outside','otherOwner','artisan'])await assert.rejects(()=>as(actor,'select public.site_operations_snapshot($1)',[a]),`${actor} snapshot`);
await assert.rejects(()=>as('writer','select public.site_operations_snapshot($1)',[b]));
await assert.rejects(()=>as('writer','select public.site_operations_snapshot($1)',['00000000-0000-4000-8000-000000000002']));
await assert.rejects(()=>as(null,'select public.site_operations_snapshot($1)',[a]));
console.log('PASS: snapshot is one RLS-scoped read with budget consumption per fiscal year, contract grids null when not readable, write flags per actor, foreign/unknown/anonymous refused');

// ---------------------------------------------------------------- pauses are never truncated: 55 pauses, the open one last
const manyCase=await rpc('writer','save_sla_case',{p_site_id:a,p_payload:{...casePayload,reference:'QA-MANY',opened_at:'2026-01-05T08:00:00Z'}});
for(let i=0;i<54;i++)await db.query("insert into public.site_sla_pauses(case_id,site_id,started_at,ended_at,reason,created_by) values($1,$2,$3::timestamptz,$3::timestamptz+interval '10 minutes','QA closed pause',$4)",[manyCase.id,a,new Date(Date.UTC(2026,0,6+Math.floor(i/4),9+(i%4)*2)).toISOString(),ids.writer]);
await db.query("insert into public.site_sla_pauses(case_id,site_id,started_at,ended_at,reason,created_by) values($1,$2,'2026-02-10T09:00:00Z',null,'QA open pause',$3)",[manyCase.id,a,ids.writer]);
const manySnap=await scalar('writer','select public.site_operations_snapshot($1) v',[a]);
const many=manySnap.sla_cases.find(c=>c.id===manyCase.id);
assert.equal(many.pauses_total,55);assert.equal(many.pauses.length,55,'all pauses returned, no limit');
assert.equal(many.pauses[54].ended_at,null,'the open pause is last and present');
assert.equal(many.pauses.filter(p=>p.ended_at===null).length,1);
for(let i=1;i<many.pauses.length;i++)assert.ok(many.pauses[i-1].started_at<=many.pauses[i].started_at,'chronological order');
await db.query("delete from public.site_sla_pauses where case_id=$1",[manyCase.id]);
console.log('PASS: every pause of a case is returned with its total (55 incl. the open one), so no SLA state can be computed on a truncated list');

// ---------------------------------------------------------------- private entry points and anonymous access
for(const fn of ['so_keys(jsonb,text[])','so_text(jsonb,text,integer,integer)','so_int(jsonb,text,integer,integer,boolean)','so_enum(jsonb,text,text[],boolean)','so_date(jsonb,text,boolean)','so_ts(jsonb,text,boolean)','so_uuid(jsonb,text,boolean)','so_lock_organization(uuid)','so_site_organization(uuid)','so_version(integer,integer)','so_log(uuid,uuid,text,uuid,text,integer,jsonb)','so_grid_lines(jsonb)','so_calendar_windows(jsonb)','so_closed_dates(jsonb)','so_checklist_items(jsonb)']){
 assert.equal((await db.query(`select has_function_privilege('authenticated','public.${fn}','execute') v`)).rows[0].v,false,fn);
 assert.equal((await db.query(`select has_function_privilege('anon','public.${fn}','execute') v`)).rows[0].v,false,fn);
}
for(const fn of ['save_site_equipment(uuid,jsonb,uuid,integer)','site_operations_snapshot(uuid)','publish_contract_grid(uuid,integer)'])
 assert.equal((await db.query(`select has_function_privilege('anon','public.${fn}','execute') v`)).rows[0].v,false,fn);
await db.exec('set role anon');
try{await assert.rejects(()=>db.query('select count(*) from public.site_equipment'));await assert.rejects(()=>db.query('select public.site_operations_snapshot($1)',[a]));}finally{await db.exec('reset role')}
for(const table of ['site_equipment','site_maintenance_plans','site_maintenance_visits','organization_fiscal_years','site_budget_lines','organization_contract_grids','organization_sla_calendars','site_sla_policies','site_sla_cases','site_sla_pauses','site_erp_checklists','site_operations_events'])
 assert.equal((await db.query(`select relrowsecurity v from pg_class where oid='public.${table}'::regclass`)).rows[0].v,true,table);
console.log('PASS: all 15 private helpers unreachable, anonymous denied, RLS enabled on the 12 new tables');
console.log('SQL review complete: ADV-B2B-OPERATIONS-001 migration 017 verified in isolated PostgreSQL with synthetic QA fixtures only');
