import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// Isolated PostgreSQL with explicit Auth/Storage stubs, not a live Supabase test.
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
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
for (const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()) await db.exec((await isolatedMigrationSql(db, name, await readFile(new URL(name,migrationDir),'utf8'))).replace('create extension if not exists pgcrypto;','-- extension omitted only in this isolated harness'));
console.log('PASS: all migrations execute with explicit Auth/Storage stubs');
const ids={};let index=1;
for(const actor of ['client','otherClient','artisan','otherArtisan','manager','admin']) {
 ids[actor]=`20000000-0000-4000-8000-${String(index++).padStart(12,'0')}`;
 const role=actor==='artisan'||actor==='otherArtisan'?'artisan':actor==='manager'?'manager':'client';
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role,full_name:actor}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function draft(actor,id,action,args={}) {
 const {version=null,token=null,base=null,lines=null,tax=null}=args;
 return (await as(actor,'select public.manage_quote_draft($1,$2,$3,$4,$5,$6,$7) as value',[id,action,version,token,base,lines===null?null:JSON.stringify(lines),tax])).rows[0].value;
}
async function rejectsCode(promise,code) { await assert.rejects(promise,error=>error.code===code); }
for(const actor of ['artisan','otherArtisan']) {
 await as(actor,"select public.save_artisan_profile('Entreprise QA','12345678901234','EI',0,'12 rue du Test',array['97200'],array['panel'])");
 await as(actor,'select public.submit_artisan_application()');
 await as('admin','select public.decide_artisan_application($1,\'approve\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0))',[ids[actor]]);
 await as(actor,'select public.set_artisan_availability(true)');
}
async function newJob(actor='client',site=null) {
 const row=(await as(actor,"select * from public.create_intervention('panel','Le tableau présente des déclenchements.','12 rue du Test','97200','Fort-de-France','urgent',$1)",[site])).rows[0];
 await as('artisan',"select public.intervention_action($1,'accept_mission')",[row.id]); return row.id;
}
const job=await newJob();
let state=await draft('artisan',job,'load');
assert.equal(state.draft,null);assert.equal(state.version,0);assert.match(state.assignment_token,/^[a-f0-9]{64}$/);assert.equal(state.current_quote_id,null);
state=await draft('artisan',job,'save',{version:0,token:state.assignment_token,base:null,lines:[],tax:null});
assert.equal(state.version,1);assert.deepEqual(state.draft.lines,[]);
assert.equal((await db.query('select count(*)::int n from public.quotes where intervention_id=$1',[job])).rows[0].n,0);
for(const actor of ['client','otherClient','otherArtisan','manager','admin']) {
 await rejectsCode(draft(actor,job,'load'),'42501');
 assert.equal((await as(actor,'select * from public.quote_drafts where intervention_id=$1',[job])).rows.length,0);
 await assert.rejects(as(actor,"update public.quote_drafts set version=999 where intervention_id=$1",[job]));
}
await db.exec('set role anon');await assert.rejects(db.query("select public.manage_quote_draft($1,'load')",[job]));await db.exec('reset role');
await rejectsCode(as('artisan',"select public.validate_quote_draft_content('[]',null)"),'42501');
console.log('PASS: drafts remain private to the approved current artisan, including raw RLS/API-role refusals; saving incomplete content never publishes');
await rejectsCode(draft('artisan',job,'save',{version:0,token:state.assignment_token,lines:[],tax:null}),'P0001');
state=await draft('artisan',job,'discard',{version:1,token:state.assignment_token});
assert.equal(state.version,2);assert.equal(state.draft,null);
assert.deepEqual((await db.query('select lines from public.quote_drafts where intervention_id=$1',[job])).rows[0].lines,[]);
await rejectsCode(draft('artisan',job,'discard',{version:1,token:state.assignment_token}),'P0001');
await rejectsCode(draft('artisan',job,'save',{version:0,token:state.assignment_token,lines:[],tax:null}),'P0001');
const lines=[{label:'Déplacement',quantity:1,unit_price_cents:8000},{label:'Main-d’œuvre',quantity:2,unit_price_cents:6000}];
state=await draft('artisan',job,'save',{version:2,token:state.assignment_token,base:null,lines,tax:20});
assert.equal(state.version,3);
const firstSend=await draft('artisan',job,'send',{version:3,token:state.assignment_token});
assert.equal(firstSend.version,4);assert.equal(firstSend.draft,null);assert.equal(firstSend.quote_id,firstSend.current_quote_id);assert.equal(firstSend.intervention.status,'quoted');
const firstQuote=(await db.query('select * from public.quotes where id=$1',[firstSend.quote_id])).rows[0];
assert.equal(firstQuote.total_cents,24000);assert.equal(firstQuote.status,'sent');
const consumed=(await db.query('select state,version,lines,tax_rate from public.quote_drafts where intervention_id=$1',[job])).rows[0];
assert.equal(consumed.state,'sent');assert.equal(consumed.version,4);assert.deepEqual(consumed.lines,[]);assert.equal(consumed.tax_rate,null);
await rejectsCode(draft('artisan',job,'send',{version:3,token:state.assignment_token}),'P0001');
assert.equal((await db.query('select count(*)::int n from public.quotes where intervention_id=$1',[job])).rows[0].n,1);
console.log('PASS: monotone revision survives discard/send, stale/ABA revisions conflict and publication uses server totals with the exact new quote ID');
state=await draft('artisan',job,'save',{version:4,token:state.assignment_token,base:firstQuote.id,lines:[{label:'',quantity:1,unit_price_cents:0}],tax:null});
await rejectsCode(draft('artisan',job,'send',{version:5,token:state.assignment_token}),'22023');
assert.equal((await draft('artisan',job,'load')).version,5);
assert.equal((await db.query('select status from public.quotes where id=$1',[firstQuote.id])).rows[0].status,'sent');
for(const invalid of [[{label:'Prix',quantity:1,unit_price_cents:-1}],[{label:'Prix',quantity:1.5,unit_price_cents:10}],[{label:'Prix',quantity:1,unit_price_cents:10,total_cents:1}]]) await rejectsCode(draft('artisan',job,'save',{version:5,token:state.assignment_token,base:firstQuote.id,lines:invalid,tax:20}),'22023');
state=await draft('artisan',job,'save',{version:5,token:state.assignment_token,base:firstQuote.id,lines,tax:20});
await db.exec("create function public.qa_deny_quote() returns trigger language plpgsql as $$begin raise exception 'QA induced insert failure' using errcode='P0001'; end;$$; create trigger qa_deny_quote before insert on public.quotes for each row execute function public.qa_deny_quote();");
await rejectsCode(draft('artisan',job,'send',{version:6,token:state.assignment_token}),'P0001');
assert.equal((await draft('artisan',job,'load')).version,6);
assert.equal((await db.query('select status from public.quotes where id=$1',[firstQuote.id])).rows[0].status,'sent');
assert.equal((await db.query('select count(*)::int n from public.quotes where intervention_id=$1',[job])).rows[0].n,1);
await db.exec('drop trigger qa_deny_quote on public.quotes; drop function public.qa_deny_quote();');
const secondSend=await draft('artisan',job,'send',{version:6,token:state.assignment_token});
assert.equal(secondSend.version,7);assert.notEqual(secondSend.quote_id,firstQuote.id);
assert.equal((await db.query('select status from public.quotes where id=$1',[firstQuote.id])).rows[0].status,'rejected');
console.log('PASS: invalid/incomplete money and induced publication failure preserve the draft/version and old sent quote transactionally');
state=await draft('artisan',job,'save',{version:7,token:state.assignment_token,base:secondSend.quote_id,lines,tax:20});
await as('artisan',"select public.intervention_action($1,'send_quote',$2,20)",[job,JSON.stringify([{label:'Autre canal',quantity:1,unit_price_cents:5000}])]);
await rejectsCode(draft('artisan',job,'send',{version:8,token:state.assignment_token}),'P0001');
await rejectsCode(draft('artisan',job,'save',{version:8,token:state.assignment_token,base:secondSend.quote_id,lines,tax:20}),'P0001');
const changed=await draft('artisan',job,'load');assert.notEqual(changed.current_quote_id,secondSend.quote_id);assert.equal(changed.draft.base_quote_id,secondSend.quote_id);
state=await draft('artisan',job,'save',{version:8,token:state.assignment_token,base:changed.current_quote_id,lines,tax:20});
await as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[job,changed.current_quote_id]);
for(const action of ['load','save','discard','send']) await rejectsCode(draft('artisan',job,action,{version:9,token:state.assignment_token,base:changed.current_quote_id,lines,tax:20}),'P0001');
assert.equal((await db.query('select status from public.quotes where id=$1',[changed.current_quote_id])).rows[0].status,'accepted');
assert.equal((await as('artisan','select * from public.quote_drafts where intervention_id=$1',[job])).rows.length,0);
console.log('PASS: external sent-version changes conflict, and accepted quotes cannot be changed or drafted over');
const suspendedJob=await newJob();let suspended=await draft('artisan',suspendedJob,'load');
suspended=await draft('artisan',suspendedJob,'save',{version:0,token:suspended.assignment_token,lines,tax:20});
await as('admin','select public.decide_artisan_application($1,\'suspend\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0))',[ids.artisan]);
for(const action of ['load','save','discard','send']) await rejectsCode(draft('artisan',suspendedJob,action,{version:1,token:suspended.assignment_token,lines,tax:20}),'42501');
assert.equal((await as('artisan','select * from public.quote_drafts where intervention_id=$1',[suspendedJob])).rows.length,0);
await as('admin','select public.decide_artisan_application($1,\'reinstate\',coalesce((select application_version from public.artisan_profiles where user_id=$1),0))',[ids.artisan]);
assert.equal((await draft('artisan',suspendedJob,'load')).version,1);
assert.equal((await db.query('select available from public.artisan_profiles where user_id=$1',[ids.artisan])).rows[0].available,false);
await as('artisan','select public.set_artisan_availability(true)');
console.log('PASS: suspension closes all draft reads/mutations without consuming content; explicit reinstatement preserves the assigned-job draft');
const reassignedJob=await newJob();let old=await draft('artisan',reassignedJob,'load');
old=await draft('artisan',reassignedJob,'save',{version:0,token:old.assignment_token,lines,tax:20});
await as('admin',"select public.reassign_intervention($1,$2,'Réaffectation QA')",[reassignedJob,ids.otherArtisan]);
for(const action of ['load','save','discard','send']) await rejectsCode(draft('artisan',reassignedJob,action,{version:1,token:old.assignment_token,lines,tax:20}),'42501');
assert.equal((await as('artisan','select * from public.quote_drafts where intervention_id=$1',[reassignedJob])).rows.length,0);
const other=await draft('otherArtisan',reassignedJob,'load');assert.equal(other.version,0);assert.equal(other.draft,null);
await as('admin',"select public.reassign_intervention($1,$2,'Retour affectation QA')",[reassignedJob,ids.artisan]);
const returned=await draft('artisan',reassignedJob,'load');assert.equal(returned.draft,null);assert.equal(returned.version,1);assert.notEqual(returned.assignment_token,old.assignment_token);
assert.equal((await as('artisan','select * from public.quote_drafts where intervention_id=$1',[reassignedJob])).rows.length,0);
await rejectsCode(draft('artisan',reassignedJob,'send',{version:1,token:old.assignment_token}),'P0001');
await rejectsCode(draft('artisan',reassignedJob,'save',{version:1,token:old.assignment_token,lines,tax:20}),'P0001');
const fresh=await draft('artisan',reassignedJob,'save',{version:1,token:returned.assignment_token,lines,tax:20});assert.equal(fresh.version,2);
console.log('PASS: reassignment revokes the old artisan and an assignment epoch prevents stale send/save even after assignment returns to the original artisan');
const site=(await as('manager',"select * from public.create_site('Site brouillon','office','12 rue du Test',0,null)")).rows[0];
const siteJob=await newJob('manager',site.id);const scoped=await draft('artisan',siteJob,'load');
await draft('artisan',siteJob,'save',{version:0,token:scoped.assignment_token,lines,tax:20});
await rejectsCode(draft('manager',siteJob,'load'),'42501');
assert.equal((await as('manager','select * from public.quote_drafts where intervention_id=$1',[siteJob])).rows.length,0);
await as('manager',"select public.set_approval_rule($1,10000,'owner',true)",[site.id]);
const businessSend=await draft('artisan',siteJob,'send',{version:1,token:scoped.assignment_token});
const queued=(await as('manager','select * from public.approvals where quote_id=$1',[businessSend.quote_id])).rows[0];
assert.equal(queued.status,'pending');
await rejectsCode(as('manager',"select public.intervention_action($1,'accept_quote',null,20,$2)",[siteJob,businessSend.quote_id]),'P0001');
assert.equal((await db.query('select status from public.quotes where id=$1',[businessSend.quote_id])).rows[0].status,'sent');
console.log('PASS: publishing an enterprise draft queues the existing exact-quote approval and cannot bypass required owner approval');
for(const name of ['intervention_action_base','intervention_action_checked_base','intervention_action_before_site_access']) await rejectsCode(as('artisan',`select public.${name}($1,'send_quote',$2,20)`,[siteJob,JSON.stringify(lines)]),'42501');
const definition=(await db.query("select pg_get_functiondef('public.manage_quote_draft(uuid,text,integer,text,uuid,jsonb,numeric)'::regprocedure) as value")).rows[0].value;
assert.ok(definition.indexOf('public.lock_intervention_organization')<definition.indexOf('from public.interventions where id=p_id for update'));
assert.ok(definition.indexOf('from public.interventions where id=p_id for update')<definition.indexOf('from public.profiles where id=auth.uid() for update'));
assert.ok(definition.indexOf('from public.profiles where id=auth.uid() for update')<definition.indexOf('from public.artisan_profiles where user_id=auth.uid() for update'));
console.log('PASS: enterprise owners/admins do not read private drafts, internal quote helpers remain denied and lock order follows organization/job/profile/dossier');
// Apply a versioned published grid using the same draft and approval transitions.
await db.query("delete from public.action_limits where actor_id=$1 and action='quote_draft'",[ids.artisan]);
const gridPayload = (amount, from = null) => ({
 label: 'Grille QA', lines: [{label:'Forfait QA', unit:'visit', amount_cents:amount, note:'Note commerciale interne QA'}],
 ...(from ? {from_grid_id:from} : {}),
});
async function publishGrid(amount, from = null) {
 const {rows:[{value:created}]}=await as('manager',
  'select public.save_contract_grid($1,$2::jsonb) value',[site.organization_id,JSON.stringify(gridPayload(amount,from))]);
 return (await as('manager','select public.publish_contract_grid($1,$2) value',[created.id,created.version])).rows[0].value;
}
const grid = await publishGrid(12500);
const gridJob = await newJob('manager',site.id);
const gridDraft = await draft('artisan',gridJob,'load');
const options = async (actor,id=gridJob) => (await as(actor,'select public.read_quote_grid_options($1) value',[id])).rows[0].value;
const apply = async (id, current, g=grid, picks=[{index:0,quantity:2}]) =>
 (await as('artisan','select public.apply_quote_contract_grid($1,$2,$3,$4::jsonb,$5,$6,$7,$8) value',
 [id,g.id,g.version_number,JSON.stringify(picks),current.version,current.assignment_token,current.current_quote_id,8.5])).rows[0].value;
