process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ADV-PLATFORM-FINANCE-001 — isolated PostgreSQL with explicit Auth/Storage stubs, never a live Supabase claim.
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
const dir=new URL('../supabase/migrations/',import.meta.url);
const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
for(const name of names)await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists pgcrypto;','-- extension omitted only in local harness'));
console.log(`PASS: all ${names.length} migrations execute under isolated PostgreSQL/Auth/Storage stubs`);
const ids={};let i=1;
for(const actor of['client','other','manager','artisan','otherArtisan','admin','admin2','finRead','finWrite','moderator','auditor']){
 ids[actor]=`30000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 const role=actor.includes('rtisan')?'artisan':actor==='manager'?'manager':'client';
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role,full_name:actor}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id in ($1,$2)",[ids.admin,ids.admin2]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function service(sql,params=[]){await db.exec('set role service_role');await db.query("select set_config('request.jwt.claim.sub','',false)");try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function scalar(actor,sql,params=[]){return(await as(actor,sql,params)).rows[0].v}
async function denied(promise,code){await assert.rejects(promise,error=>error.code===code||(()=>{console.error('unexpected',error.code,error.message);return false})())}
const uuid=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

// ---- 1. Operator scopes: explicit grants, never role=admin -------------------------------
let me=await scalar('finRead','select public.platform_access() v');assert.deepEqual(me,{super_admin:false,scopes:[],super_admin_count:null});
for(const actor of['client','manager','artisan','finRead'])await denied(as(actor,'select public.platform_grant_scope($1,$2,$3)',[ids.finWrite,'finance_write','']),'42501');
await denied(as('admin','select public.platform_grant_scope($1,$2,$3)',[ids.admin2,'finance_read','']),'P0001');
await denied(as('admin','select public.platform_grant_scope($1,$2,$3)',[ids.finRead,'support','']),'22023');
let g=await scalar('admin','select public.platform_grant_scope($1,$2,$3) v',[ids.finRead,'finance_read','lecture finance QA']);assert.equal(g.replayed,false);assert.equal(g.grant.status,'active');
assert.equal((await scalar('admin','select public.platform_grant_scope($1,$2,$3) v',[ids.finRead,'finance_read','rejeu'])).replayed,true);
for(const [actor,scope] of[['finWrite','finance_read'],['finWrite','finance_write'],['moderator','reviews_moderate'],['auditor','audit_read']])await as('admin','select public.platform_grant_scope($1,$2,$3)',[ids[actor],scope,'']);
me=await scalar('finWrite','select public.platform_access() v');assert.deepEqual(me.scopes,['finance_read','finance_write']);assert.equal(me.super_admin,false);
assert.equal(await scalar('finRead',"select public.has_platform_scope('finance_read') v"),true);
assert.equal(await scalar('finRead',"select public.has_platform_scope('finance_write') v"),false);
assert.equal(await scalar('admin',"select public.has_platform_scope('finance_write') v"),true);
assert.equal((await db.query("select count(*)::int c from public.profiles where role='admin'")).rows[0].c,2);
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_operator_grants'),1);
assert.equal(await scalar('client','select count(*)::int v from public.platform_operator_grants'),0);
assert.equal(await scalar('admin','select count(*)::int v from public.platform_operator_grants'),5);
for(const actor of['finRead','admin'])await denied(as(actor,'delete from public.platform_operator_grants'),'42501');
await denied(as('admin',"update public.platform_operator_grants set scope='finance_write'"),'42501');
await denied(service("update public.platform_operator_grants set scope='finance_write' where id=$1",[g.grant.id]),'P0001');
await denied(service("delete from public.platform_operator_grants where id=$1",[g.grant.id]),'42501');
console.log('PASS: scopes are explicit server grants; non-admins and super admins are refused as targets/actors; grant history cannot be rewritten even by service role');

// ---- 2. Audit immutability and audit_read scope ----------------------------------------
assert.equal(await scalar('auditor','select count(*)::int v from public.platform_audit'),5);
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_audit'),0);
assert.equal(await scalar('client','select count(*)::int v from public.platform_audit'),0);
for(const actor of['auditor','admin']){await denied(as(actor,"update public.platform_audit set action='x'"),'42501');await denied(as(actor,'delete from public.platform_audit'),'42501');}
await denied(service("update public.platform_audit set action='tamper'"),'42501');
await denied(service('delete from public.platform_audit'),'42501');
await denied(db.query("update public.platform_audit set action='tamper' where id=1"),'P0001');
await denied(db.query('delete from public.platform_audit where id=1'),'P0001');
await denied(db.query('truncate public.platform_audit'),'P0001');
const first=(await db.query('select created_at from public.platform_audit order by id limit 1')).rows[0].created_at;assert.ok(first);
console.log('PASS: audit is server-timestamped and immutable for operators, admins, service role and even the table owner');

// ---- 3. Revocation, last super admin --------------------------------------------------
const r=await scalar('admin','select public.platform_revoke_scope($1,$2) v',[g.grant.id,'fin de mission']);assert.equal(r.grant.status,'revoked');assert.equal(r.grant.revoked_by,ids.admin);
assert.equal((await scalar('admin','select public.platform_revoke_scope($1,$2) v',[g.grant.id,''])).replayed,true);
assert.equal(await scalar('finRead',"select public.has_platform_scope('finance_read') v"),false);
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_operator_grants'),1);
await denied(as('finRead','select public.platform_finance_report()'),'42501');
await denied(as('finRead','select public.platform_revoke_scope($1,$2)',[g.grant.id,'']),'42501');
await denied(as('admin','select public.platform_set_super_admin($1,false,$2,$3)',[ids.admin,'client','']),'P0001');
let sa=await scalar('admin','select public.platform_set_super_admin($1,false,$2,$3) v',[ids.admin2,'client','retrait QA']);assert.equal(sa.role,'client');
await denied(as('admin2','select public.platform_set_super_admin($1,false,$2,$3)',[ids.admin,'client','']),'42501');
await denied(as('admin','select public.platform_set_super_admin($1,true,$2,$3)',[ids.artisan,'client','']),'P0001');
await denied(db.query("update public.profiles set role='client' where id=$1",[ids.admin]),'P0001');
await denied(service("update public.profiles set role='manager' where id=$1",[ids.admin]),'P0001');
await denied(db.query('delete from auth.users where id=$1',[ids.admin]),'P0001');
await denied(db.query('delete from public.profiles where id=$1',[ids.admin]),'P0001');
assert.equal((await db.query("select count(*)::int c from public.profiles where role='admin'")).rows[0].c,1);
await as('admin','select public.platform_grant_scope($1,$2,$3)',[ids.admin2,'audit_read','']);
sa=await scalar('admin','select public.platform_set_super_admin($1,true,$2,$3) v',[ids.admin2,'client','retour']);assert.equal(sa.role,'admin');
assert.equal(await scalar('admin2','select count(*)::int v from public.platform_operator_grants where user_id=$1 and status=$2',[ids.admin2,'active']),0);
await db.query("update public.profiles set role='client' where id=$1",[ids.admin2]);
console.log('PASS: revocation keeps history and closes access immediately; the last super admin survives RPC, direct update, service role and auth cascade');

// ---- 4. Settings: commission rate and issuer are super-admin only, validated ---------------
for(const actor of['finWrite','client'])await denied(as(actor,'select public.platform_set_setting($1,$2,null)',['commission_bps',JSON.stringify({bps:1500})]),'42501');
await denied(as('admin','select public.platform_set_setting($1,$2,null)',['commission_bps',JSON.stringify({bps:10001})]),'22023');
await denied(as('admin','select public.platform_set_setting($1,$2,null)',['commission_bps',JSON.stringify({bps:15,extra:1})]),'22023');
await denied(as('admin','select public.platform_set_setting($1,$2,null)',['other',JSON.stringify({})]),'22023');
await denied(as('admin','select public.platform_set_setting($1,$2,null)',['invoice_issuer',JSON.stringify({legal_name:'Plateforme QA',siret:'123',address:'1 rue du Test',vat_number:null,commission_vat_rate:null})]),'22023');
let setting=await scalar('admin','select public.platform_set_setting($1,$2,null) v',['commission_bps',JSON.stringify({bps:1500})]);assert.equal(setting.setting.version,1);
await denied(as('admin','select public.platform_set_setting($1,$2,null)',['commission_bps',JSON.stringify({bps:1000})]),'P0001');
setting=await scalar('admin','select public.platform_set_setting($1,$2,1) v',['commission_bps',JSON.stringify({bps:1000})]);assert.equal(setting.setting.version,2);
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_settings'),0);
assert.equal(await scalar('finWrite','select count(*)::int v from public.platform_settings'),1);
console.log('PASS: commission rate and issuer are persisted super-admin settings with strict validation and optimistic versions');

// ---- 5. Real business flow to reach a settled payment -----------------------------------
for(const actor of['artisan','otherArtisan']){
 await as(actor,"select public.save_artisan_profile('Électricité QA','12345678901234','EI',0,'12 rue du Test, 97200 Fort-de-France',array['97200'],array['panel'])");
 await as(actor,'select public.submit_artisan_application()');await as('admin','select public.approve_artisan($1,true)',[ids[actor]]);await as(actor,'select public.set_artisan_availability(true)');
}
async function settledJob(actor,n){
 const job=(await as(actor,"select * from public.create_intervention('panel','Panne électrique du tableau principal.','12 rue du Test','97200','Fort-de-France','urgent',null)")).rows[0];
 await as('artisan',"select public.intervention_action($1,'accept_mission')",[job.id]);
 await as('artisan',"select public.intervention_action($1,'send_quote',$2,20)",[job.id,JSON.stringify([{label:'Remplacement disjoncteur',quantity:1,unit_price_cents:15000},{label:'Main d’œuvre',quantity:2,unit_price_cents:5000}])]);
 const quote=(await db.query("select * from public.quotes where intervention_id=$1 and status='sent'",[job.id])).rows[0];
 await as(actor,"select public.intervention_action($1,'accept_quote',null,20,$2)",[job.id,quote.id]);
 await as('artisan',"select public.intervention_action($1,'start')",[job.id]);await as('artisan',"select public.intervention_action($1,'complete')",[job.id]);
 await service("insert into public.payments(quote_id,session_id,total_cents,currency,status) values($1,$2,$3,'eur','pending')",[quote.id,`cs_test_${n}`,quote.total_cents]);
 assert.equal((await service('select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6) v',[`evt_${n}`,'checkout.session.completed',`cs_test_${n}`,quote.id,quote.total_cents,'eur'])).rows[0].v,true);
 const payment=(await db.query('select * from public.payments where quote_id=$1',[quote.id])).rows[0];assert.equal(payment.status,'paid');assert.equal(payment.total_cents,30000);
 return {job,quote,payment};
}
const a=await settledJob('client',1), b=await settledJob('other',2);
const pendingQuote=(await db.query("select * from public.quotes where id=$1",[a.quote.id])).rows[0];assert.equal(pendingQuote.status,'accepted');

// ---- 6. Ledger: idempotent reconciliation with server-trusted rate snapshot --------------
await denied(as('finRead','select public.platform_reconcile(100)'),'42501');
await denied(as('client','select public.platform_reconcile(100)'),'42501');
await denied(as('finWrite','select public.platform_reconcile(0)'),'22023');
let run=await scalar('finWrite','select public.platform_reconcile(100) v');assert.deepEqual(run,{settled_added:2,commission_added:2,commission_bps:1000,setting_version:2,remaining_unsettled:0});
run=await scalar('finWrite','select public.platform_reconcile(100) v');assert.deepEqual(run,{settled_added:0,commission_added:0,commission_bps:1000,setting_version:2,remaining_unsettled:0});
const entries=(await as('finWrite','select entry_kind,direction,amount_cents,currency,external_event_id,basis from public.platform_ledger_entries where payment_id=$1 order by entry_kind',[a.payment.id])).rows;
assert.equal(entries.length,2);assert.deepEqual(entries.map(e=>[e.entry_kind,e.direction,e.amount_cents,e.currency]),[['commission_estimated','debit',3000,'eur'],['payment_settled','credit',30000,'eur']]);
assert.equal(entries[1].external_event_id,'cs_test_1');assert.deepEqual(entries[0].basis,{rate_source:'platform_setting',bps:1000,setting_version:2,gross_cents:30000});
await as('admin','select public.platform_set_setting($1,$2,2)',['commission_bps',JSON.stringify({bps:2500})]);
run=await scalar('finWrite','select public.platform_reconcile(100) v');assert.equal(run.commission_added,0);
assert.equal((await db.query("select amount_cents from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_estimated'",[a.payment.id])).rows[0].amount_cents,3000);
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_ledger_entries'),0);
assert.equal(await scalar('finWrite','select count(*)::int v from public.platform_ledger_entries'),4);
for(const actor of['finWrite','admin']){await denied(as(actor,'update public.platform_ledger_entries set amount_cents=1'),'42501');await denied(as(actor,'delete from public.platform_ledger_entries'),'42501');}
await denied(service('update public.platform_ledger_entries set amount_cents=1'),'42501');
await denied(db.query('update public.platform_ledger_entries set amount_cents=1'),'P0001');
await denied(db.query('delete from public.platform_ledger_entries'),'P0001');
let report=await scalar('finWrite','select public.platform_finance_report() v');
assert.equal(report.payments.paid_count,2);assert.equal(report.payments.paid_cents,60000);assert.equal(report.ledger.settled_cents,60000);assert.equal(report.ledger.missing_settlement,0);assert.equal(report.ledger.amount_mismatches,0);
assert.equal(report.ledger.commission_estimated_cents,6000);assert.equal(report.ledger.commission_withheld_cents,0);assert.equal(report.commission_setting.bps,2500);
console.log('PASS: reconciliation is idempotent, snapshots the audited rate per entry, never rewrites past estimates, and the ledger is immutable');

// ---- 7. Commission withheld: service only, provider result verified ----------------------
const withheld='select public.platform_record_commission_withheld($1,$2,$3,$4,$5,$6,$7,$8) v';
await denied(as('finWrite',withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',3000,'eur']),'42501');
await denied(as('admin',withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',3000,'eur']),'42501');
await denied(service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','pending',3000,'eur']),'P0001');
await denied(service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_WRONG','fee_1','succeeded',3000,'eur']),'P0001');
await denied(service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',30001,'eur']),'P0001');
await denied(service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',3000,'usd']),'22023');
assert.equal((await db.query("select count(*)::int c from public.stripe_events where id='evt_fee_1'")).rows[0].c,0);
assert.equal((await service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',3000,'eur'])).rows[0].v,true);
assert.equal((await service(withheld,[a.payment.id,'evt_fee_1','application_fee.created','cs_test_1','fee_1','succeeded',3000,'eur'])).rows[0].v,false);
await denied(service(withheld,[a.payment.id,'evt_fee_2','application_fee.created','cs_test_1','fee_1','succeeded',3000,'eur']),'P0001');
console.log('PASS: withheld commission needs service role, a succeeded provider result, matching session/amount/currency, and is recorded once');

// ---- 8. Refund requests: requested never equals done ---------------------------------------
const request='select public.platform_request_refund($1,$2,$3,$4) v', decide='select public.platform_decide_refund($1,$2,$3,$4) v';
await denied(as('finRead',request,[uuid(1),a.payment.id,5000,'Prestation partiellement non réalisée.']),'42501');
await denied(as('client',request,[uuid(1),a.payment.id,5000,'Prestation partiellement non réalisée.']),'42501');
let rr=await scalar('finWrite',request,[uuid(1),a.payment.id,5000,'Prestation partiellement non réalisée.']);assert.equal(rr.request.status,'requested');assert.equal(rr.replayed,false);
assert.equal((await scalar('finWrite',request,[uuid(1),a.payment.id,5000,'Prestation partiellement non réalisée.'])).replayed,true);
await denied(as('finWrite',request,[uuid(1),a.payment.id,6000,'Prestation partiellement non réalisée.']),'P0001');
await denied(as('finWrite',request,[uuid(2),a.payment.id,25001,'Dépassement du montant réglé.']),'P0001');
await denied(as('finWrite',request,[uuid(2),a.payment.id,0,'Montant nul refusé ici.']),'22023');
await service("insert into public.payments(quote_id,session_id,total_cents,currency,status) select q.id,'cs_pending',q.total_cents,'eur','pending' from public.quotes q where false");
const second=await scalar('finWrite',request,[uuid(3),a.payment.id,25000,'Solde complémentaire demandé.']);assert.equal(second.request.amount_cents,25000);
await denied(as('finWrite',request,[uuid(4),a.payment.id,1,'Au-delà du total réglé.']),'P0001');
await denied(as('finWrite',decide,[rr.request.id,'approve',2,'']),'P0001');
await denied(as('finWrite',decide,[rr.request.id,'reject',1,'court']),'22023');
await denied(as('finRead',decide,[rr.request.id,'approve',1,'']),'42501');
rr=await scalar('finWrite',decide,[rr.request.id,'approve',1,'']);assert.equal(rr.request.status,'approved');assert.equal(rr.request.version,2);
await denied(as('finWrite',decide,[rr.request.id,'approve',2,'']),'P0001');
await denied(as('finWrite',decide,[rr.request.id,'reject',2,'Rejet après approbation interdit']),'P0001');
assert.equal((await db.query("select status from public.platform_refund_requests where id=$1",[rr.request.id])).rows[0].status,'approved');
assert.equal((await db.query("select count(*)::int c from public.platform_ledger_entries where entry_kind='refund_settled'")).rows[0].c,0);
const cancelled=await scalar('finWrite',decide,[second.request.id,'cancel',1,'Demande retirée.']);assert.equal(cancelled.request.status,'cancelled');
const third=await scalar('finWrite',request,[uuid(5),a.payment.id,25000,'Le montant redevient disponible après annulation.']);assert.equal(third.request.status,'requested');
const settle='select public.platform_settle_refund($1,$2,$3,$4,$5,$6,$7,$8) v';
for(const actor of['finWrite','admin'])await denied(as(actor,settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','succeeded',5000,'eur']),'42501');
await denied(service(settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','failed',5000,'eur']),'P0001');
await denied(service(settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','succeeded',4999,'eur']),'P0001');
await denied(service(settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_2','re_1','succeeded',5000,'eur']),'P0001');
await denied(service(settle,[third.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','succeeded',25000,'eur']),'P0001');
assert.equal((await db.query("select count(*)::int c from public.stripe_events where id='evt_rf_1'")).rows[0].c,0);
assert.equal((await service(settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','succeeded',5000,'eur'])).rows[0].v,true);
assert.equal((await service(settle,[rr.request.id,'evt_rf_1','charge.refunded','cs_test_1','re_1','succeeded',5000,'eur'])).rows[0].v,false);
const settled=(await db.query('select status,settled_event_id,provider_reference from public.platform_refund_requests where id=$1',[rr.request.id])).rows[0];assert.deepEqual(settled,{status:'settled',settled_event_id:'evt_rf_1',provider_reference:'re_1'});
assert.equal((await db.query("select amount_cents from public.platform_ledger_entries where entry_kind='refund_settled'")).rows[0].amount_cents,5000);
await denied(as('finWrite','delete from public.platform_refund_requests'),'42501');await denied(db.query('delete from public.platform_refund_requests'),'P0001');
report=await scalar('finWrite','select public.platform_finance_report() v');assert.deepEqual(report.refund_requests,{settled:{count:1,cents:5000},cancelled:{count:1,cents:25000},requested:{count:1,cents:25000}});
console.log('PASS: refund requests are capped by the settled amount, follow strict transitions with versions, and only a verified service event settles them');

// ---- 9. Disputes --------------------------------------------------------------------------
const open='select public.platform_open_dispute($1,$2,$3,$4,$5) v', dd='select public.platform_decide_dispute($1,$2,$3,$4,$5,$6) v';
await denied(as('finRead',open,[uuid(10),a.payment.id,'client','Contestation','Le client conteste une partie de la prestation.']),'42501');
let d=await scalar('finWrite',open,[uuid(10),a.payment.id,'client','Contestation','Le client conteste une partie de la prestation.']);assert.equal(d.dispute.status,'open');assert.equal(d.dispute.intervention_id,a.job.id);
assert.equal((await scalar('finWrite',open,[uuid(10),a.payment.id,'client','Contestation','Le client conteste une partie de la prestation.'])).replayed,true);
await denied(as('finWrite',open,[uuid(10),a.payment.id,'artisan','Contestation','Le client conteste une partie de la prestation.']),'P0001');
await denied(as('finWrite',dd,[d.dispute.id,'resolve',1,'Résolu sans examen','no_refund',null]),'P0001');
d=await scalar('finWrite',dd,[d.dispute.id,'review',1,'',null,null]);assert.equal(d.dispute.status,'under_review');
await denied(as('finWrite',dd,[d.dispute.id,'resolve',2,'Note suffisante ici','refund_requested',null]),'22023');
const foreign=await scalar('finWrite',request,[uuid(6),b.payment.id,1000,'Demande sur un autre paiement.']);
await denied(as('finWrite',dd,[d.dispute.id,'resolve',2,'Note suffisante ici','refund_requested',foreign.request.id]),'P0001');
d=await scalar('finWrite',dd,[d.dispute.id,'resolve',2,'Remboursement partiel demandé.','refund_requested',third.request.id]);assert.equal(d.dispute.status,'resolved');assert.equal(d.dispute.refund_request_id,third.request.id);
await denied(as('finWrite',dd,[d.dispute.id,'close',3,'',null,null]),'P0001');
console.log('PASS: disputes follow open → under_review → resolved/closed with versioned decisions bound to the same payment');

// ---- 10. Invoices from real conditions only -------------------------------------------------
const readiness='select public.platform_invoice_readiness($1,$2) v', issue='select public.platform_issue_invoice($1,$2,$3) v', credit='select public.platform_issue_credit_note($1,$2,$3,$4) v';
await denied(as('client',readiness,['service',a.payment.id]),'42501');
let ready=await scalar('finWrite',readiness,['service',a.payment.id]);assert.equal(ready.ready,false);assert.deepEqual(ready.missing,['billing_contact']);assert.equal(ready.preview.recipient,null);assert.equal(ready.preview.service_address,'12 rue du Test, 97200 Fort-de-France');
await denied(as('finWrite',issue,[uuid(20),'service',a.payment.id]),'P0001');
await denied(as('finRead','select public.platform_set_billing_contact($1,$2,$3,$4,null,null,null)',['profile',ids.client,'Client QA','4 rue des Tests, 97200 Fort-de-France']),'42501');
await denied(as('finWrite','select public.platform_set_billing_contact($1,$2,$3,$4,$5,null,null)',['profile',ids.client,'Client QA','4 rue des Tests, 97200 Fort-de-France','12']),'22023');
const bc=await scalar('finWrite','select public.platform_set_billing_contact($1,$2,$3,$4,null,null,null) v',['profile',ids.client,'Client QA','4 rue des Tests, 97200 Fort-de-France']);assert.equal(bc.billing_contact.version,1);
await denied(as('finWrite','select public.platform_set_billing_contact($1,$2,$3,$4,null,null,null)',['profile',ids.client,'Client QA 2','4 rue des Tests, 97200 Fort-de-France']),'P0001');
ready=await scalar('finWrite',readiness,['service',a.payment.id]);assert.equal(ready.ready,true);assert.equal(ready.preview.recipient.name,'Client QA');assert.equal(ready.preview.issuer.siret,'12345678901234');assert.equal(ready.preview.total_cents,30000);assert.equal(ready.preview.tax_cents,5000);
await db.query("update public.artisan_profiles set siret='' where user_id=$1",[ids.artisan]);
ready=await scalar('finWrite',readiness,['service',a.payment.id]);assert.deepEqual(ready.missing,['artisan_siret']);
await denied(as('finWrite',issue,[uuid(20),'service',a.payment.id]),'P0001');
await db.query("update public.artisan_profiles set siret='12345678901234' where user_id=$1",[ids.artisan]);
await denied(as('finRead',issue,[uuid(20),'service',a.payment.id]),'42501');
let inv=await scalar('finWrite',issue,[uuid(20),'service',a.payment.id]);assert.equal(inv.invoice.number,`F${new Date().getFullYear()}-000001`);assert.equal(inv.invoice.issuer_key,`artisan:${ids.artisan}`);assert.equal(inv.invoice.total_cents,30000);
assert.equal((await scalar('finWrite',issue,[uuid(20),'service',a.payment.id])).replayed,true);
await denied(as('finWrite',issue,[uuid(20),'service',b.payment.id]),'P0001');
await denied(as('finWrite',issue,[uuid(21),'service',a.payment.id]),'P0001');
ready=await scalar('finWrite',readiness,['platform_commission',a.payment.id]);assert.deepEqual(ready.missing,['platform_issuer','platform_commission_vat_rate']);
await as('admin','select public.platform_set_setting($1,$2,null)',['invoice_issuer',JSON.stringify({legal_name:'Plateforme QA',siret:'98765432109876',address:'1 rue de la Plateforme, 97200 Fort-de-France',vat_number:'FR12345678901',commission_vat_rate:20})]);
ready=await scalar('finWrite',readiness,['platform_commission',a.payment.id]);assert.equal(ready.ready,true);assert.equal(ready.preview.total_cents,3000);assert.equal(ready.preview.tax_cents,500);assert.equal(ready.preview.subtotal_cents,2500);assert.equal(ready.preview.issuer.legal_name,'Plateforme QA');
ready=await scalar('finWrite',readiness,['platform_commission',b.payment.id]);assert.deepEqual(ready.missing,['commission_not_confirmed']);
await denied(as('finWrite',issue,[uuid(22),'platform_commission',b.payment.id]),'P0001');
const cinv=await scalar('finWrite',issue,[uuid(23),'platform_commission',a.payment.id]);assert.equal(cinv.invoice.number,`F${new Date().getFullYear()}-000001`);assert.equal(cinv.invoice.issuer_key,'platform');assert.equal(cinv.invoice.total_cents,3000);
await denied(as('finWrite',credit,[uuid(30),inv.invoice.id,30001,'Avoir supérieur à la facture.']),'P0001');
let cn=await scalar('finWrite',credit,[uuid(30),inv.invoice.id,12000,'Remise commerciale après litige.']);assert.equal(cn.invoice.kind,'credit_note');assert.equal(cn.invoice.number,`A${new Date().getFullYear()}-000001`);assert.equal(cn.invoice.tax_cents,2000);assert.equal(cn.invoice.subtotal_cents,10000);
assert.equal((await scalar('finWrite',credit,[uuid(30),inv.invoice.id,12000,'Remise commerciale après litige.'])).replayed,true);
await denied(as('finWrite',credit,[uuid(30),inv.invoice.id,12001,'Remise commerciale après litige.']),'P0001');
await denied(as('finWrite',credit,[uuid(31),inv.invoice.id,18001,'Dépasse le solde restant.']),'P0001');
await denied(as('finWrite',credit,[uuid(32),cn.invoice.id,100,'Avoir sur un avoir refusé.']),'P0001');
await scalar('finWrite',credit,[uuid(33),inv.invoice.id,18000,'Solde intégral annulé.']);
for(const actor of['finWrite','admin']){await denied(as(actor,'update public.platform_invoices set total_cents=1'),'42501');await denied(as(actor,'delete from public.platform_invoices'),'42501');}
await denied(db.query('delete from public.platform_invoices'),'P0001');await denied(db.query('update public.platform_invoices set total_cents=1'),'P0001');
assert.equal(await scalar('finRead','select count(*)::int v from public.platform_invoices'),0);
assert.equal(await scalar('finWrite','select count(*)::int v from public.platform_invoices'),4);
console.log('PASS: invoices require a real issuer, billing contact and settled payment; commission invoices need a confirmed withheld amount with VAT extracted; credit notes are capped and immutable');

// ---- 11. Review moderation and contestation ------------------------------------------------
const review=(await as('client','select * from public.submit_review($1,5,$2)',[a.job.id,'Intervention rapide et propre.'])).rows[0];
const moderate='select public.platform_moderate_review($1,$2,$3,$4) v', contest='select public.platform_contest_review($1,$2,$3) v', decideC='select public.platform_decide_contestation($1,$2,$3,$4) v';
for(const actor of['client','artisan','finWrite','admin2'])await denied(as(actor,moderate,[review.id,'hide','Contenu inapproprié QA',null]),'42501');
await denied(as('moderator',moderate,[review.id,'restore','',null]),'P0001');
await denied(as('moderator',moderate,[review.id,'hide','court',null]),'22023');
assert.equal(await scalar('finWrite','select count(*)::int v from public.reviews'),0);
assert.equal(await scalar('moderator','select count(*)::int v from public.reviews where id=$1',[review.id]),1);
for(const actor of['otherArtisan','other'])await denied(as(actor,contest,[uuid(40),review.id,'Cet avis ne concerne pas ma prestation.']),'42501');
let c=await scalar('artisan',contest,[uuid(40),review.id,'Le client a refusé une partie des travaux.']);assert.equal(c.contestation.status,'open');
assert.equal((await scalar('artisan',contest,[uuid(40),review.id,'Le client a refusé une partie des travaux.'])).replayed,true);
await denied(as('artisan',contest,[uuid(41),review.id,'Seconde contestation ouverte refusée.']),'23505');
assert.equal(await scalar('artisan','select count(*)::int v from public.platform_review_contestations'),1);
assert.equal(await scalar('client','select count(*)::int v from public.platform_review_contestations'),0);
const perfBefore=(await as('artisan',"select public.artisan_performance(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day') v")).rows[0].v;assert.equal(perfBefore.rating.count,1);assert.equal(Number(perfBefore.rating.average),5);
for(const actor of['artisan','client'])await denied(as(actor,decideC,[c.contestation.id,'upheld','Contestation fondée.',1]),'42501');
c=await scalar('moderator',decideC,[c.contestation.id,'upheld','Contestation fondée après vérification.',1]);assert.equal(c.contestation.status,'upheld');assert.equal(c.moderation.state,'hidden');
await denied(as('moderator',decideC,[c.contestation.id,'dismissed','Déjà tranchée.',2]),'P0001');
assert.equal(await scalar('artisan','select count(*)::int v from public.reviews where id=$1',[review.id]),0);
assert.equal(await scalar('client','select count(*)::int v from public.reviews where id=$1',[review.id]),1);
assert.equal(await scalar('moderator','select count(*)::int v from public.reviews where id=$1',[review.id]),1);
assert.equal(await scalar('admin','select count(*)::int v from public.reviews where id=$1',[review.id]),1);
assert.equal(await scalar('finWrite','select count(*)::int v from public.reviews where id=$1',[review.id]),0);
assert.equal((await db.query('select count(*)::int c from public.reviews where id=$1',[review.id])).rows[0].c,1);
const perfHidden=(await as('artisan',"select public.artisan_performance(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day') v")).rows[0].v;assert.equal(perfHidden.rating.count,0);assert.equal(perfHidden.rating.average,null);
for(const actor of['artisan','moderator','admin'])await denied(as(actor,"select public.artisan_performance_before_review_moderation(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day')"),'42501');
await db.exec('set role anon');await assert.rejects(db.query("select public.artisan_performance_before_review_moderation(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day')"));await db.exec('reset role');
await denied(as('moderator',moderate,[review.id,'restore','',5]),'P0001');
await denied(as('moderator',moderate,[review.id,'hide','Déjà masqué : refus attendu.',1]),'P0001');
const restored=await scalar('moderator',moderate,[review.id,'restore','Rétabli après nouvel examen.',1]);assert.equal(restored.moderation.state,'visible');assert.equal(restored.moderation.version,2);
assert.equal(await scalar('artisan','select count(*)::int v from public.reviews where id=$1',[review.id]),1);
const perfAfter=(await as('artisan',"select public.artisan_performance(now()-interval '1 day',now()+interval '1 day',now()-interval '3 day',now()-interval '1 day') v")).rows[0].v;assert.equal(perfAfter.rating.count,1);
for(const actor of['moderator','admin']){await denied(as(actor,'delete from public.reviews'),'42501');await denied(as(actor,'delete from public.platform_review_moderation'),'42501');await denied(as(actor,'delete from public.platform_review_contestations'),'42501');}
await denied(db.query('delete from public.platform_review_moderation'),'P0001');
const auditKinds=(await as('auditor',"select action from public.platform_audit where target_kind='review' order by id")).rows.map(r=>r.action);
assert.deepEqual(auditKinds,['review_contested','contestation_decided','review_restored']);
console.log('PASS: limited moderator reads hidden reviews, finance-only operator and third parties do not, author always does; hidden reviews leave artisan_performance; the legacy aggregate is unreachable; nothing is deleted');

// ---- 12. Rate limits apply atomically ---------------------------------------------------
await db.exec('begin');
await db.query("insert into public.action_limits(actor_id,action,window_start,count) values($1,'platform_reconcile',date_trunc('minute',now()),10) on conflict(actor_id,action,window_start) do update set count=10",[ids.finWrite]);
await db.exec('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.finWrite]);
await denied(db.query('select public.platform_reconcile(100)'),'53300');
await db.exec('rollback');
console.log('PASS: per-account platform limits reject excess atomically');
await db.close();
