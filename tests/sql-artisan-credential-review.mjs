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
  const ids = Object.fromEntries(["owner", "stranger", "admin", "backup", "client"].map(name => [name, crypto.randomUUID()]));
  for (const [name, id] of Object.entries(ids)) {
    const role = name === "owner" || name === "stranger" ? "artisan" : "client";
    await db.query("insert into auth.users(id, raw_user_meta_data) values($1,$2)", [id, JSON.stringify({ role, full_name: "QA " + name })]);
  }
  await db.query("update public.profiles set role='admin' where id in ($1,$2)", [ids.admin, ids.backup]);
  async function as(name, query, params = [], role = "authenticated") {
    await db.exec("set role " + role);
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ids[name] ?? ""]);
      return (await db.query(query, params)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  async function piece(expiresOn) {
    const id = crypto.randomUUID();
    await db.query("insert into public.documents(id,owner_id,name,path,mime_type) values($1::uuid,$2,'QA','QA/'||$1::uuid::text,'application/pdf')", [id, ids.owner]);
    return (await as("owner", "select to_jsonb(public.link_artisan_credential($1,'liability',$2)) v", [id, expiresOn])).id;
  }
  const credential = await piece(null);
  const expired = await piece("2000-01-01");
  const key = crypto.randomUUID();
  const get = (name, id = credential, before = null) => as(name, "select public.read_artisan_credential_reviews($1,$2) v", [id, before]);
  const write = (name, id, cmd, version, decision, reason) =>
    as(name, "select public.review_artisan_credential($1,$2,$3,$4,$5) v", [id, cmd, version, decision, reason]);
  const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);

  assert.deepEqual(await get("owner"), { credential_id: credential, kind: "liability", expires_on: null, current_version: 0, can_review: false, reviews: [] });
  for (const actor of ["stranger", "client"]) await rejects(() => get(actor), "P0002");
  await rejects(() => as("anon", "select public.read_artisan_credential_reviews($1) v", [credential], "anon"), "42501");
  await rejects(() => write("owner", credential, key, 0, "accepted", "QA review"), "42501");
  await rejects(() => write("admin", expired, key, 0, "accepted", "QA expired"), "22023");
  await rejects(() => write("admin", credential, key, 0, "accepted", " "), "22023");
  assert.equal((await get("admin")).can_review, true);
  const first = await write("admin", credential, key, 0, "changes_requested", "  Remplacer la pièce QA  ");
  assert.equal(first.reason, "Remplacer la pièce QA");
  assert.equal(first.version, 1);
  assert.equal(first.reviewer_id, undefined);
  assert.deepEqual(await write("admin", credential, key, 0, "changes_requested", "Remplacer la pièce QA"), first);
  await rejects(() => write("admin", credential, key, 0, "accepted", "Motif différent"), "P0001");
  await rejects(() => write("admin", credential, crypto.randomUUID(), 0, "accepted", "Version périmée"), "P0001");
  const second = await write("admin", credential, crypto.randomUUID(), 1, "accepted", "Pièce lue");
  assert.equal(second.version, 2);
  assert.deepEqual((await get("owner")).reviews.map(r => r.version), [2, 1]);
  assert.deepEqual((await get("owner", credential, 2)).reviews.map(r => r.version), [1]);

  const { rows: [source] } = await db.query("select document_id from public.artisan_credentials where id=$1", [credential]);
  await rejects(() => as("owner", "select to_jsonb(public.link_artisan_credential($1,'qualification',null)) v", [source.document_id]), "P0001");
  const replacement = await piece(null);
  assert.equal((await get("owner", replacement)).current_version, 0);
  await rejects(() => as("admin", "select count(*) v from public.artisan_credential_reviews"), "42501");
  await rejects(() => as("service", "select count(*) v from public.artisan_credential_reviews", [], "service_role"), "42501");
  assert.equal((await db.query("select count(*)::int v from public.audit_log where action like 'artisan_credential_review:%'")).rows[0].v, 2);
  assert.equal((await db.query("select artisan_approved v from public.profiles where id=$1", [ids.owner])).rows[0].v, false);
  await db.query("update public.profiles set role='client' where id=$1", [ids.admin]);
  await rejects(() => write("admin", credential, key, 0, "changes_requested", "Remplacer la pièce QA"), "42501");
  await rejects(() => get("admin"), "P0002");
  console.log("PASS: isolated credential review — permissions, expired acceptance, stable retry, conflicts, history, frozen metadata, audit and revocation");
} catch (error) {
  console.error(error.code || "", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
