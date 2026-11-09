import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}',
      email text, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith(".sql")).sort()) {
    const sql = await isolatedMigrationSql(db, name, await readFile(new URL(name, dir), "utf8"));
    await db.exec(sql.replace("create extension if not exists pgcrypto;", "-- isolated fixture"));
  }

  const actors = Object.fromEntries(["admin", "reader", "closer", "writeOnly", "stranger"].map(name => [name, randomUUID()]));
  for (const [name, id] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
      id, name + "@example.invalid", JSON.stringify({ role: "client", full_name: "Callback fixture" }),
    ]);
  }
  await db.query("update public.profiles set role='admin' where id=$1", [actors.admin]);
  async function as(role, actor, sql, args = []) {
    await db.exec("set role " + role);
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[actor] ?? ""]);
      return (await db.query(sql, args)).rows[0]?.v;
    } finally { await db.exec("reset role"); }
  }
  const operator = (name, sql, args) => as("authenticated", name, sql, args);
  for (const [actor, scope] of [["reader", "support_read"], ["closer", "support_read"], ["closer", "support_status"], ["writeOnly", "support_status"]]) {
    await operator("admin", "select public.platform_grant_scope($1,$2,'Isolated callback QA') v", [actors[actor], scope]);
  }
  const submit = "select public.submit_public_callback($1,$2,$3,$4) v";
  const queue = "select public.support_callback_queue($1,$2) v";
  const close = "select public.close_support_callback($1,$2) v";
  const first = [randomUUID(), "+12025550100", "new_request", true];
  for (const role of ["authenticated", "anon"]) {
    await assert.rejects(() => as(role, "closer", submit, first), { code: "42501" });
    await assert.rejects(() => as(role, "closer", "select public.submit_public_callback($1,$2,$3,$4,$5) v", [...first, "1".repeat(64)]), { code: "42501" });
    await assert.rejects(() => as(role, "closer", "select phone v from public.public_callback_requests"), { code: "42501" });
  }
  await assert.rejects(() => as("service_role", null, submit, [...first.slice(0, 3), false]), { code: "22023" });
  assert.equal(await as("service_role", null, submit, first), true);
  assert.equal(await as("service_role", null, submit, first), true);
  await assert.rejects(() => as("service_role", null, submit, [first[0], first[1], "other", true]), { code: "P0001" });
  for (let i = 0; i < 2; i++) assert.equal(await as("service_role", null, submit, [randomUUID(), first[1], "other", true]), true);
  await assert.rejects(() => as("service_role", null, submit, [randomUUID(), first[1], "other", true]), { code: "53300" });
  assert.equal(await as("service_role", null, submit, first), true);
  for (const actor of ["stranger", "writeOnly"]) await assert.rejects(() => operator(actor, queue, [false, 1]), { code: "42501" });
  const { items, total, can_close } = await operator("reader", queue, [false, 1]);
  assert.equal(total, 3);
  assert.equal(can_close, false);
  assert.equal(items.at(-1).reason, "new_request");
  assert.ok(items.every(row => !("request_id" in row) && !("consent_version" in row) && !("source_key" in row)));
  const target = items.at(-1).id;
  await assert.rejects(() => operator("reader", close, [target, 1]), { code: "42501" });
  assert.equal((await operator("closer", queue, [false, 1])).can_close, true);
  assert.equal(await operator("closer", close, [target, 1]), true);
  await assert.rejects(() => operator("closer", close, [target, 1]), { code: "P0001" });
  const closed = await operator("reader", queue, [true, 1]);
  assert.equal(closed.items[0].id, target);
  assert.equal(closed.items[0].version, 2);
  assert.ok(closed.items[0].closed_at);
  const audit = (await db.query("select target_kind, details from public.platform_audit where action='callback_closed' and target_id=$1", [target])).rows;
  assert.deepEqual(audit, [{ target_kind: "public_callback", details: { version: 2 } }]);
  const grant = (await db.query("select id from public.platform_operator_grants where user_id=$1 and scope='support_status'", [actors.closer])).rows[0];
  await operator("admin", "select public.platform_revoke_scope($1,'Isolated callback QA') v", [grant.id]);
  assert.equal((await operator("closer", queue, [false, 1])).can_close, false);
  await assert.rejects(() => operator("closer", close, [items[0].id, 1]), { code: "42501" });
  for (let i = 1; i <= 27; i++) {
    const phone = "+120255501" + String(i).padStart(2, "0");
    await as("service_role", null, submit, [randomUUID(), phone, "other", true]);
  }
  await assert.rejects(() => as("service_role", null, submit, [randomUUID(), "+12025550199", "other", true]), { code: "53300" });
  const page1 = await operator("reader", queue, [false, 1]);
  const page2 = await operator("reader", queue, [false, 2]);
  assert.equal(page1.total, 29);
  assert.equal(page1.items.length, 25);
  assert.equal(page2.total, 29);
  assert.equal(new Set([...page1.items, ...page2.items].map(row => row.id)).size, 29);
  console.log("PASS: callback consent, exact replay, quotas, pagination, private projection, support permissions and single audited closure (isolated PostgreSQL)");
} finally { await db.close(); }
