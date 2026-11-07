import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";
process.on("uncaughtException", (error) => {
  console.error(error.message, error.query || "", error.detail || "");
  process.exit(1);
});
// ENT-04 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
// Every fixture below is synthetic QA data: no real site, rate, delay, calendar or regulation.
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const dir = new URL("../supabase/migrations/", import.meta.url),
  files = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
async function apply(file) {
  await db.exec(
    (
      await isolatedMigrationSql(
        db,
        file,
        await readFile(new URL(file, dir), "utf8"),
      )
    ).replace(
      "create extension if not exists pgcrypto;",
      "-- extension simulated",
    ),
  );
}
for (const file of files) await apply(file);
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
const denied = async (p, code) => {
  await assert.rejects(p, (e) => e.code === code);
  checks++;
};
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
const ids = { a: randomUUID(), b: randomUUID(), artisan: randomUUID() };
for (const [label, id] of Object.entries(ids))
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at,phone,phone_confirmed_at)values($1,$2,$3,now(),$4,now())",
    [
      id,
      JSON.stringify({
        role: label === "artisan" ? "artisan" : "client",
        full_name: "QA " + label,
      }),
      label + "@example.invalid",
      "+59669600000" + Object.keys(ids).indexOf(label),
    ],
  );
await db.query(
  "update public.profiles set artisan_approved=true,stripe_account_id='acct_QArecipient' where id=$1",
  [ids.artisan],
);
const as = async (label, sql, args = []) => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids[label] || "",
  ]);
  try {
    return await db.query(sql, args);
  } finally {
    await db.exec("reset role");
  }
};
const service = async (sql, args = []) => {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, args);
  } finally {
    await db.exec("reset role");
  }
};
async function fixture(total = 22000, legacy = false) {
  const nonce = randomUUID(),
    payload = {
      service_slug: "plusieurs-prises-sans-courant",
      category: "socket",
      description: "Panne synthétique QA remplacement",
      address: "Adresse technique QA sans déplacement",
      postal_code: "97200",
      city: "Commune synthétique QA",
      urgency: "scheduled",
    },
    contact = {
      first_name: "QA",
      last_name: "Essai",
      email: "",
      phone: "+596696000000",
    };
  await as("a", "select public.prepare_phone_booking($1,$2,$3,$4)", [
    nonce,
    JSON.stringify(payload),
    JSON.stringify(contact),
    "card_hold",
  ]);
  const suffix = nonce.replaceAll("-", ""),
    record =
      "select public.record_phone_booking_provider($1,$2,$3,$4,$5,$6,$7,$8)";
  await service(record, [
    ids.a,
    nonce,
    "cs_test_" + suffix,
    "pi_" + suffix,
    "session",
    null,
    null,
    null,
  ]);
  await service(record, [
    ids.a,
    nonce,
    "cs_test_" + suffix,
    "pi_" + suffix,
    "authorize",
    18000,
    "eur",
    "requires_capture",
  ]);
  const job = (
    await as("a", "select public.submit_phone_booking($1) v", [nonce])
  ).rows[0].v.intervention.id;
  await db.query(
    "update public.interventions set status='completed',artisan_id=$2 where id=$1",
    [job, ids.artisan],
  );
  const q = randomUUID();
  await db.query(
    'insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at) values($1,$2,$3,\'[{"label":"QA","quantity":1,"unit_price_cents":22000}]\',$4,0,0,$4,\'accepted\',now())',
    [q, job, ids.artisan, total],
  );
  let ledger = null;
  if (legacy)
    ledger = (
      await as("a", "select public.begin_guest_settlement($1) v", [job])
    ).rows[0].v;
  const source = () =>
    service("select public.hold_reauthorization_source($1,$2) v", [
      job,
      ids.a,
    ]).then((r) => r.rows[0].v);
  const before = await scalar(
    "select to_jsonb(b) v from public.phone_booking_requests b where intervention_id=$1",
    [job],
  );
  return { job, q, nonce, before, ledger, source, oldIntent: "pi_" + suffix };
}
const begin = async (f) => {
  const id = randomUUID(),
    s = await f.source();
  await as("a", "select public.begin_hold_reauthorization($1,$2,$3)", [
    f.job,
    id,
    s.snapshot_id,
  ]);
  return id;
};
const qualify = (id) =>
  service("select public.qualify_hold_reauthorization($1,$2,$3,$4,$5)", [
    id,
    ids.a,
    "acct_QArecipient",
    2000,
    "https://preview.example.test",
  ]);
