import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
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
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const migration = await isolatedMigrationSql(
      db,
      name,
      await readFile(new URL(name, dir), "utf8"),
    );
    await db.exec(
      migration.replace(
        "create extension if not exists pgcrypto;",
        "-- stub for isolated test",
      ),
    );
  }
  let checks = 0;
  const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const deny = async (p, code) => {
    await assert.rejects(p, (e) => e.code === code);
    checks++;
  };
  const ids = Object.fromEntries(
    ["owner", "manager", "delegate", "stranger", "artisan"].map((x) => [
      x,
      crypto.randomUUID(),
    ]),
  );
  for (const [n, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3)",
      [
        id,
        n + "@example.invalid",
        JSON.stringify({
          role: n === "artisan" ? "artisan" : "client",
          full_name: "QA " + n,
        }),
      ],
    );
  await db.query(
    "update public.profiles set artisan_approved=true where id=$1",
    [ids.artisan],
  );
  await db.query(
    "insert into public.artisan_profiles(user_id,application_status)values($1,'approved')",
    [ids.artisan],
  );
  const org = (
    await db.query(
      "insert into public.organizations(name,owner_id)values('QA',$1)returning id",
      [ids.owner],
    )
  ).rows[0].id;
  for (const who of ["owner", "manager", "delegate"])
    await db.query(
      "insert into public.organization_members(organization_id,user_id,role)values($1,$2,$3)",
      [org, ids[who], who === "delegate" ? "viewer" : who],
    );
  const site = (
    await db.query(
      "insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA','office','Fixture QA',10000)returning id",
      [org],
    )
  ).rows[0].id;
  async function as(who, sql, args = []) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[who] ?? "",
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  async function job() {
    const j = (
      await db.query(
        "insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,site_id)values($1,$2,'panel','Description synthétique QA','Adresse synthétique QA','97200','QA','scheduled',100,200,'quoted',$3)returning id",
        [ids.manager, ids.artisan, site],
      )
    ).rows[0].id;
    const q = (
      await db.query(
        'insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,\'[{"label":"QA","quantity":1,"unit_price_cents":10000}]\',10000,20,2000,12000,\'sent\')returning id',
        [j, ids.artisan],
      )
    ).rows[0].id;
    return { j, q };
  }
  const policy = (who, v, steps, enabled = true, key = crypto.randomUUID()) =>
    as(who, "select public.set_advanced_approval_policy($1,$2,$3,$4,$5,$6)v", [
      site,
      key,
      v,
      enabled,
      1000,
      steps,
    ]);
  const cmd = (who, q, action, v, note = "", key = crypto.randomUUID()) =>
    as(who, "select public.advanced_approval_command($1,$2,$3,$4,$5)v", [
      q,
      key,
      action,
      v,
      note,
    ]);
  const get = (who, q, after = 0) =>
    as(who, "select public.advanced_approval_status($1,$2)v", [q, after]);
  const accept = (a) =>
    as(
      "manager",
      "select public.intervention_action($1,'accept_quote',null,20,$2)v",
      [a.j, a.q],
    );
  // No advanced policy: existing simple approval and actual quote acceptance still work.
  await as("owner", "select public.set_approval_rule($1,1000,'manager',true)", [
    site,
  ]);
  const simple = await job();
  await deny(accept(simple), "P0001");
  const approval = (
    await db.query("select id from public.approvals where quote_id=$1", [
      simple.q,
    ])
  ).rows[0].id;
  await as("manager", "select public.decide_approval($1,'approved','QA')", [
    approval,
  ]);
  await accept(simple);
  eq(
    (
      await db.query("select status v from public.quotes where id=$1", [
        simple.q,
      ])
    ).rows[0].v,
    "accepted",
  );
  const steps = [{ role: "manager" }, { user_id: ids.delegate }];
  for (const who of ["manager", "delegate", "stranger"])
    await deny(policy(who, null, steps), "42501");
  await deny(policy("owner", null, [{ user_id: ids.stranger }]), "42501");
  const pk = crypto.randomUUID();
  eq((await policy("owner", null, steps, true, pk)).version, 1);
  eq((await policy("owner", null, steps, true, pk)).replayed, true);
  await deny(policy("owner", null, [{ role: "owner" }], true, pk), "P0001");
  const a = await job();
  await db.query(
    "insert into public.approvals(quote_id,site_id,status)values($1,$2,'approved')",
    [a.q, site],
  );
  const oldApproval = (
    await db.query("select id from public.approvals where quote_id=$1", [a.q])
  ).rows[0].id;
  await deny(
    as("owner", "select public.decide_approval($1,'approved','QA')", [
      oldApproval,
    ]),
    "P0001",
  );

  eq((await get("manager", a.q)).required, true);
  eq((await get("manager", a.q)).workflow, null);
  await deny(accept(a), "P0001");
  await deny(get("stranger", a.q), "P0002");
  await deny(cmd("delegate", a.q, "submit", null), "42501");
  await cmd("manager", a.q, "submit", null);
  await deny(cmd("owner", a.q, "approve", 1), "42501");
  await deny(cmd("delegate", a.q, "approve", 1), "42501");
  const info = crypto.randomUUID();
  await cmd(
    "manager",
    a.q,
    "request_information",
    1,
    "Préciser la justification QA",
    info,
  );
  eq(
    (
      await cmd(
        "manager",
        a.q,
        "request_information",
        1,
        "Préciser la justification QA",
        info,
      )
    ).replayed,
    true,
  );
  await deny(accept(a), "P0001");
  await deny(cmd("manager", a.q, "approve", 2), "P0001");
  await deny(cmd("delegate", a.q, "respond", 2, "Réponse QA"), "42501");
  await cmd("artisan", a.q, "respond", 2, "Précision QA apportée");
  const approveKey = crypto.randomUUID();
  await cmd("manager", a.q, "approve", 3, "Accord QA", approveKey);
  eq(
    (await cmd("manager", a.q, "approve", 3, "Accord QA", approveKey)).replayed,
    true,
  );
  await deny(accept(a), "P0001");
  await deny(cmd("delegate", a.q, "approve", 3), "P0001");
  await cmd("delegate", a.q, "approve", 4);
  eq((await get("manager", a.q)).approved_current, true);
  // Terms are part of the exact proposal; an old approval must not authorize changed validity.
  await as(
    "artisan",
    "select public.set_quote_terms($1,(current_date+365)::date)",
    [a.q],
  );
  eq((await get("manager", a.q)).workflow.snapshot_matches, false);
  await deny(accept(a), "P0001");
  await cmd("manager", a.q, "submit", 5);
  await cmd("manager", a.q, "approve", 6);
  await cmd("delegate", a.q, "approve", 7);
  // Loss of current scope invalidates the prior decision at final acceptance.
  await db.query(
    "insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",
    [org, ids.delegate],
  );
  eq((await get("manager", a.q)).approved_current, false);
  await deny(accept(a), "P0001");
  await deny(cmd("delegate", a.q, "approve", 7), "P0002");
  await db.query(
    "insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,false)",
    [org, ids.delegate, site],
  );
  await accept(a);
  eq(
    (
      await db.query("select status v from public.interventions where id=$1", [
        a.j,
      ])
    ).rows[0].v,
    "accepted",
  );
  eq((await get("manager", a.q)).events.length, 8);
  await deny(accept(a), "P0001");
  // Policy version changes and rejected requests cannot pass the real acceptance gate.
  const b = await job();
  await cmd("manager", b.q, "submit", null);
  await cmd("manager", b.q, "reject", 1, "Justification insuffisante QA");
  await deny(accept(b), "P0001");
  await policy("owner", 1, [{ role: "owner" }]);
  await deny(cmd("manager", b.q, "respond", 2, "Réponse QA"), "P0001");
  await cmd("manager", b.q, "submit", 2);
  await deny(cmd("manager", b.q, "approve", 3), "42501");
  await cmd("owner", b.q, "approve", 3);
  await accept(b);
  // Deactivation returns pending quotes to the original simple circuit, with a usable queue row.
  const c = await job();
  await policy("owner", 2, [{ role: "owner" }], false);
  eq((await get("manager", c.q)).required, false);
  await deny(accept(c), "P0001");
  const simpleAfter = (
    await db.query("select id from public.approvals where quote_id=$1", [c.q])
  ).rows[0].id;
  await as("manager", "select public.decide_approval($1,'approved','QA')", [
    simpleAfter,
  ]);
  await accept(c);
  for (const table of [
    "advanced_approval_policies",
    "advanced_approval_workflows",
    "advanced_approval_commands",
    "advanced_approval_events",
  ])
    await deny(
      as("delegate", "select count(*)v from public." + table),
      "42501",
    );
  eq(
    (
      await db.query(
        "select count(*)::int v from public.advanced_approval_events where quote_id=$1",
        [a.q],
      )
    ).rows[0].v,
    8,
  );

  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    try {
      await deny(
        db.query("select public.advanced_approval_status($1)", [a.q]),
        "42501",
      );
      await deny(
        db.query("select public.advanced_approval_command($1,$2,$3,$4,$5)", [
          a.q,
          crypto.randomUUID(),
          "approve",
          1,
          "",
        ]),
        "42501",
      );
    } finally {
      await db.exec("reset role");
    }
  }
  console.log(
    JSON.stringify({
      sql: "PASS",
      checks,
      migrations: (await readdir(dir)).filter((x) => x.endsWith(".sql")).length,
      cloud: false,
      concurrency: "sequential interleavings",
    }),
  );
} catch (e) {
  console.error(e.code, e.message, e.query, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
