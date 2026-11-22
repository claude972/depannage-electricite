import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.query || "", error.detail || "");
  process.exit(1);
});
// ENT-07/08 asset linkage — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
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
    "insert into public.organizations(name,owner_id)values('QA contacts org',$1)returning id",
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
function ok(v, m) {
  assert.ok(v, m);
  checks++;
}
async function denied(fn, code) {
  await assert.rejects(fn, (e) => e.code === code);
  checks++;
}
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
async function job(scope = site) {
  return (
    await db.query(
      "insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)values($1,$2,'socket','QA synthetic private description','QA private address','97200','QA city','scheduled',100,200)returning id",
      [ids.owner, scope],
    )
  ).rows[0].id;
}
async function equipment(scope = site) {
  return (
    await db.query(
      "insert into public.site_equipment(site_id,name,category,criticality,status,created_by)values($1,'QA equipment','panel','medium','in_service',$2)returning id",
      [scope, ids.owner],
    )
  ).rows[0].id;
}
async function area(scope = site) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into public.site_areas(id,site_id,label,kind,created_by,updated_by)values($1,$2,$3,'zone',$4,$4)",
    [id, scope, "QA " + id, ids.owner],
  );
  return id;
}
const j = await job(),
  j2 = await job(),
  jb = await job(siteB),
  eq = await equipment(),
  eqb = await equipment(siteB),
  ar = await area(),
  arb = await area(siteB);
const before = await scalar(
  "select to_jsonb(i)v from public.interventions i where id=$1",
  [j],
);
const write = async (
  actor,
  jobId,
  kind,
  asset,
  action = "link",
  version = null,
  command = crypto.randomUUID(),
  scope = site,
) =>
  (
    await as(
      actor,
      "select public.write_site_asset_link($1,$2,$3,$4,$5,$6,$7)v",
      [scope, jobId, kind, asset, action, command, version],
    )
  ).rows[0].v;
const page = async (
  actor,
  kind,
  asset,
  jobId = null,
  after = null,
  scope = site,
) =>
  (
    await as(actor, "select public.site_asset_link_page($1,$2,$3,$4,$5)v", [
      scope,
      kind,
      asset,
      jobId,
      after,
    ])
  ).rows[0].v;
ok(
  (await page("owner", "equipment", eq)).records.length === 0,
  "empty history is explicit",
);
const command = crypto.randomUUID();
let r = await write("owner", j, "equipment", eq, "link", null, command);
const link = r.record.id;
ok(!r.replayed && r.record.version === 1 && r.record.active, "link created");
r = await write("owner", j, "equipment", eq, "link", null, command);
ok(r.replayed && r.record.id === link, "lost reply replays same receipt");
ok(
  (await scalar(
    "select count(*)::int v from public.site_asset_link_events",
  )) === 1,
  "single audit",
);
await denied(
  () => write("owner", j2, "equipment", eq, "link", null, command),
  "P0001",
);
await denied(() => write("owner", j, "equipment", eq), "P0001");
for (const actor of ["reader", "outside"])
  await denied(() => write(actor, j, "area", ar), "42501");