const grantGrid = async (id,g,version=null,key=crypto.randomUUID(),actor='manager') =>
 (await as(actor,'select public.write_quote_grid_access($1,$2,$3,$4) value',[id,key,g?.id ?? null,version])).rows[0].value;
assert.deepEqual((await options('artisan')).grids,[]);
assert.equal((await as('manager','select public.read_quote_grid_access($1) v',[gridJob])).rows[0].v.grids[0].id,grid.id);
await rejectsCode(grantGrid(gridJob,grid,null,crypto.randomUUID(),'artisan'),'P0002');
await rejectsCode(apply(gridJob,gridDraft),'P0002');
const firstAccessKey=crypto.randomUUID();
assert.equal((await grantGrid(gridJob,grid,null,firstAccessKey)).version,1);
assert.equal((await grantGrid(gridJob,grid,null,firstAccessKey)).replayed,true);
const anotherGrid = await publishGrid(22222);
assert.deepEqual((await options('artisan')).grids.map(row=>row.id),[grid.id]);
await rejectsCode(apply(gridJob,gridDraft,anotherGrid),'P0002');
assert.deepEqual((await options('artisan')).grids[0].lines, [{index:0,label:'Forfait QA',unit:'visit',unit_price_cents:12500}]);
assert.deepEqual((await options('artisan',reassignedJob)).grids, []);
await rejectsCode(options('otherArtisan'),'42501');
await rejectsCode(apply(gridJob,gridDraft,grid,[{index:0,quantity:2,unit_price_cents:1}]),'22023');
await rejectsCode(apply(gridJob,gridDraft,grid,[{index:0,quantity:1},{index:0,quantity:2}]),'22023');
const priced = await apply(gridJob,gridDraft);
assert.equal(priced.version,1);
assert.deepEqual(priced.draft.lines,[{label:'Forfait QA',quantity:2,unit_price_cents:12500}]);
assert.deepEqual((await options('artisan')).current,{grid_id:grid.id,grid_version:1,grid_label:'Grille QA'});
await rejectsCode(apply(gridJob,gridDraft),'P0001');
const sentWithGrid = await draft('artisan',gridJob,'send',{version:priced.version,token:priced.assignment_token});
const sourceOf = async (actor,id=sentWithGrid.quote_id) => (await as(actor,
 'select grid_id,grid_version,grid_label from public.quote_contract_sources where quote_id=$1',[id])).rows;
