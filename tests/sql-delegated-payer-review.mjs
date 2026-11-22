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
    ["owner", "creator", "payer", "stranger", "artisan", "manager"].map((x) => [
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
    "update public.profiles set artisan_approved=true,stripe_account_id='acct_QA'where id=$1",
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
  await db.query(
    "insert into public.organization_members(organization_id,user_id,role)values($1,$2,'owner')",
    [org, ids.owner],
  );
  for (const who of ["creator", "payer", "manager"])
    await db.query(
      "insert into public.organization_members(organization_id,user_id,role)values($1,$2,$3)",
      [org, ids[who], who === "payer" ? "viewer" : "manager"],
    );
  const site = (
    await db.query(
      "insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA','office','Fixture QA',10000)returning id",
      [org],
    )
  ).rows[0].id;
  async function actor(who, sql, args = []) {
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
  async function service(sql, args = []) {
    await db.exec("set role service_role");
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  async function job(siteId = site) {
    const j = (
      await db.query(
        "insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,site_id)values($1,$2,'panel','Description synthétique QA','Adresse synthétique QA','97200','QA','scheduled',100,200,'completed',$3)returning id",
        [ids.creator, ids.artisan, siteId],
      )
    ).rows[0].id;
    const q = (
      await db.query(
        'insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,\'[{"label":"QA","quantity":1,"unit_price_cents":10000}]\',10000,20,2000,12000,\'accepted\')returning id',
        [j, ids.artisan],
      )
    ).rows[0].id;
    return { j, q };
  }
  const set = (who, j, p, v, key = crypto.randomUUID()) =>
    actor(who, "select public.set_intervention_payer($1,$2,$3,$4)v", [
      j,
      key,
      p,
      v,
    ]);
  const begin = (who, q) =>
    actor(who, "select public.begin_platform_checkout($1)v", [q]);
  const status = (who, j) =>
    actor(who, "select public.intervention_payer_status($1)v", [j]);
  const a = await job();
  for (const who of ["owner", "payer", "manager", "stranger", "artisan"])
    await deny(begin(who, a.q), "P0002");
  for (const who of ["payer", "manager", "creator", "stranger"])
    await deny(set(who, a.j, ids.payer, null), "42501");
  await deny(set("owner", a.j, ids.stranger, null), "42501");
  await deny(set("owner", (await job(null)).j, ids.payer, null), "42501");
  const key = crypto.randomUUID();
  eq((await set("owner", a.j, ids.payer, null, key)).version, 1);
  eq((await set("owner", a.j, ids.payer, null, key)).replayed, true);
  await deny(set("owner", a.j, ids.manager, null, key), "P0001");
  await deny(set("owner", a.j, ids.manager, null), "P0001");
  eq((await status("payer", a.j)).can_checkout, true);
  eq(
    (
      await db.query("select public.platform_checkout_actor_can_pay($1,$2)v", [
        a.j,
        ids.payer,
      ])
    ).rows[0].v,
    false,
  ); // old predicate used by card-hold unchanged
  await actor("payer", "select public.guard_phone_booking_checkout($1)", [a.q]);
  const checkout = await begin("payer", a.q);
  eq(await begin("payer", a.q), checkout);
  await deny(begin("creator", a.q), "P0001");
  const read = () =>
    service("select public.platform_checkout_private($1,$2)v", [
      checkout,
      ids.payer,
    ]);
  eq((await read()).amount_cents, 12000);
  await service("select public.qualify_platform_checkout($1,$2,$3,$4,$5)", [
    checkout,
    ids.payer,
    "acct_QA",
    2000,
    "https://qa.invalid",
  ]);
  const snapshot = await read();
  await service("select public.bind_platform_checkout($1,$2,$3,$4,$5,$6)", [
    checkout,
    ids.payer,
    "cs_test_DELEGATE",
    12000,
    "eur",
    new Date(Date.parse(snapshot.created_at) + 86400000).toISOString(),
  ]);
  eq((await status("owner", a.j)).external_session_pending, true);
  await set("owner", a.j, null, 1);
  await deny(begin("payer", a.q), "P0002");
  await deny(read(), "42501");
  await deny(
    service("select public.bind_platform_checkout($1,$2,$3,$4,$5,$6)", [
      checkout,
      ids.payer,
      "cs_test_DELEGATE",
      12000,
      "eur",
      new Date(Date.parse(snapshot.created_at) + 86400000).toISOString(),
    ]),
    "42501",
  );
  await set("owner", a.j, ids.payer, 2);
  await deny(begin("payer", a.q), "42501");
  await deny(read(), "42501"); // a fresh mandate cannot revive an old external session
  await deny(
    service("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)v", [
      crypto.randomUUID(),
      "checkout.session.completed",
      "cs_test_DELEGATE",
      a.q,
      1,
      "eur",
    ]),
    "P0001",
  );
  const event = crypto.randomUUID();
  eq(
    await service("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)v", [
      event,
      "checkout.session.completed",
      "cs_test_DELEGATE",
      a.q,
      12000,
      "eur",
    ]),
    true,
  );
  eq(
    await service("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)v", [
      event,
      "checkout.session.completed",
      "cs_test_DELEGATE",
      a.q,
      12000,
      "eur",
    ]),
    false,
  );
  eq(
    (
      await db.query("select status v from public.interventions where id=$1", [
        a.j,
      ])
    ).rows[0].v,
    "paid",
  );
  const b = await job();
  await set("owner", b.j, ids.payer, null);
  await db.query(
    "insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",
    [org, ids.payer],
  );
  eq((await status("owner", b.j)).payer_id, null);
  await deny(status("payer", b.j), "P0002");
  await deny(begin("payer", b.q), "P0002");
  await db.query(
    "insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,false)",
    [org, ids.payer, site],
  );
  await deny(begin("payer", b.q), "P0002");
  await set("owner", b.j, ids.payer, 2);
  await db.query(
    "delete from public.organization_members where organization_id=$1 and user_id=$2",
    [org, ids.payer],
  );
  eq((await status("owner", b.j)).payer_id, null);
  await deny(begin("payer", b.q), "P0002");
  await db.query(
    "insert into public.organization_members(organization_id,user_id,role)values($1,$2,'viewer')",
    [org, ids.payer],
  );
  await deny(begin("payer", b.q), "P0002");
  eq(
    (
      await db.query(
        "select count(*)::int v from public.intervention_payer_events where intervention_id=$1",
        [b.j],
      )
    ).rows[0].v,
    4,
  );
  // No direct writes or alternate private actor argument bypasses.
  for (const table of [
    "intervention_payers",
    "intervention_payer_commands",
    "intervention_payer_events",
    "platform_checkout_payer_bindings",
  ])
    await deny(
      actor("payer", "select count(*)v from public." + table),
      "42501",
    );
  await deny(
    actor("payer", "select public.platform_checkout_can_pay($1,$2)v", [
      b.j,
      ids.owner,
    ]),
    "42501",
  );
  await deny(
    actor("payer", "select public.platform_checkout_private($1,$2)v", [
      checkout,
      ids.payer,
    ]),
    "42501",
  );

  const moved = await job();
  await set("owner", moved.j, ids.payer, null);
  await db.query("update public.interventions set site_id=null where id=$1", [
    moved.j,
  ]);
  await db.query("update public.interventions set site_id=$1 where id=$2", [
    site,
    moved.j,
  ]);
  eq((await status("owner", moved.j)).payer_id, null);
  await deny(begin("payer", moved.q), "P0002");
  const normal = await job();
  const normalCheckout = await begin("creator", normal.q);
  eq(typeof normalCheckout, "string");
  // A mandate never enlarges the existing read policies.
  await db.query(
    "delete from public.organization_members where organization_id=$1 and user_id=$2",
    [org, ids.payer],
  );
  eq(
    await actor(
      "payer",
      "select count(*)::int v from public.interventions where id=$1",
      [b.j],
    ),
    0,
  );
  eq(
    await actor(
      "payer",
      "select count(*)::int v from public.quotes where id=$1",
      [b.q],
    ),
    0,
  );
  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    try {
      await deny(
        db.query("select public.set_intervention_payer($1,$2,$3,$4)", [
          b.j,
          crypto.randomUUID(),
          ids.payer,
          null,
        ]),
        "42501",
      );
    } finally {
      await db.exec("reset role");
    }
  }

  const booking = await actor(
    "creator",
    "select public.create_on_site_booking($1,$2,$3)v",
    [
      crypto.randomUUID(),
      {
        service_slug: "plusieurs-prises-sans-courant",
        category: "socket",
        description: "Description synthétique QA réservée",
        address: "Adresse synthétique QA",
        postal_code: "97200",
        city: "QA",
        urgency: "scheduled",
      },
      {
        first_name: "QA",
        last_name: "Essai",
        email: "",
        phone: "+596696000000",
      },
    ],
  );
  await db.query("update public.interventions set site_id=$1 where id=$2", [
    site,
    booking.intervention.id,
  ]);
  await deny(set("owner", booking.intervention.id, ids.manager, null), "P0001");
  console.log(
    JSON.stringify({
      sql: "PASS",
      checks,
      migrations: (await readdir(dir)).filter((x) => x.endsWith(".sql")).length,
      cloud: false,
      provider: false,
      concurrency: "sequential interleavings",
    }),
  );
} catch (e) {
  console.error(e.code, e.message, e.query, e.where, e.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