const authorize = (id, action) =>
  service("select public.authorize_hold_reauthorization($1,$2,$3)", [
    id,
    ids.a,
    action,
  ]);
const bind = (id, authorized = true) =>
  service("select public.bind_hold_reauthorization($1,$2,$3,$4,$5)", [
    id,
    ids.a,
    "cs_test_new" + id.replaceAll("-", ""),
    "pi_new" + id.replaceAll("-", ""),
    authorized,
  ]);
const proof = (intent, amount) => ({
  intent_id: intent,
  status: "canceled",
  amount,
  amount_received: 0,
  amount_capturable: 0,
  charge_id: "ch_QA",
  amount_captured: 0,
  transfer_count: 0,
  complete: true,
});
const release = (id, p, abort = false) =>
  service("select public.record_hold_release($1,$2,$3,$4)", [
    id,
    ids.a,
    JSON.stringify(p),
    abort,
  ]);
const adopt = (id) =>
  service("select public.adopt_hold_reauthorization($1,$2)", [id, ids.a]);
const f = await fixture();
const view = await f.source();
eq(view.source.amount_cents, 22000);
eq(view.snapshot_id.length, 64);
eq(view.source.quote_document.id, f.q);
await denied(
  service("select public.hold_reauthorization_source($1,$2)", [f.job, ids.b]),
  "P0002",
);
await denied(
  as("b", "select public.begin_hold_reauthorization($1,$2,$3)", [
    f.job,
    randomUUID(),
    view.snapshot_id,
  ]),
  "P0002",
);
await denied(
  as("a", "select public.begin_hold_reauthorization($1,$2,$3)", [
    f.job,
    randomUUID(),
    "0".repeat(64),
  ]),
  "P0001",
);
const id = await begin(f);
eq(
  (
    await as("a", "select public.begin_hold_reauthorization($1,$2,$3) v", [
      f.job,
      id,
      view.snapshot_id,
    ])
  ).rows[0].v,
  id,
);
await denied(begin(f), "P0001");
await denied(
  as("a", "select public.begin_guest_settlement($1)", [f.job]),
  "P0001",
);
await denied(
  db.query("update public.quotes set total_cents=21000 where id=$1", [f.q]),
  "P0001",
);
await denied(
  db.query(
    "update public.profiles set stripe_account_id='acct_OTHER' where id=$1",
    [ids.artisan],
  ),
  "P0001",
);
await qualify(id);
await authorize(id, "open");
await bind(id);
await denied(adopt(id), "P0001");
await authorize(id, "release_old");
await denied(authorize(id, "abort"), "P0001");
for (const patch of [
  { amount_received: 1 },
  { amount_captured: 1 },
  { transfer_count: 1 },
  { amount_capturable: null },
  { complete: false },
])
  await denied(
    release(id, { ...proof(f.oldIntent, 18000), ...patch }),
    "P0001",
  );
