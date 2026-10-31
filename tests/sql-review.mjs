// Isolated PostgreSQL verification. Install @electric-sql/pglite@0.5.13 into a
// temporary directory, then set PGLITE_MODULE to its dist/index.js absolute path.
// Supabase auth/storage are explicit stubs; this is not a live Supabase test.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const migrationDir = new URL('../supabase/migrations/', import.meta.url);
for (const file of (await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort()) {
 let migration=await readFile(new URL(file,migrationDir),'utf8');
 // PGlite ships PostgreSQL gen_random_uuid; pgcrypto extension is not bundled.
 migration=migration.replace('create extension if not exists pgcrypto;','-- pgcrypto omitted only in this isolated harness');
 await db.exec(migration);
}
console.log('PASS: entire migration executes under isolated PostgreSQL with auth/storage stubs');
const ids = Object.fromEntries(['client1','client2','artisan1','artisan2','manager','admin'].map((name,i)=>[name,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
for (const [name,id] of Object.entries(ids)) {
 const role = name.startsWith('artisan') ? 'artisan' : name === 'manager' ? 'manager' : name === 'admin' ? 'admin' : 'client';
 await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,JSON.stringify({role,full_name:name})]);
}
assert.equal((await db.query('select role from public.profiles where id=$1',[ids.admin])).rows[0].role,'client');
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
console.log('PASS: public signup cannot grant administrator role');
async function as(name, sql, params=[]) {
 await db.exec('set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]]);
 try {return await db.query(sql,params);} finally {await db.exec('reset role');}
}
const job = (await as('client1',"select * from public.create_intervention('panel','Le disjoncteur se déclenche régulièrement.','12 rue de test','97200','Fort-de-France','urgent',null)")).rows[0];
assert.equal(job.client_id,ids.client1);
assert.equal((await as('client2','select * from public.interventions where id=$1',[job.id])).rows.length,0);
assert.equal((await as('artisan1','select * from public.interventions where id=$1',[job.id])).rows.length,0);
await assert.rejects(as('client1',"update public.profiles set role='admin' where id=$1",[ids.client1]));
await assert.rejects(as('artisan1','select public.approve_artisan($1,true)',[ids.artisan1]));
console.log('PASS: unrelated client/artisan cannot read job; role escalation and self-approval rejected');
await as('admin','select public.approve_artisan($1,true)',[ids.artisan1]);
await as('admin','select public.approve_artisan($1,true)',[ids.artisan2]);
const offer=(await as('artisan1','select * from public.available_missions()')).rows.find(r=>r.id===job.id);
assert.ok(offer);assert.equal('address' in offer,false);assert.equal('description' in offer,false);assert.equal(offer.postal_code,'972**');
await as('artisan1',"select public.intervention_action($1,'accept_mission')",[job.id]);
await assert.rejects(as('artisan2',"select public.intervention_action($1,'accept_mission')",[job.id]));
assert.equal((await db.query('select artisan_id from public.interventions where id=$1',[job.id])).rows[0].artisan_id,ids.artisan1);
console.log('PASS: sanitized offer and exactly one sequential accept winner (not a concurrency load test)');
const lines=JSON.stringify([{label:'Déplacement',quantity:1,unit_price_cents:8000},{label:'Main-d’œuvre',quantity:2,unit_price_cents:6000}]);
await as('artisan1',"select public.intervention_action($1,'send_quote',$2,20)",[job.id,lines]);
const quote=(await as('client1','select * from public.quotes where intervention_id=$1',[job.id])).rows[0];
assert.equal(quote.total_cents,24000);
await assert.rejects(as('client2',"select public.intervention_action($1,'accept_quote')",[job.id]));
await assert.rejects(as('artisan1',"select public.intervention_action($1,'start')",[job.id]));
await as('client1',"select public.intervention_action($1,'accept_quote')",[job.id]);
await as('artisan1',"select public.intervention_action($1,'start')",[job.id]);
await as('artisan1',"select public.intervention_action($1,'complete')",[job.id]);
console.log('PASS: quote amount and owner-only acceptance; work cannot start before acceptance');
await db.query("insert into public.payments(quote_id,session_id,total_cents) values($1,'cs_test_harness',24000)",[quote.id]);
const confirm="select public.confirm_stripe_payment($1,'checkout.session.completed','cs_test_harness',$2,$3,'eur') as applied";
await assert.rejects(as('client1',confirm,['evt_forged',quote.id,24000]));
await db.exec('set role service_role');
await assert.rejects(db.query(confirm,['evt_mismatch',quote.id,23999]));
const allRequired=['evt_null','checkout.session.completed','cs_test_harness',quote.id,24000,'eur'];
for(let index=0;index<allRequired.length;index++) {
 const invalid=[...allRequired];invalid[index]=null;
 await assert.rejects(db.query('select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)',invalid));
}
console.log('PASS: every NULL payment reference or amount is rejected at the SQL boundary');
assert.equal((await db.query(confirm,['evt_valid',quote.id,24000])).rows[0].applied,true);
assert.equal((await db.query(confirm,['evt_valid',quote.id,24000])).rows[0].applied,false);
await db.exec('reset role');
assert.equal((await db.query("select count(*)::int as count from public.stripe_events where id='evt_mismatch'")).rows[0].count,0);
assert.equal((await db.query('select status from public.interventions where id=$1',[job.id])).rows[0].status,'paid');
assert.equal((await db.query("select count(*)::int as count from public.audit_log where intervention_id=$1 and action='payment_confirmed'",[job.id])).rows[0].count,1);
console.log('PASS: service-only payment confirmation, mismatch rollback and idempotent replay');
const site=(await as('manager',"select * from public.create_site('Site test','office','12 rue des bureaux',100000,null)")).rows[0];
assert.equal((await as('client1','select * from public.sites where id=$1',[site.id])).rows.length,0);
await assert.rejects(as('client1',"select public.create_intervention('panel','Une panne électrique du tableau.','12 rue de test','97200','Fort-de-France','urgent',$1)",[site.id]));
console.log('PASS: organization site isolation and cross-organization request rejection');
await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')",[site.organization_id,ids.client2]);
const siteJob=(await as('manager',"select * from public.create_intervention('panel','Le tableau du bureau est en panne.','12 rue des bureaux','97200','Fort-de-France','urgent',$1)",[site.id])).rows[0];
await as('artisan1',"select public.intervention_action($1,'accept_mission')",[siteJob.id]);
assert.equal((await as('client2','select * from public.interventions where id=$1',[siteJob.id])).rows.length,1);
await assert.rejects(as('client2',"select public.send_message($1,'Un viewer ne doit pas écrire.')",[siteJob.id]));
await as('manager',"select public.send_message($1,'Message du gestionnaire autorisé.')",[siteJob.id]);
console.log('PASS: organization viewer can read but cannot send messages; manager can write');
const manager2='00000000-0000-4000-8000-000000000007';
ids.manager2=manager2;
await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[manager2,JSON.stringify({role:'manager',full_name:'manager2'})]);
await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'manager')",[site.organization_id,manager2]);
await assert.rejects(as('manager2',"select public.set_approval_rule($1,10000,'owner',true)",[site.id]));
await as('manager',"select public.set_approval_rule($1,10000,'owner',true)",[site.id]);
await as('artisan1',"select public.intervention_action($1,'send_quote',$2,20)",[siteJob.id,lines]);
const siteQuote=(await as('manager','select * from public.quotes where intervention_id=$1',[siteJob.id])).rows[0];
const approval=(await as('manager','select * from public.approvals where quote_id=$1',[siteQuote.id])).rows[0];
assert.ok(approval);assert.equal(approval.status,'pending');
await assert.rejects(as('manager',"select public.intervention_action($1,'accept_quote')",[siteJob.id]));
await assert.rejects(as('manager2',"select public.decide_approval($1,'approved','Non propriétaire')",[approval.id]));
await assert.rejects(as('client2',"select public.decide_approval($1,'approved','Viewer')",[approval.id]));
await as('manager',"select public.decide_approval($1,'approved','Budget contrôlé par le propriétaire')",[approval.id]);
await as('manager2',"select public.intervention_action($1,'accept_quote')",[siteJob.id]);
console.log('PASS: owner-only rule configuration, threshold queues approval, required owner decision unlocks quote');
const contract=(await as('manager',"select * from public.save_contract($1,'Contrat test','REF-001','2026-10-01','2027-10-01','Conditions de test','draft',null)",[site.organization_id])).rows[0];
assert.equal((await as('client1','select * from public.contracts where id=$1',[contract.id])).rows.length,0);
await assert.rejects(as('client1',"select public.save_contract($1,'Contrat interdit','','2026-10-01',null,'','draft',null)",[site.organization_id]));
await assert.rejects(as('client2',"select public.save_contract($1,'Contrat viewer','','2026-10-01',null,'','draft',null)",[site.organization_id]));
const record=(await as('manager',"select * from public.save_compliance($1,'Vérification tableau','audit','2026-12-01','scheduled','Note de suivi',null)",[site.id])).rows[0];
assert.equal((await as('client1','select * from public.compliance_records where id=$1',[record.id])).rows.length,0);
await assert.rejects(as('client2',"select public.save_compliance($1,'Interdit','audit','2026-12-01','pending','',null)",[site.id]));
await assert.rejects(as('manager',"delete from public.professional_audit where organization_id=$1",[site.organization_id]));
assert.ok((await as('manager','select * from public.professional_audit')).rows.length>=4);
console.log('PASS: contract/site follow-up isolation, viewer write rejection and append-only professional audit');
// A request estimate is not a financial commitment; the paid and accepted invoices are.
await as('manager',"select * from public.create_intervention('panel','Demande sans devis pour le rapport.','12 rue des bureaux','97200','Fort-de-France','urgent',$1)",[site.id]);
await db.query('update public.interventions set site_id=$1 where id=$2',[site.id,job.id]);
const report=(await as('manager','select * from public.professional_report($1)',[site.id])).rows[0];
assert.equal(Number(report.paid_cents),24000);
assert.equal(Number(report.committed_cents),24000);
assert.equal(Number(report.interventions),3);
assert.equal((await as('client1','select * from public.professional_report($1)',[site.id])).rows.length,0);
console.log('PASS: report aggregates paid/accepted quotes, excludes estimates, and respects site RLS');
await assert.rejects(as('client1',"select public.request_warranty($1,'Le problème électrique est revenu après intervention.')",[job.id]));
await assert.rejects(as('client1',"update public.app_settings set value='true' where key='warranty_requests_enabled'"));
await db.exec("update public.app_settings set value='true' where key='warranty_requests_enabled'");
await assert.rejects(as('client2',"select public.request_warranty($1,'Je ne suis pas le client propriétaire de ce dossier.')",[job.id]));
await db.query("update public.interventions set completed_at=now()-interval '1 year 1 day' where id=$1",[job.id]);
await assert.rejects(as('client1',"select public.request_warranty($1,'Cette intervention est hors de la fenêtre annuelle.')",[job.id]));
await db.query("update public.interventions set completed_at=now()-interval '1 day' where id=$1",[job.id]);
const warranty=(await as('client1',"select * from public.request_warranty($1,'Le problème électrique est revenu après intervention.')",[job.id])).rows[0];
await assert.rejects(as('client1',"select public.request_warranty($1,'Une seconde réclamation concurrente doit être refusée.')",[job.id]));
await assert.rejects(as('artisan1',"select public.resolve_warranty($1,'resolved','Résolution non autorisée par artisan')",[warranty.id]));
await as('admin',"select public.resolve_warranty($1,'reviewing','Réclamation reçue et en cours de contrôle.')",[warranty.id]);
console.log('PASS: warranty gate cannot be bypassed, only owner within year may request, one open case, admin-only resolution');
await db.close();
