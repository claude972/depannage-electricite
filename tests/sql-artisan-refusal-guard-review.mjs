// ADM-02 — a definitive refusal of an artisan application is enforced by the database (migration
// 20261122170000), in real isolated SQL (PGlite). Finding of the independent review of 22 November
// 2026: the refusal was checked by the web route only, while the SQL command stays callable with the
// artisan's own session. Not a live Supabase claim.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      is_anonymous boolean not null default false, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
    const migration = await isolatedMigrationSql(db, name, await readFile(new URL(name, dir), "utf8"));
    await db.exec(migration.replace("create extension if not exists pgcrypto;", "-- stub for isolated test"));
  }
  let checks = 0;
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0]?.v;
  async function as(actor, role) { await db.exec("reset role"); await q("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]); if (role) await db.exec(`set role ${role}`); }
  const deny = async (p, code, message) => { await assert.rejects(p, (e) => e.code === code && (!message || e.message === message), `attendu ${code}`); checks++; };
  const ids = Object.fromEntries(["artisan", "other", "admin"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "admin" ? "client" : "artisan", full_name: "QA" }), n + "@example.invalid"]);
  for (const who of ["artisan", "other"]) {
    await q("insert into public.artisan_profiles(user_id)values($1)on conflict do nothing", [ids[who]]);
    await q("update public.artisan_profiles set company_name='QA entreprise',siret='12345678901234',address='QA adresse 97200',postal_codes=array['97200'],categories=array['panel'],application_status='changes_requested' where user_id=$1", [ids[who]]);
  }
  const status = (who) => one("select application_status v from public.artisan_profiles where user_id=$1", [ids[who]]);
  const submit = async (who) => { await as(ids[who], "authenticated"); try { return await q("select public.submit_artisan_application()"); } finally { await as(null, null); } };
  let n = 0;
  const decision = (who, payload, at) => q(`insert into public.notifications(recipient_id,kind,title,body,actor_id,payload,dedupe_key,created_at)values($1,'account_suspended','QA décision','QA motif',$2,$3,$4,now()+($5||' seconds')::interval)`, [ids[who], ids.admin, payload, "application-decision:qa-" + ++n, String(at)]);

  // ---- 1. A request for changes (not definitive) leaves the resubmission open.
  await decision("other", { application_decision: "request_changes", reason: "QA compléments" }, 1);
  await submit("other");
  eq(await status("other"), "submitted", "compléments demandés : nouvelle soumission acceptée");

  // ---- 2. A definitive refusal closes the SQL command itself, whatever the client used.
  await decision("artisan", { application_decision: "request_changes", reason: "QA refus", definitive: true }, 1);
  await deny(submit("artisan"), "P0001", "Application refused by the operator");
  eq(await status("artisan"), "changes_requested", "le dossier refusé n’est pas resoumis");
  eq(await one("select count(*)::integer v from public.audit_log where actor_id=$1 and action='artisan_application_submitted'", [ids.artisan]), 0, "aucune trace de soumission");

  // ---- 3. An unrelated notification does not lift the refusal.
  await q("insert into public.notifications(recipient_id,kind,title,body,dedupe_key,created_at)values($1,'message_received','QA','QA','qa-unrelated',now()+interval'2 seconds')", [ids.artisan]);
  await deny(submit("artisan"), "P0001", "Application refused by the operator");

  // ---- 4. The artisan cannot lift it: the decision log is not writable by members.
  await as(ids.artisan, "authenticated");
  await deny(q("insert into public.notifications(recipient_id,kind,title,body,payload,dedupe_key)values($1,'account_approved','x','x','{\"application_decision\":\"reopen\"}','forged')", [ids.artisan]), "42501");
  await deny(q("select public.artisan_application_refused($1)", [ids.artisan]), "42501");
  await deny(q("select public.submit_artisan_application_before_refusal_guard()"), "42501");
  await as(null, null);

  // ---- 5. Reopened by the administration: the latest decision wins and the command works again.
  await decision("artisan", { application_decision: "reopen", reason: "QA réouverture" }, 3);
  await submit("artisan");
  eq(await status("artisan"), "submitted", "réouverture : nouvelle soumission acceptée");

  console.log(`PASS: a definitive refusal closes submit_artisan_application until the administration reopens (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