await denied(
  () =>
    write(
      "writer",
      jb,
      "equipment",
      eqb,
      "link",
      null,
      crypto.randomUUID(),
      siteB,
    ),
  "42501",
);
await denied(() => write("owner", j, "equipment", eqb), "P0002");
await denied(() => write("owner", j, "area", arb), "P0002");
await denied(() => write("owner", jb, "equipment", eq), "P0002");
await denied(() => write("owner", j, "invented", eq), "22023");
await denied(() => write("owner", j, "equipment", eq, "unlink", null), "22023");
const writerCommand = crypto.randomUUID();
await write("writer", j, "area", ar, "link", null, writerCommand);
const read = await page("reader", null, null, j);
ok(
  read.records.length === 2 && !read.can_write,
  "viewer reads two kinds without write",
);
ok(
  !JSON.stringify(read).includes("private") &&
    !JSON.stringify(read).includes("client_id") &&
    !JSON.stringify(read).includes("actor_id"),
  "history excludes PII and notes",
);
await denied(() => page("outside", "equipment", eq), "P0002");
await denied(() => page("owner", "equipment", eqb), "P0002");
await denied(() => page("owner", null, null, null), "22023");
await denied(() => page("owner", "equipment", eq, j), "22023");
const unlink = crypto.randomUUID();
r = await write("owner", j, "equipment", eq, "unlink", 1, unlink);
ok(
  !r.record.active && r.record.version === 2 && r.record.detached_at !== null,
  "unlink retains row",
);
await denied(() => write("owner", j, "equipment", eq, "link", 1), "P0001");
r = await write("owner", j, "equipment", eq, "link", 2);
ok(r.record.version === 3 && r.record.active, "relink uses current version");
r = await write("owner", j, "equipment", eq, "unlink", 1, unlink);
ok(
  r.replayed && r.record.version === 2 && !r.record.active,
  "old command returns its immutable receipt, not a new mutation",
);
ok(
  (await page("owner", "equipment", eq)).records[0].version === 3,
  "fresh GET is current state",
);
await db.query(
  "update public.site_equipment set status='retired' where id=$1",
  [eq],
);
await db.query("update public.site_areas set archived_at=now() where id=$1", [
  ar,
]);
ok(
  (await page("reader", "equipment", eq)).records[0].asset_archived,
  "retired equipment history remains",
);
ok(
  (await page("reader", "area", ar)).records[0].asset_archived,
  "archived zone history remains",
);
await denied(() => write("owner", j2, "equipment", eq), "P0001");
await denied(() => write("owner", j2, "area", ar), "P0001");
await write("owner", j, "equipment", eq, "unlink", 3);
ok(
  !(await page("reader", "equipment", eq)).records[0].active,
  "detach archived asset remains possible",
);
await denied(
  () =>
    db.query("update public.interventions set site_id=$2 where id=$1", [
      j,
      siteB,
    ]),
  "23503",
);
await denied(
  () =>
    db.query("update public.site_equipment set site_id=$2 where id=$1", [
      eq,
      siteB,
    ]),
  "23503",
);
ok(
  (await scalar("select to_jsonb(i)v from public.interventions i where id=$1", [
    j,
  ])) === undefined
    ? false
    : JSON.stringify(
        await scalar(
          "select to_jsonb(i)v from public.interventions i where id=$1",
          [j],
        ),
      ) === JSON.stringify(before),
  "original job unchanged",
);
// 135 historical jobs exceed two pages; privileged fixtures only, real reader executes the page query.
const manyAsset = await equipment();
for (let i = 0; i < 135; i++) {
  const jid = await job();
  await db.query(
    "insert into public.site_asset_intervention_links(site_id,intervention_id,equipment_id)values($1,$2,$3)",
    [site, jid, manyAsset],
  );
}
let p = await page("reader", "equipment", manyAsset);
ok(p.records.length === 51, "51 candidates for 50+1 page");
let seen = new Set(),
  after = null;
