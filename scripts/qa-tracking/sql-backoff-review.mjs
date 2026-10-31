#!/usr/bin/env node
// WEB-TRACKING-QA-006 A3: proof of the shared provider backoff WITHOUT provoking a real IGN 429.
// Local, isolated PGlite only (no cloud, no credentials): migrations 001…019 of this checkout with
// explicit Auth/Storage stubs, then, as service_role: tracking_provider_backoff(7) sets
// backoff_until ≈ now+7 s; claim_tracking_provider is then refused with retry_after_s ≥ 1;
// out-of-range delays are 22023; authenticated/anon cannot execute either RPC.
// Usage: PGLITE_MODULE=<path to @electric-sql/pglite dist/index.js> node scripts/qa-tracking/sql-backoff-review.mjs
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

process.on("uncaughtException", (e) => {
  console.error("FAIL", e.code || "", e.message);
  process.exit(1);
});
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
const dir = new URL("../../supabase/migrations/", import.meta.url);
const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
assert.ok(names.some((n) => n.includes("019_intervention_tracking")), "migration 019 missing from this checkout");
for (const name of names) await db.exec((await readFile(new URL(name, dir), "utf8")).replace("create extension if not exists pgcrypto;", "-- extension omitted only in local harness"));
console.log(`PASS: ${names.length} migrations executed under isolated PGlite (local only)`);

const client = randomUUID();
await db.query("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())", [client, JSON.stringify({ role: "client", full_name: "QA backoff" }), "qa-backoff@qa.invalid"]);
const job = randomUUID();
await db.query("insert into public.interventions(id,client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status) values($1,$2,'outage','QA backoff review dossier','Adresse technique QA','97200','Fort-de-France','scheduled',100,200,'requested')", [job, client]);
const key = "a".repeat(64);

async function as(role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
const denied = async (promise, code) => assert.rejects(promise, (e) => e.code === code || (code === "42501" && /permission denied/i.test(e.message)));

const idle = (await db.query("select backoff_until < now() as idle from public.tracking_provider_budget where id='ign'")).rows[0].idle;
assert.equal(idle, true, "budget must start without backoff");
await as("service_role", "select public.tracking_provider_backoff(7)");
const after = (await db.query("select extract(epoch from backoff_until-now()) as s from public.tracking_provider_budget where id='ign'")).rows[0].s;
assert.ok(after > 5 && after <= 7.5, `backoff_until should be ~now+7 s (got ${after})`);
console.log("PASS: injected provider 429 recorded as a shared backoff (backoff_until ≈ now+7 s)");

const claim = (await as("service_role", "select public.claim_tracking_provider($1,'route',$2) as v", [job, key])).rows[0].v;
assert.equal(claim.allowed, false, "claim must be refused during the backoff");
assert.ok(Number.isInteger(claim.retry_after_s) && claim.retry_after_s >= 1 && claim.retry_after_s <= 60, `retry_after_s ${claim.retry_after_s}`);
assert.equal((await db.query("select count(*)::int n from public.tracking_provider_leases where intervention_id=$1", [job])).rows[0].n, 0, "no lease while refused");
console.log("PASS: claim_tracking_provider refused during the backoff with a bounded retry_after_s; no lease created");

for (const delay of [0, 61]) await denied(as("service_role", "select public.tracking_provider_backoff($1)", [delay]), "22023");
console.log("PASS: out-of-range backoff delays (0, 61) refused with 22023");
for (const role of ["authenticated", "anon"]) {
  await denied(as(role, "select public.tracking_provider_backoff(5)"), "42501");
  await denied(as(role, "select public.claim_tracking_provider($1,'route',$2)", [job, key]), "42501");
}
console.log("PASS: authenticated/anon cannot execute the service-only backoff and claim RPCs");
await db.close();
console.log("ALL PASS: shared backoff proven offline (no real IGN 429 provoked)");
