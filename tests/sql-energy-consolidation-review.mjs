import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.query || "", error.detail || "");
  process.exit(1);
});
// ENT-09 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
// Every fixture below is synthetic QA data: no real site, rate, delay, calendar or regulation.
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir = new URL("../supabase/migrations/", import.meta.url);
for (const file of (await readdir(dir))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const sql = (
    await isolatedMigrationSql(
      db,
      file,
      await readFile(new URL(file, dir), "utf8"),
    )
  ).replace(
    "create extension if not exists pgcrypto;",
    "-- pgcrypto omitted in isolated stub harness only",
  );
  await db.exec(sql);
}

let checks = 0;
const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  reader: "10000000-0000-4000-8000-000000000002",
  outside: "10000000-0000-4000-8000-000000000003",
  writer: "10000000-0000-4000-8000-000000000004",
};
for (const [name, id] of Object.entries(ids))
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())",
    [
      id,
      JSON.stringify({ role: "manager", full_name: "QA " + name }),
      name + "@example.invalid",
    ],
  );
const org = (
  await db.query(
    "insert into public.organizations(name,owner_id)values('QA energy org',$1)returning id",
    [ids.owner],
  )
).rows[0].id;
for (const [name, role] of [
  ["owner", "owner"],
  ["reader", "viewer"],
  ["writer", "manager"],
])
  await db.query("insert into public.organization_members values($1,$2,$3)", [
    org,
    ids[name],
    role,
  ]);
const site = (
  await db.query(
    "insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA fixture address',0)returning id",
    [org],
  )
).rows[0].id;
const siteB = (
  await db.query(
    "insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site B','office','QA fixture address',0)returning id",
    [org],
  )
).rows[0].id;
await db.query(
  "insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",
  [org, ids.writer],
);
await db.query(
  "insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,true)",
  [org, ids.writer, site],
);
async function as(name, sql, args = []) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[name] || "",
  ]);
  try {
    return await db.query(sql, args);
  } finally {
    await db.exec("reset role");
  }
}
async function save(actor, id, version, values, scope = site) {
  return (
    await as(actor, "select public.save_site_energy_period($1,$2,$3,$4) v", [
      scope,
      id,
      version,
      values,
    ])
  ).rows[0].v;
}
async function archive(actor, id, version) {
  return (
    await as(actor, "select public.archive_site_energy_period($1,$2,$3)v", [
      site,
      id,
      version,
    ])
  ).rows[0].v;
}
function ok(value, message) {
  assert.ok(value, message);
  checks++;
}
async function denied(fn, code) {
  await assert.rejects(fn, (e) => !code || e.code === code);
  checks++;
}
const { randomUUID } = await import("node:crypto");
async function reading(scope, label, from, to, wh, cost = null) {
  return save(
    "owner",
    randomUUID(),
    null,
    {
      meter_label: label,
      period_start: from,
      period_end: to,
      consumption_wh: wh,
      cost_cents: cost,
      source_kind: "manual",
      source_reference: "Synthetic QA declared source",
      note: "",
    },
    scope,
  );
}
async function report(
  actor = "owner",
  sites = [site],
  from = "2026-01-01",
  to = "2026-01-31",
  prevFrom = null,
  prevTo = null,
  organization = org,
) {
  return (
    await as(
      actor,
      "select public.organization_energy_consolidation($1,$2,$3,$4,$5,$6)v",
      [organization, sites, from, to, prevFrom, prevTo],
    )
  ).rows[0].v;
}
let r = await report();
ok(r.meters.length === 0, "no rows remains missing, not zero");
await reading(site, " Main ", "2026-01-01", "2026-01-15", 0, 0);
await reading(site, "MAIN", "2026-01-16", "2026-01-31", 0, 0);
await reading(site, "main", "2025-12-01", "2025-12-31", 250, 25);
r = await report(
  "reader",
  [site],
  "2026-01-01",
  "2026-01-31",
  "2025-12-01",
  "2025-12-31",
);
ok(
  r.meters.length === 1 && r.meters[0].meter_label === "main",
  "same normalization as existing meter writer",
);
ok(
  r.meters[0].current.coverage_complete &&
    r.meters[0].current.consumption_wh === "0" &&
    r.meters[0].current.cost_cents === "0",
  "real zeros and adjacent inclusive periods cover selected range",
);
ok(
  r.meters[0].previous.consumption_wh === "250" &&
    r.meters[0].previous.coverage_complete,
  "previous independent range",
);
await reading(site, "Gaps", "2026-01-01", "2026-01-14", 100, 10);
await reading(site, "Gaps", "2026-01-16", "2026-01-31", 200, null);
r = await report();
let row = r.meters.find((m) => m.meter_label === "gaps").current;
ok(
  !row.coverage_complete &&
    row.record_count === 2 &&
    row.consumption_wh === "300" &&
    row.cost_cents === null &&
    row.missing_cost_count === 1,
  "gap and missing cost explicitly incomplete",
);
await reading(site, "Boundary", "2025-12-25", "2026-01-05", 800, 80);
await reading(site, "Boundary", "2026-01-06", "2026-01-31", 400, 40);
r = await report();
row = r.meters.find((m) => m.meter_label === "boundary").current;
ok(
  !row.coverage_complete &&
    row.crossing_count === 1 &&
    row.consumption_wh === "400",
  "crossing period is not prorated or counted",
);
await reading(site, "Dormant", "2024-01-01", "2024-01-31", 200, 20);
r = await report();
row = r.meters.find((m) => m.meter_label === "dormant").current;
ok(
  !row.coverage_complete &&
    row.record_count === 0 &&
    row.consumption_wh === null &&
    row.cost_cents === null,
  "known meter with no current data is missing",
);
const archived = await reading(
  site,
  "Archived",
  "2026-01-01",
  "2026-01-31",
  999,
  99,
);
await archive("owner", archived.id, 1);
ok(
  !(await report()).meters.some((m) => m.meter_label === "archived"),
  "archived corrections excluded",
);
await reading(
  siteB,
  "Main",
  "2026-01-01",
  "2026-01-31",
  9000000000000,
  1000000000,
);
r = await report("owner", [site, siteB]);
ok(
  r.meters.some(
    (m) => m.site_id === siteB && m.current.consumption_wh === "9000000000000",
  ),
  "exact decimal strings and multi-site scope",
);
for (const a of ["reader", "writer"])
  ok((await report(a)).meters.length === 4, "current read scope accepted " + a);