for (let i = 0; i < 3; i++) {
  p = await page("reader", "equipment", manyAsset, null, after);
  const rows = p.records.slice(0, 50);
  for (const row of rows) {
    ok(!seen.has(row.id), "no duplicate across pages");
    seen.add(row.id);
  }
  after = rows.at(-1)?.id;
}
ok(seen.size === 135, "all history reachable");
// Quota prevents runaway link collections but keeps removals available.
const capJob = await job();
for (let i = 0; i < 50; i++) {
  const aid = await equipment();
  await db.query(
    "insert into public.site_asset_intervention_links(site_id,intervention_id,equipment_id)values($1,$2,$3)",
    [site, capJob, aid],
  );
}
await denied(() => write("owner", capJob, "equipment", manyAsset), "P0001");
const quotaRow = (await page("owner", null, null, capJob)).records[0];
await write("owner", capJob, "equipment", quotaRow.asset_id, "unlink", 1);
await write("owner", capJob, "equipment", manyAsset);
ok(true, "removal frees active slot");
// Separate organization and admin-without-membership never bypass the member scope.
const orgForeign = (
  await db.query(
    "insert into public.organizations(name,owner_id)values('QA foreign org',$1)returning id",
    [ids.outside],
  )
).rows[0].id;
await db.query(
  "insert into public.organization_members values($1,$2,'owner')",
  [orgForeign, ids.outside],
);
const siteForeign = (
  await db.query(
    "insert into public.sites(organization_id,name,type,address)values($1,'QA foreign site','office','QA foreign address')returning id",
    [orgForeign],
  )
).rows[0].id;
const assetForeign = await equipment(siteForeign);
await denied(() => write("owner", j, "equipment", assetForeign), "P0002");
await denied(
  () => page("owner", "equipment", assetForeign, null, null, siteForeign),
  "P0002",
);
await db.query("update public.profiles set role='admin' where id=$1", [
  ids.outside,
]);
await denied(() => page("outside", "equipment", eq), "P0002");
// Keep the synthetic admin: production prevents demoting the last administrator.
const historyCapJob = await job();
for (let i = 0; i < 100; i++) {
  const aid = await equipment();
  await db.query(
    "insert into public.site_asset_intervention_links(site_id,intervention_id,equipment_id,active,detached_at)values($1,$2,$3,false,now())",
    [site, historyCapJob, aid],
  );
}
await denied(
  () => write("owner", historyCapJob, "equipment", manyAsset),
  "P0001",
);
const oldLink = (await page("owner", null, null, historyCapJob)).records[0];
await write("owner", historyCapJob, "equipment", oldLink.asset_id, "link", 1);
ok(true, "existing historical link reusable at distinct-link cap");
// Membership and write revocation are checked before replay, not trusted from the old receipt.
await db.query(
  "update public.organization_member_site_grants set can_write=false where organization_id=$1 and user_id=$2",
  [org, ids.writer],
);
await denied(() => write("writer", j2, "area", ar), "42501");
await denied(
  () => write("writer", j, "area", ar, "link", null, writerCommand),
  "42501",
);
await db.query(
  "delete from public.organization_members where organization_id=$1 and user_id=$2",
  [org, ids.writer],
);
await denied(() => page("writer", "area", ar), "P0002");
await db.query("update public.sites set archived_at=now() where id=$1", [site]);
p = await page("reader", "equipment", manyAsset);
ok(
  p.site_archived && !p.can_write && p.records.length === 51,
  "archived site preserves readonly history",
);
await denied(() => write("owner", j2, "equipment", manyAsset), "P0001");
r = await write("owner", j, "equipment", eq, "link", null, command);
ok(
  r.replayed,
  "exact retry after archive returns prior receipt without mutation",
);
for (const role of ["anon", "authenticated", "service_role"])
  for (const table of [
    "site_asset_intervention_links",
    "site_asset_link_events",
  ])
    for (const action of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      ok(
        !(await scalar("select has_table_privilege($1,$2,$3)v", [
          role,
          "public." + table,
          action,
        ])),
        "raw table privilege denied",
      );
for (const role of ["anon", "service_role"]) {
  await db.exec("set role " + role);
  await denied(
    () =>
      db.query("select public.site_asset_link_page($1,$2,$3)", [
        site,
        "equipment",
        eq,
      ]),
    "42501",
  );
  await db.exec("reset role");
}
console.log(
  JSON.stringify({
    sql: "PASS",
    checks,
    migrations: (await readdir(dir)).filter((n) => n.endsWith(".sql")).length,
    auth_storage_cron: "SIMULATED",
    concurrency:
      "versioned sequential interleavings; no multi-connection claim",
  }),
);
await db.close();