await release(id, proof(f.oldIntent, 18000));
await release(id, proof(f.oldIntent, 18000));
eq(
  await scalar(
    "select count(*)::int v from public.hold_reauthorization_events where attempt_id=$1 and action='old_hold_released'",
    [id],
  ),
  1,
);
await adopt(id);
await denied(authorize(id, "abort"), "P0001");
eq(
  (
    await service("select public.guest_settlement_source($1,$2) v", [
      f.job,
      ids.a,
    ])
  ).rows[0].v.intent_id,
  "pi_new" + id.replaceAll("-", ""),
);
const newLedger = (
  await as("a", "select public.begin_guest_settlement($1) v", [f.job])
).rows[0].v;
eq(
  await scalar("select fee_bps v from public.guest_settlements where id=$1", [
    newLedger,
  ]),
  2000,
);
eq(
  await scalar(
    "select generation v from public.guest_settlements where id=$1",
    [newLedger],
  ),
  1,
);
eq(
  await scalar(
    "select to_jsonb(b) v from public.phone_booking_requests b where intervention_id=$1",
    [f.job],
  ),
  f.before,
);
// A prior processing generation can retire only before any durable capture invocation.
const g = await fixture(15000, true);
await service("select public.qualify_guest_settlement($1,$2,$3,$4)", [
  g.ledger,
  ids.a,
  "acct_QArecipient",
  2000,
]);
const gid = await begin(g);
await denied(
  service("select public.qualify_hold_reauthorization($1,$2,$3,$4,$5)", [
    gid,
    ids.a,
    "acct_QArecipient",
    1000,
    "https://preview.example.test",
  ]),
  "P0001",
);
await qualify(gid);
await bind(gid);
await authorize(gid, "release_old");
await release(gid, proof(g.oldIntent, 18000));
await adopt(gid);
const second = (
  await as("a", "select public.begin_guest_settlement($1) v", [g.job])
).rows[0].v;
eq(
  await scalar(
    "select generation v from public.guest_settlements where id=$1",
    [second],
  ),
  2,
);
eq(
  await scalar(
    "select retired_at is not null v from public.guest_settlements where id=$1",
    [g.ledger],
  ),
  true,
);
await denied(
  service("select public.authorize_guest_settlement_operation($1,$2,$3)", [
    g.ledger,
    ids.a,
    "capture",
  ]),
  "P0001",
);
await service("select public.record_guest_settlement($1,$2,$3,$4)", [
  g.ledger,
  ids.a,
  "ch_OLD",
  15000,
]);
eq(
  await scalar("select status v from public.guest_settlements where id=$1", [
    g.ledger,
  ]),
  "processing",
);
eq(
  await scalar(
    "select status v from public.hold_reauthorizations where id=$1",
    [gid],
  ),
  "needs_review",
);
eq(
  await scalar(
    "select count(*)::int v from public.hold_reauthorization_events where attempt_id=$1 and action='retired_provider_observation'",
    [gid],
  ),
  1,
);
const h = await fixture(15000, true);
await service("select public.qualify_guest_settlement($1,$2,$3,$4)", [
  h.ledger,
  ids.a,
  "acct_QArecipient",
  2000,
]);
await service("select public.authorize_guest_settlement_operation($1,$2,$3)", [
  h.ledger,
  ids.a,
  "capture",
]);
await denied(begin(h), "P0001");
// Revocation between await and adoption is rejected while the released-old fact persists.
const k = await fixture(),
  kid = await begin(k);
await qualify(kid);
await bind(kid);
await authorize(kid, "release_old");
await release(kid, proof(k.oldIntent, 18000));
await db.query(
  "update auth.users set phone_confirmed_at=null,email_confirmed_at=null where id=$1",
  [ids.a],
);
await denied(adopt(kid), "P0001");
eq(
  await scalar(
    "select old_released v from public.hold_reauthorizations where id=$1",
    [kid],
  ),
  true,
);
await db.query(
  "update auth.users set phone_confirmed_at=now(),email_confirmed_at=now() where id=$1",
  [ids.a],
);
for (const role of ["anon", "authenticated"])
  for (const table of [
    "hold_reauthorizations",
    "hold_reauthorization_events",
    "guest_settlement_operations",
  ])
    eq(
      await scalar("select has_table_privilege($1,$2,$3) v", [
        role,
        "public." + table,
        "SELECT",
      ]),
      false,
    );
for (const name of [
  "guest_settlement_source_before_reauthorization(uuid,uuid)",
  "begin_guest_settlement_before_reauthorization(uuid)",
  "record_guest_settlement_before_reauthorization(uuid,uuid,text,integer,text,integer,text)",
])
  eq(
    await scalar("select has_function_privilege($1,$2,$3) v", [
      "service_role",
      "public." + name,
      "EXECUTE",
    ]),
    false,
  );
console.log(
  JSON.stringify({
    sql: "PASS",
    checks,
    migrations: files.length,
    provider: "synthetic only",
    concurrency: "ordered interleavings, not multi-connection",
  }),
);
await db.close();
