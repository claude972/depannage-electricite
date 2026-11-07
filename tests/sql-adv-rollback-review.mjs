import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'',(error.stack||'').split('\n')[1]||'');process.exit(1)});
// QA-ADV-ROLLBACK-001 — local verification of scripts/qa-advanced-platform/rollback.sql under isolated
// PostgreSQL (@electric-sql/pglite@0.5.13 outside the app, PGLITE_MODULE → dist/index.js). Auth/Storage are
// explicit stubs (auth.users reproduces the real columns the script inserts); this is not a live Supabase run.
// Proves: the script runs green as a single BEGIN … ROLLBACK, emits its PASS report, and leaves every table
// (public.* and auth.users) with exactly the same row count as before; a wrong criterion aborts with QA001
// and still leaves no residue.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(
 id uuid primary key, instance_id uuid, aud varchar(255), role varchar(255), email varchar(255), encrypted_password varchar(255),
 email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz,
 is_sso_user boolean not null default false, is_anonymous boolean not null default false,phone text,phone_confirmed_at timestamptz);
create unique index users_email_partial_key on auth.users(lower(email)) where is_sso_user=false;
-- Supabase auth.uid(): request.jwt.claim.sub first, then request.jwt.claims->>'sub'.
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir=new URL('../supabase/migrations/',import.meta.url);
const migrations=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
for(const name of migrations)await db.exec((await isolatedMigrationSql(db, name, await readFile(new URL(name,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- extension omitted only in this isolated harness'));
assert.ok(migrations.some(n=>n.includes('_platform_operators'))&&migrations.some(n=>n.includes('_quote_documents'))&&migrations.some(n=>n.includes('_site_operations')),'014/015/017 present');
console.log(`PASS: ${migrations.length} migrations execute under isolated PostgreSQL with Auth/Storage stubs`);

const scriptUrl=new URL('../scripts/qa-advanced-platform/rollback.sql',import.meta.url);
const source=await readFile(scriptUrl,'utf8');
// ---- Source guarantees (what the contract forbids) ----------------------------------------------
const body=source.replace(/--[^\n]*/g,'');
assert.doesNotMatch(body,/(^|;)\s*commit\b|\bon\s+commit\b/i,'no COMMIT statement, no ON COMMIT clause');
assert.doesNotMatch(body,/\btruncate\b/i,'no TRUNCATE');
assert.doesNotMatch(body,/\bdrop\s+(table|schema|function|policy|trigger)\b/i,'no DROP');
assert.doesNotMatch(body,/disable\s+trigger|enable\s+trigger|session_replication_role/i,'no trigger bypass');
assert.doesNotMatch(body,/create\s+extension|alter\s+(table|policy|role|function)\b|create\s+policy|(^|;)\s*(grant|revoke)\s/i,'no schema/privilege change');
assert.doesNotMatch(body,/create\s+(or\s+replace\s+)?function\s+(?!pg_temp\.)/i,'functions only in pg_temp');
assert.doesNotMatch(body,/create\s+(temp\s+|temporary\s+)?table\s+(?!qa_)/i,'only qa_* temp tables');
assert.doesNotMatch(body,/\\[a-z]/,'no psql meta-command');
assert.doesNotMatch(source,/sb_secret|service_role_key|eyJ[A-Za-z0-9_-]{10,}\./,'no secret');
assert.match(body.trim(),/^begin;/i,'starts with BEGIN');
assert.match(body.trim(),/\brollback;\s*$/i,'ends with ROLLBACK');
assert.equal((body.match(/\brollback;/gi)||[]).length,1,'exactly one ROLLBACK, the last statement');
assert.match(body,/set local statement_timeout/i);assert.match(body,/set local lock_timeout/i);
assert.match(body,/set local role %I|set local role/i);
assert.match(body,/request\.jwt\.claims/);assert.match(body,/request\.jwt\.claim\.sub/);
assert.match(body,/errcode='QA001'/);
for(const needle of['platform_grant_scope','platform_revoke_scope','platform_reconcile','platform_record_commission_withheld','platform_request_refund','platform_settle_refund','platform_open_dispute','platform_invoice_readiness','platform_issue_invoice','platform_issue_credit_note','platform_moderate_review','set_quote_terms','generate_quote_document','propose_quote_amendment','reassign_intervention','save_site_equipment','set_organization_member_site_access','save_fiscal_year','publish_contract_grid','pause_sla_case','save_erp_checklist','site_operations_snapshot'])assert.ok(body.includes(needle),`exercises ${needle}`);
console.log('PASS: source — single BEGIN…ROLLBACK, no COMMIT/TRUNCATE/DROP/trigger bypass/privilege change, helpers only in pg_temp, no secret, every lot RPC exercised');

// ---- Row-count snapshot of every persistent table ----------------------------------------------
async function snapshot(){
 const tables=(await db.query("select table_schema s,table_name t from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth','storage') order by 1,2")).rows;
 const out={};
 for(const {s,t} of tables)out[`${s}.${t}`]=(await db.query(`select count(*)::int c from "${s}"."${t}"`)).rows[0].c;
 out['__admins']=(await db.query("select count(*)::int c from public.profiles where role='admin'")).rows[0].c;
 out['__seq_platform_audit']=(await db.query("select last_value::text v from public.platform_audit_id_seq")).rows[0].v;
 return out;
}
const before=await snapshot();
assert.ok(Object.keys(before).length>40,'tables discovered');
assert.equal(before['auth.users'],0);

// ---- Run the script exactly as shipped --------------------------------------------------------
const notices=[];
let results;
try{results=await db.exec(source,{onNotice:n=>notices.push(n.message||'')})}
catch(error){console.error('rollback.sql failed after these notices:\n'+notices.slice(-6).join('\n'));console.error(`${error.code||''} ${error.message}`);await db.exec('rollback').catch(()=>{});process.exit(1)}
const report=results.find(r=>r.rows&&r.rows.length&&r.fields?.some(f=>f.name==='line'));
assert.ok(report,'final report result set present');
const lines=report.rows.map(r=>r.line);
const passes=lines.filter(l=>l.startsWith('PASS '));
assert.ok(passes.length>=180,`at least 180 PASS lines (got ${passes.length})`);
assert.ok(lines.some(l=>/RÉSUMÉ run [0-9a-f]{8} :/.test(l)),'summary line with run tag');
assert.ok(lines.some(l=>/lignes QA avant ROLLBACK — auth\.users 13, profiles 13, interventions [0-9]+, quotes [0-9]+, payments 3,/.test(l)),'cohort counts reported before rollback');
assert.ok(lines.some(l=>/aucun fournisseur de paiement appelé/.test(l)),'simulated provider events declared');
assert.ok(lines.some(l=>/commission_bps absent : créé à 1000 bps/.test(l)),'missing commission setting created inside the transaction');
assert.ok(lines.some(l=>/démotion directe du dernier super admin/.test(l)),'single-admin branch executed (no real admin in the stub)');
assert.ok(lines.some(l=>/F\d{4}-000001/.test(l))&&lines.some(l=>/TVA cumulée des avoirs fractionnés = 17/.test(l)),'invoice numbering and cumulative VAT asserted');
assert.ok(lines.some(l=>/RLS documents après réaffectation/.test(l))&&lines.some(l=>/snapshot délégué/.test(l))&&lines.some(l=>/rapprochement sous plafond saturé/.test(l)),'015/017/limits criteria asserted');
assert.ok(notices.filter(n=>n.startsWith('QA-ADV-ROLLBACK | ')).length===lines.length,`every report line was also raised as NOTICE (${notices.length} notices, ${lines.length} lines)`);
console.log(`PASS: rollback.sql ran green — ${lines.length} report lines, ${passes.length} PASS, every line also emitted as NOTICE`);

// ---- Zero residue -------------------------------------------------------------------------------
const after=await snapshot();
const diff=Object.keys({...before,...after}).filter(k=>!k.startsWith('__seq')&&before[k]!==after[k]).map(k=>`${k}: ${before[k]} → ${after[k]}`);
assert.deepEqual(diff,[],'row counts identical before/after in every table');
assert.equal((await db.query("select count(*)::int c from auth.users where email like 'qa-rb-%@example.invalid'")).rows[0].c,0);
assert.equal((await db.query("select count(*)::int c from public.profiles where full_name like 'QA %'")).rows[0].c,0);
assert.equal(after.__admins,before.__admins,'admin count unchanged');
assert.equal((await db.query('select current_user u')).rows[0].u,'postgres','role reset after the script');
assert.equal((await db.query("select current_setting('request.jwt.claim.sub',true) s")).rows[0].s??'','', 'claims cleared');
assert.equal((await db.query("select count(*)::int c from pg_proc where proname like 'qa_%'")).rows[0].c,0,'no qa_* function survives (pg_temp dropped with the transaction)');
console.log(`PASS: zero residue — ${Object.keys(before).length-2} tables unchanged, no qa-rb- user/profile, admins ${after.__admins}, identity sequence advanced durably (${before.__seq_platform_audit} → ${after.__seq_platform_audit}) as documented`);

// ---- A wrong criterion aborts with QA001 and still leaves nothing --------------------------------
const mutated=source.replace("'22023','014 scope inconnu'","'P0001','014 scope inconnu'");
assert.notEqual(mutated,source,'mutation applied');
let failure=null;
try{await db.exec(mutated,{onNotice:()=>{}})}catch(error){failure=error}
assert.ok(failure,'mutated script must fail');
assert.equal(failure.code,'QA001',`QA001 expected, got ${failure.code}: ${failure.message}`);
assert.match(failure.message,/QA-ADV-ROLLBACK FAIL: 014 scope inconnu — code 22023/);
await db.exec('rollback').catch(()=>{});
const afterFailure=await snapshot();
assert.deepEqual(Object.keys(before).filter(k=>!k.startsWith('__seq')&&before[k]!==afterFailure[k]),[],'no residue after an aborted run');
assert.equal((await db.query("select count(*)::int c from auth.users where email like 'qa-rb-%'")).rows[0].c,0);
console.log('PASS: a wrong expected code aborts the whole run with QA001 (never a silent pass) and the aborted transaction leaves no residue');

// ---- Missing-schema refusal before any write ----------------------------------------------------
const noSchema=new PGlite();
await noSchema.exec("create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
let refused=null;
try{await noSchema.exec(source,{onNotice:()=>{}})}catch(error){refused=error}
assert.equal(refused?.code,'QA001');
assert.match(refused.message,/migration 014 absente/);
await noSchema.close();
console.log('PASS: a schema without 014–017 is refused with QA001 before any write');
await db.close();
console.log('SQL review complete: QA-ADV-ROLLBACK-001 rollback.sql verified in isolated PostgreSQL — green run, report emitted, zero residue');
