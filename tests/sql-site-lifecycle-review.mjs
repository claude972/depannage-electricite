import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(
      id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter(n => n.endsWith(".sql")).sort()) {
    const migration = await isolatedMigrationSql(db, name, await readFile(new URL(name, dir), "utf8"));
    await db.exec(migration.replace("create extension if not exists pgcrypto;", "-- stub for isolated test"));
  }
  const ids = Object.fromEntries(["owner", "viewer", "stranger"].map(name => [name, crypto.randomUUID()]));
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id, raw_user_meta_data) values($1,$2)", [id, JSON.stringify({ role: "manager", full_name: "QA " + name })]);
  }
  async function as(name, query, params = []) {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ids[name]]);
      return (await db.query(query, params)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  const organization = crypto.randomUUID();
  await db.query("insert into public.organizations(id,name,owner_id) values($1,'QA org',$2)", [organization, ids.owner]);
  await db.query("insert into public.organization_members values($1,$2,'owner'),($1,$3,'viewer')", [organization, ids.owner, ids.viewer]);
  const site = (await as("owner", "select to_jsonb(public.create_site('QA site','office','Adresse QA version un',10000,$1)) v", [organization])).id;
  const key = crypto.randomUUID();
  const edit = { name: "Site modifié", address: "Adresse QA version deux", access_notes: "Sonner à l’accueil",
    opening_hours: [{ day: 1, opens: "08:30", closes: "12:00" }, { day: 1, opens: "13:00", closes: "16:30" }] };
  const write = (actor, cmd, version, action, values = null) =>
    as(actor, "select public.write_site_settings($1,$2,$3,$4,$5) v", [site, cmd, version, action, values]);
  const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);
  await rejects(() => write("viewer", key, 1, "save", edit), "42501");
  await rejects(() => write("stranger", key, 1, "save", edit), "P0002");
  await rejects(() => write("owner", key, 1, "save", { ...edit, opening_hours: [{ day: 1, opens: "11:00", closes: "14:00" }, ...edit.opening_hours] }), "22023");
  await rejects(() => write("owner", key, 1, "save", { ...edit, budget_cents: 5 }), "22023");
  const saved = await write("owner", key, 1, "save", edit);
  assert.equal(saved.settings_version, 2);
  assert.equal(saved.name, edit.name);
  assert.deepEqual(saved.opening_hours, edit.opening_hours);
  assert.equal(saved.budget_cents, 10000);
  assert.deepEqual(await write("owner", key, 1, "save", edit), saved);
  await rejects(() => write("owner", key, 1, "save", { ...edit, name: "Modification différente" }), "P0001");
  await rejects(() => write("owner", crypto.randomUUID(), 1, "save", edit), "P0001");

  const job = crypto.randomUUID();
  const createJob = (id) => db.query(`
    insert into public.interventions(id,client_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
      values($1,$2,$3,'panel','Description synthétique','Adresse originale dossier','97200','QA','scheduled',10000,20000)
  `, [id, ids.owner, site]);
  await createJob(job);
  const archiveKey = crypto.randomUUID();
  await rejects(() => write("owner", archiveKey, 2, "archive"), "P0001");
  await db.query("update public.interventions set status='completed' where id=$1", [job]);
  const archived = await write("owner", archiveKey, 2, "archive");
  assert.equal(archived.settings_version, 3);
  assert.ok(archived.archived_at);
  assert.deepEqual(await write("owner", archiveKey, 2, "archive"), archived);
  assert.deepEqual(await write("owner", key, 1, "save", edit), saved);
  await rejects(() => write("owner", crypto.randomUUID(), 3, "save", edit), "P0001");
  await rejects(() => createJob(crypto.randomUUID()), "P0001");
  assert.equal(await as("viewer", "select address v from public.interventions where id=$1", [job]), "Adresse originale dossier");
  assert.equal(await as("stranger", "select count(*)::int v from public.sites where id=$1", [site]), 0);
  assert.equal(await as("owner", "select public.can_manage_site($1) v", [site]), true);
  await rejects(() => as("owner", "select count(*) v from public.site_settings_commands"), "42501");
  await db.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [organization, ids.viewer]);
  assert.equal(await as("viewer", "select count(*)::int v from public.sites where id=$1", [site]), 0);
  assert.equal((await db.query("select count(*)::int v from public.audit_log where action like 'site_settings:%'")).rows[0].v, 2);
  console.log("PASS: site lifecycle isolated — validation, permissions, optimistic edit, retries, archive, and historical read");
} catch (error) {
  console.error(error.code || "", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