await denied(() => report("writer", [site, siteB]), "P0002");
await denied(() => report("outside"), "P0002");
await denied(() => report("", [site]), "42501");
const foreignOrg = (
  await db.query(
    "insert into public.organizations(name,owner_id)values('Foreign QA',$1)returning id",
    [ids.outside],
  )
).rows[0].id;
await db.query(
  "insert into public.organization_members values($1,$2,'owner')",
  [foreignOrg, ids.outside],
);
const foreignSite = (
  await db.query(
    "insert into public.sites(organization_id,name,type,address)values($1,'Foreign','office','QA foreign fixture address')returning id",
    [foreignOrg],
  )
).rows[0].id;
await denied(() => report("owner", [site, foreignSite]), "P0002");
await denied(
  () =>
    report("owner", [site], "2026-01-01", "2026-01-31", null, null, foreignOrg),
  "P0002",
);
for (const sites of [
  [],
  [site, site],
  [null],
  Array.from({ length: 51 }, () => randomUUID()),
])
  await denied(() => report("owner", sites), "22023");
for (const dates of [
  ["2026-02-01", "2026-01-01", null, null],
  ["2025-01-01", "2026-01-31", null, null],
  ["2026-01-01", "2026-01-31", "2025-01-01", null],
])
  await denied(() => report("owner", [site], ...dates), "22023");
// Imported invalid overlapping periods must not yield a false complete coverage, even if gap and overlap lengths cancel.
await db.query(
  "insert into public.site_energy_periods(id,site_id,meter_label,period_start,period_end,consumption_wh,source_kind,source_reference,created_by,updated_by)values(gen_random_uuid(),$1,'Overlap','2026-01-01','2026-01-16',1,'manual','QA',$2,$2),(gen_random_uuid(),$1,'Overlap','2026-01-16','2026-01-30',1,'manual','QA',$2,$2)",
  [site, ids.owner],
);
ok(
  !(await report()).meters.find((m) => m.meter_label === "overlap").current
    .coverage_complete,
  "overlap plus missing day cannot cancel into complete",
);
await db.query("update public.sites set archived_at=now()where id=$1", [site]);
ok(
  (await report("reader")).meters.length === 5,
  "archived site historical reads preserved",
);
await db.query(
  "delete from public.organization_members where organization_id=$1 and user_id=$2",
  [org, ids.writer],
);
await denied(() => report("writer"), "P0002");
for (const role of ["anon", "service_role"]) {
  await db.exec("set role " + role);
  await denied(
    () =>
      db.query("select public.organization_energy_consolidation($1,$2,$3,$4)", [
        org,
        [site],
        "2026-01-01",
        "2026-01-31",
      ]),
    "42501",
  );
  await db.exec("reset role");
}
// The whole aggregation is not a truncated REST page: >100 input records contribute.
for (let i = 0; i < 110; i++)
  await db.query(
    "insert into public.site_energy_periods(id,site_id,meter_label,period_start,period_end,consumption_wh,source_kind,source_reference,created_by,updated_by)values(gen_random_uuid(),$1,'Daily',date '2026-01-01'+$2::int,date '2026-01-01'+$2::int,9000000000000,'manual','QA',$3,$3)",
    [siteB, i, ids.owner],
  );
row = (await report("owner", [siteB], "2026-01-01", "2026-04-20")).meters.find(
  (m) => m.meter_label === "daily",
).current;
ok(
  row.record_count === 110 &&
    row.consumption_wh === "990000000000000" &&
    row.coverage_complete,
  "full history, no 100-row truncation",
);
for (let i = 0; i < 501; i++)
  await db.query(
    "insert into public.site_energy_periods(id,site_id,meter_label,period_start,period_end,consumption_wh,source_kind,source_reference,created_by,updated_by)values(gen_random_uuid(),$1,$2,'2026-01-01','2026-01-31',0,'manual','QA',$3,$3)",
    [siteB, "Cap " + i, ids.owner],
  );
await denied(() => report("owner", [siteB]), "22023");
console.log(
  JSON.stringify({
    sql: "PASS",
    checks,
    auth_storage_cron: "SIMULATED",
    migrations: (await readdir(dir)).filter((n) => n.endsWith(".sql")).length,
  }),
);
await db.close();
