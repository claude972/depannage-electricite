// Every function of the public schema pins its search_path (migration 20261122160000), in real isolated
// SQL (PGlite). Source of the finding: Supabase security advisor on the recette database, 22 November 2026
// (lint 0011, three trigger guards). Not a live Supabase claim.
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
  // ---- 1. No function of the application schema is left with a role-mutable search_path.
  const mutable = (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')
    and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1`)).map((r) => r.proname);
  eq(mutable, [], "aucune fonction publique sans search_path fixé");
  for (const name of ["platform_deny_mutation", "platform_guard_grant_update", "platform_guard_last_super_admin"])
    eq(await one("select proconfig v from pg_proc where proname=$1 and pronamespace='public'::regnamespace", [name]), ['search_path=""'], name + " : search_path vide");

  // ---- 2. The three guards still refuse what they refused.
  const deny = async (p, code) => { await assert.rejects(p, (e) => e.code === code, `attendu ${code}`); checks++; };
  const ids = Object.fromEntries(["admin", "operator"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: "client", full_name: "QA" }), n + "@example.invalid"]);
  await q("update public.profiles set role='admin' where id=$1", [ids.admin]);
  await deny(q("update public.profiles set role='client' where id=$1", [ids.admin]), "P0001");
  eq(await one("select role v from public.profiles where id=$1", [ids.admin]), "admin", "le dernier super-administrateur reste en place");
  const grant = await one("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,'finance_read',$2)returning id v", [ids.operator, ids.admin]);
  await deny(q("update public.platform_operator_grants set scope='finance_write' where id=$1", [grant]), "P0001");
  await q("update public.platform_operator_grants set status='revoked',revoked_by=$2,revoked_at=now() where id=$1", [grant, ids.admin]);
  eq(await one("select status v from public.platform_operator_grants where id=$1", [grant]), "revoked", "la seule transition permise reste possible");
  await q("insert into public.platform_audit(actor_id,action,target_kind,target_id)values($1,'qa_probe','setting','qa')", [ids.admin]);
  await deny(q("update public.platform_audit set action='changed' where action='qa_probe'"), "P0001");
  await deny(q("delete from public.platform_audit where action='qa_probe'"), "P0001");

  console.log(`PASS: every public function pins its search_path and the platform guards still refuse (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