assert.deepEqual(await sourceOf('manager'),[{grid_id:grid.id,grid_version:1,grid_label:'Grille QA'}]);
assert.deepEqual(await sourceOf('otherClient'),[]);
const confirmedQuote = (await as('manager','select subtotal_cents,total_cents from public.quotes where id=$1',[sentWithGrid.quote_id])).rows[0];
assert.deepEqual(confirmedQuote,{subtotal_cents:25000,total_cents:27125});

const outdatedJob = await newJob('manager',site.id);
await grantGrid(outdatedJob,grid);
const outdated = await apply(outdatedJob,await draft('artisan',outdatedJob,'load'));
const replacement = await publishGrid(13000,grid.id);
await rejectsCode(draft('artisan',outdatedJob,'send',{version:outdated.version,token:outdated.assignment_token}),'P0001');
assert.equal((await draft('artisan',outdatedJob,'load')).version,outdated.version);
assert.equal((await db.query('select count(*)::int n from public.quotes where intervention_id=$1',[outdatedJob])).rows[0].n,0);
assert.equal((await grantGrid(outdatedJob,replacement,1)).version,2);
const replaced = await apply(outdatedJob,outdated,replacement);
assert.equal(replaced.draft.lines[0].unit_price_cents,13000);
assert.equal((await sourceOf('manager'))[0].grid_version,1);
assert.equal((await grantGrid(outdatedJob,null,2)).version,3);
assert.deepEqual((await options('artisan',outdatedJob)).grids,[]);
await rejectsCode(draft('artisan',outdatedJob,'send',{version:replaced.version,token:replaced.assignment_token}),'P0001');
assert.equal((await grantGrid(outdatedJob,replacement,3)).version,4);
await rejectsCode(draft('artisan',outdatedJob,'send',{version:replaced.version,token:replaced.assignment_token}),'P0001');
const manual = await draft('artisan',outdatedJob,'save',{version:replaced.version,token:replaced.assignment_token,lines,tax:8.5});
assert.equal((await options('artisan',outdatedJob)).current,null);
const sentManual = await draft('artisan',outdatedJob,'send',{version:manual.version,token:manual.assignment_token});
assert.deepEqual(await sourceOf('manager',sentManual.quote_id),[]);
console.log('PASS: contractual rate calculation, private scope, provenance, stale grid refusal and unchanged history');
await db.close();
