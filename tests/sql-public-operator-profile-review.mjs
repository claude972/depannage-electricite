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
  const ids = { owner: crypto.randomUUID(), outside: crypto.randomUUID() };
  for (const id of Object.values(ids)) await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query("update public.profiles set role='admin' where id=$1", [ids.owner]);
  async function as(name, query, params = []) {
    await db.exec("set role " + (name === "anon" ? "anon" : "authenticated"));
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ids[name] ?? ""]);
      return (await db.query(query, params)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  const published = () => as("anon", "select public.read_public_operator_profile() v");
  const editor = (name) => as(name, "select public.read_operator_profile_editor() v");
  const write = (name, key, version, action, payload = null) =>
    as(name, "select public.write_operator_profile($1,$2,$3,$4) v", [key,version,action,payload]);
  const rejects = (fn, code) => assert.rejects(fn, error => error.code === code);
  const draft = {
    legal_name: "Exploitant QA", legal_form: "Société QA", siren: "000000001", hq_address: "Adresse de test",
    publication_director: "Direction QA", public_email: "public@example.invalid", privacy_email: "privacy@example.invalid",
    host_name: "Hébergeur QA", host_address: "Adresse QA", host_contact: "hosting@example.invalid", rights_holder: "Titulaire QA",
  };
  const key = crypto.randomUUID();
  assert.equal(await published(), null);
  assert.deepEqual(await editor("owner"), { version: 0, draft: {}, published: null });
  await rejects(() => editor("outside"), "42501");
  await rejects(() => write("outside",key,0,"save",draft), "42501");
  await rejects(() => write("owner",key,0,"save",{ ...draft, internal_key: "never public" }), "22023");
  await rejects(() => write("owner",key,0,"save",{ ...draft, public_email: "incorrect" }), "22023");
  assert.deepEqual(await write("owner",key,0,"save",{ about_text: "Brouillon partiel" }), { version: 1, action: "save" });
  assert.equal(await published(), null);
  await rejects(() => write("owner",crypto.randomUUID(),1,"publish"), "22023");
  assert.equal((await editor("owner")).version, 1);
  const ready = crypto.randomUUID();
  assert.deepEqual(await write("owner",ready,1,"save",draft), { version: 2, action: "save" });
  assert.deepEqual(await write("owner",ready,1,"save",draft), { version: 2, action: "save" });
  await rejects(() => write("owner",ready,1,"save",{ ...draft, legal_name: "Conflit" }), "P0001");
  await rejects(() => write("owner",crypto.randomUUID(),1,"publish"), "P0001");
  assert.deepEqual(await write("owner",crypto.randomUUID(),2,"publish"), { version: 3, action: "publish" });
  const current = await published();
  assert.deepEqual(current.profile, draft);
  assert.equal(current.version, 3);
  assert.equal(current.actor_id, undefined);
  assert.equal(current.command_id, undefined);
  await write("owner",crypto.randomUUID(),3,"save",{ ...draft, legal_name: "Nouveau brouillon QA" });
  assert.deepEqual(await published(), current);
  assert.equal((await editor("owner")).draft.legal_name, "Nouveau brouillon QA");
  await rejects(() => as("anon","select count(*) v from public.platform_public_profile_versions"),"42501");
  const withdraw = crypto.randomUUID();
  assert.deepEqual(await write("owner",withdraw,4,"withdraw"), { version: 5, action: "withdraw" });
  assert.equal(await published(), null);
  assert.deepEqual(await write("owner",withdraw,4,"withdraw"), { version: 5, action: "withdraw" });
  assert.equal((await db.query("select count(*)::int v from public.audit_log where action like 'public_operator_profile:%'")).rows[0].v, 5);
  const coverage = (postal) => as("anon", "select public.read_public_coverage($1) v", [postal]);
  const coverageEditor = (actor) => as(actor, "select public.read_coverage_editor() v");
  const publishCodes = (actor, command, version, action, codes = null) =>
    as(actor, "select public.write_coverage($1,$2,$3,$4) v", [command, version, action, codes]);
  const coverageKey = crypto.randomUUID();
  assert.deepEqual(await coverage("97200"), { status: "unknown", version: null });
  assert.deepEqual(await coverageEditor("owner"), { version: 0, postal_codes: [] });
  await rejects(() => coverage("972"), "22023");
  await rejects(() => coverageEditor("outside"), "42501");
  await rejects(() => publishCodes("outside", coverageKey, 0, "publish", ["97200"]), "42501");
  await rejects(() => publishCodes("owner", coverageKey, 0, "publish", ["97200", "97200"]), "22023");
  await rejects(() => publishCodes("owner", coverageKey, 0, "publish", ["97200", null]), "22023");
  await rejects(() => publishCodes("owner", coverageKey, 0, "publish", []), "22023");
  await rejects(() => publishCodes("owner", coverageKey, 0, "withdraw", []), "22023");
  assert.deepEqual(await publishCodes("owner", coverageKey, 0, "publish", ["97202", "97200"]),
    { version: 1, postal_codes: ["97200", "97202"], replayed: false });
  assert.deepEqual(await coverage("97200"), { status: "covered", version: 1 });
  assert.deepEqual(await coverage("97201"), { status: "not_covered", version: 1 });
  await rejects(() => publishCodes("owner", coverageKey, 0, "publish", ["97201"]), "23505");
  await rejects(() => publishCodes("owner", crypto.randomUUID(), 0, "withdraw"), "P0001");
  const withdrawCodes = await publishCodes("owner", crypto.randomUUID(), 1, "withdraw");
  assert.deepEqual(withdrawCodes, { version: 2, postal_codes: [], replayed: false });
  assert.equal((await publishCodes("owner", coverageKey, 0, "publish", ["97200", "97202"])).replayed, true);
  assert.deepEqual(await coverage("97200"), { status: "unknown", version: null });
  await rejects(() => as("outside", "select count(*) v from public.platform_coverage_versions"), "42501");
  assert.equal((await db.query("select count(*)::int v from public.audit_log where action like 'platform_postal_coverage:%'")).rows[0].v, 2);
  console.log("PASS: operator profile and postal coverage isolated — permissions, publication, withdrawal, version and audit");
} catch (error) {
  console.error(error.code || "", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
