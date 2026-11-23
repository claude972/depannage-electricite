// ADM-02 — the decision and its log entry (reason, « definitive ») are one transaction (migration
// 20261123090000), in real isolated SQL (PGlite). Follow-up R-SRV-19 of the diff review. Not a live
// Supabase claim.
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
  const deny = async (p, code) => { await assert.rejects(p, (e) => e.code === code || (console.error("unexpected", e.code, e.message), false), `attendu ${code}`); checks++; };
  const ids = Object.fromEntries(["artisan", "admin", "client"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "artisan" ? "artisan" : "client", full_name: "QA" }), n + "@example.invalid"]);
  await q("update public.profiles set role='admin' where id=$1", [ids.admin]);
  await q("insert into public.artisan_profiles(user_id)values($1)on conflict do nothing", [ids.artisan]);
  await q("update public.artisan_profiles set company_name='QA entreprise',siret='12345678901234',address='QA adresse 97200',postal_codes=array['97200'],categories=array['panel'],application_status='submitted',submitted_at=now() where user_id=$1", [ids.artisan]);
  const dossier = async () => (await q("select application_status s,application_version v from public.artisan_profiles where user_id=$1", [ids.artisan]))[0];
  const log = () => q("select kind,title,body,actor_id,payload,dedupe_key from public.notifications where recipient_id=$1 and payload->>'application_decision' is not null order by created_at,id", [ids.artisan]);
  const call = async (who, args) => { await as(ids[who], "authenticated"); try { return await one("select public.record_artisan_application_decision($1,$2,$3,$4,$5,$6)v", args); } finally { await as(null, null); } };
  const REASON = "Activité hors périmètre, candidature non retenue.";
  let d = await dossier();

  // ---- 1. Rights and validation: nothing is decided, nothing is logged.
  await deny(call("client", [ids.artisan, "request_changes", d.v, crypto.randomUUID(), REASON, true]), "42501");
  await deny(call("artisan", [ids.artisan, "approve", d.v, crypto.randomUUID(), null, false]), "42501");
  await deny(call("admin", [ids.artisan, "request_changes", d.v, crypto.randomUUID(), null, false]), "22023");
  await deny(call("admin", [ids.artisan, "request_changes", d.v, crypto.randomUUID(), "court", true]), "22023");
  await deny(call("admin", [ids.artisan, "suspend", d.v, crypto.randomUUID(), REASON, true]), "22023");
  await deny(call("admin", [ids.artisan, "delete", d.v, crypto.randomUUID(), REASON, false]), "22023");
  eq([(await dossier()).s, (await log()).length], ["submitted", 0], "refus de droits ou de validation : ni décision ni journal");

  // ---- 2. Definitive refusal: decision and log entry together.
  const command = crypto.randomUUID();
  eq(await call("admin", [ids.artisan, "request_changes", d.v, command, "  " + REASON + "  ", true]), { success: true, reason_recorded: true }, "décision enregistrée avec son motif");
  let rows = await log();
  eq((await dossier()).s, "changes_requested", "dossier renvoyé");
  eq(rows.length, 1, "une entrée au journal des décisions");
  eq([rows[0].kind, rows[0].title, rows[0].body, rows[0].actor_id, rows[0].dedupe_key], ["account_suspended", "Candidature refusée", "Motif communiqué par l’exploitant : " + REASON, ids.admin, "application-decision:" + command], "même forme que l’écriture de la route");
  eq(rows[0].payload, { application_decision: "request_changes", reason: REASON, application_version: d.v, definitive: true }, "motif, version et marque « définitif »");

  // ---- 3. The guard of 20261122170000 sees it at once: no window between decision and refusal.
  await as(ids.artisan, "authenticated");
  await deny(q("select public.submit_artisan_application()"), "P0001");
  await as(null, null);

  // ---- 4. Replay of the same command: no second decision, no second entry.
  eq(await call("admin", [ids.artisan, "request_changes", d.v, command, REASON, true]), { success: true, reason_recorded: true }, "rejeu accepté");
  eq((await log()).length, 1, "rejeu : toujours une seule entrée");

  // ---- 5. A stale version fails as a whole: no orphan log entry.
  await deny(call("admin", [ids.artisan, "suspend", d.v - 1, crypto.randomUUID(), REASON, false]), "P0001");
  eq((await log()).length, 1, "version périmée : aucune entrée orpheline");

  // ---- 6. Atomicity: if the log entry cannot be written, the decision is rolled back too.
  await db.exec(`create function public.qa_log_abort() returns trigger language plpgsql as $$begin if new.payload->>'reason' like 'QA échec%' then raise exception 'QA log failure' using errcode='55000'; end if; return new; end;$$;
    create trigger qa_log_abort before insert on public.notifications for each row execute function public.qa_log_abort();`);
  d = await dossier();
  await q("update public.artisan_profiles set application_status='submitted',submitted_at=now() where user_id=$1", [ids.artisan]);
  d = await dossier();
  await deny(call("admin", [ids.artisan, "request_changes", d.v, crypto.randomUUID(), "QA échec d’écriture du journal", true]), "55000");
  eq((await dossier()).s, "submitted", "journal en échec : la décision n’est pas appliquée non plus");
  await db.exec("drop trigger qa_log_abort on public.notifications; drop function public.qa_log_abort()");

  // ---- 7. A positive decision without reason stays possible and logs nothing.
  d = await dossier();
  eq(await call("admin", [ids.artisan, "approve", d.v, crypto.randomUUID(), null, false]), { success: true, reason_recorded: false }, "approbation sans motif");
  eq([(await dossier()).s, (await log()).length], ["approved", 1], "approuvé, journal inchangé");

  console.log(`PASS: an application decision and its log entry are one transaction (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
