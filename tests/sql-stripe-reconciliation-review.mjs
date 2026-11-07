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
    ["client", "artisan", "operator", "reader", "stranger"].map((x) => [
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
  for (const [who, scope] of [
    ["operator", "finance_read"],
    ["operator", "finance_write"],
    ["reader", "finance_read"],
  ])
    await db.query(
      "insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,$2,$3)",
      [ids[who], scope, ids.client],
    );
  const job = (
    await db.query(
      "insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)values($1,$2,'panel','Description synthétique QA','Adresse synthétique QA','97200','QA','scheduled',100,200,'completed')returning id",
      [ids.client, ids.artisan],
    )
  ).rows[0].id;
  const quote = (
    await db.query(
      'insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,\'[{"label":"QA","quantity":1,"unit_price_cents":10000}]\',10000,20,2000,12000,\'accepted\')returning id',
      [job, ids.artisan],
    )
  ).rows[0].id;
  const ledger = (
    await db.query(
      "insert into public.guest_settlements(intervention_id,actor_id,quote_id,artisan_id,request_id,session_id,intent_id,authorized_max,amount_cents,amendments,account_id,fee_bps,fee_cents,transfer_cents,status,charge_id,transfer_id,captured_at,paid_at)values($1,$2,$3,$4,$5,'cs_QA','pi_QA',12000,12000,'[]','acct_QA',2000,2400,9600,'paid','ch_QA','tr_QA',now(),now())returning id",
      [job, ids.client, quote, ids.artisan, crypto.randomUUID()],
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
  async function service(sql, args = []) {
    await db.exec("set role service_role");
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  const event = (id = "evt_QA", changes = {}) => ({
    id,
    type: "transfer.created",
    family: "transfer",
    livemode: false,
    source_account: null,
    created: new Date().toISOString(),
    object: {
      id: "tr_QA",
      amount: 9600,
      currency: "eur",
      source_charge: "ch_QA",
      destination: "acct_QA",
      amount_reversed: 0,
      reversed: false,
      status: null,
    },
    ...changes,
  });
  const ingest = (e, fp = "a".repeat(64)) =>
    service("select public.ingest_stripe_financial_observation($1,$2)v", [
      e,
      fp,
    ]);
  const detail = (who, id) =>
    as(who, "select public.stripe_financial_observation_detail($1)v", [id]);
  const review = (
    who,
    id,
    v,
    key = crypto.randomUUID(),
    note = "Vérification QA",
  ) =>
    as(who, "select public.review_stripe_financial_observation($1,$2,$3,$4)v", [
      id,
      key,
      v,
      note,
    ]);
  const e = event();
  await ingest(e);
  eq((await ingest(e)).replayed, true);
  await deny(ingest(e, "b".repeat(64)), "P0001");
  await deny(ingest({ ...e, source_account: "acct_OTHER" }), "P0001");
  let r = (await detail("reader", e.id)).record;
  eq(r.result.state, "matched");
  eq(r.result.settlement_id, ledger);
  eq(r.result.intervention_id, job);
  // Only exact transfer ID + charge + account + EUR net qualifies; metadata cannot rescue a mismatch.
  for (const [field, value] of [
    ["amount", 9500],
    ["currency", "usd"],
    ["source_charge", "ch_OTHER"],
    ["destination", "acct_OTHER"],
    ["id", "tr_OTHER"],
  ]) {
    const x = event("evt_" + field, {
      object: { ...e.object, [field]: value },
    });
    await ingest(x);
    const d = (await detail("operator", x.id)).record;
    eq(d.result.state, "needs_review");
    eq(d.result.intervention_id, null);
  }
  const connected = event("evt_CONNECTED", { source_account: "acct_QA" });
  await ingest(connected);
  eq(
    (await detail("operator", connected.id)).record.result.reason,
    "unexpected_source_account",
  );
  const reversal = event("evt_REVERSED", {
    type: "transfer.reversed",
    object: { ...e.object, amount_reversed: 1000 },
  });
  await ingest(reversal);
  r = (await detail("operator", reversal.id)).record;
  eq(r.result.reason, "transfer_reversal");
  eq(r.result.intervention_id, job);
  const payout = event("evt_PAYOUT", {
    family: "payout",
    type: "payout.paid",
    source_account: "acct_QA",
    object: {
      ...e.object,
      id: "po_QA",
      source_charge: null,
      destination: null,
      amount_reversed: null,
      reversed: null,
      status: "paid",
    },
  });
  await ingest(payout);
  r = (await detail("operator", payout.id)).record;
  eq(r.result.reason, "aggregate_payout_unallocated");
  eq(r.result.intervention_id, null);
  for (const who of ["client", "artisan", "stranger"])
    await deny(detail(who, e.id), "42501");
  await deny(review("reader", e.id, 1), "42501");
  const key = crypto.randomUUID();
  eq((await review("operator", e.id, 1, key)).version, 2);
  eq((await review("operator", e.id, 1, key)).replayed, true);
  await deny(review("operator", e.id, 1, key, "Autre note"), "P0001");
  await deny(review("operator", e.id, 1), "P0001");
  eq((await detail("operator", e.id)).history.length, 1);
  // Out-of-order transport before the legitimate ledger binding is later rechecked by finance.
  const late = event("evt_LATE", {
    object: { ...e.object, id: "tr_LATE", source_charge: "ch_LATE" },
  });
  await ingest(late);
  eq(
    (await detail("operator", late.id)).record.result.reason,
    "unlinked_transfer",
  );
  const job2 = (
    await db.query(
      "insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)values($1,$2,'panel','Description synthétique QA','Adresse synthétique QA','97200','QA','scheduled',100,200,'completed')returning id",
      [ids.client, ids.artisan],
    )
  ).rows[0].id;
  const q2 = (
    await db.query(
      'insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,\'[{"label":"QA","quantity":1,"unit_price_cents":10000}]\',10000,20,2000,12000,\'accepted\')returning id',
      [job2, ids.artisan],
    )
  ).rows[0].id;
  // The legitimate exact transfer/charge binding arrives after the signed event.
  await db.query(
    "insert into public.guest_settlements(intervention_id,actor_id,quote_id,artisan_id,request_id,session_id,intent_id,authorized_max,amount_cents,amendments,account_id,fee_bps,fee_cents,transfer_cents,status,charge_id,transfer_id,captured_at,paid_at)values($1,$2,$3,$4,$5,'cs_QA2','pi_QA2',12000,12000,'[]','acct_QA',2000,2400,9600,'paid','ch_LATE','tr_LATE',now(),now())",
    [job2, ids.client, q2, ids.artisan, crypto.randomUUID()],
  );
  eq((await review("operator", late.id, 1)).result.state, "matched");
  await deny(
    db.query(
      "update public.guest_settlements set transfer_id=null,charge_id=null where id=$1",
      [ledger],
    ),
    "P0001",
  );
  await deny(
    as("operator", "select public.ingest_stripe_financial_observation($1,$2)", [
      e,
      "a".repeat(64),
    ]),
    "42501",
  );
  await deny(
    as("operator", "select * from public.stripe_financial_observations"),
    "42501",
  );
  await db.query(
    "update public.platform_operator_grants set status='revoked',revoked_by=$1,revoked_at=now()where user_id=$2 and scope='finance_write'",
    [ids.client, ids.operator],
  );
  await deny(review("operator", e.id, 1, key), "42501");
  eq(
    (await db.query("select count(*)::int v from public.payments")).rows[0].v,
    0,
  );
  eq(
    (
      await db.query("select status v from public.interventions where id=$1", [
        job,
      ])
    ).rows[0].v,
    "completed",
  );
  eq(
    (
      await db.query(
        "select count(*)::int v from public.platform_ledger_entries",
      )
    ).rows[0].v,
    0,
  );

  // Bounded operator list and all unsupported associations remain explicit.
  for (let i = 0; i < 52; i++) {
    const x = event("evt_PAGE" + String(i).padStart(3, "0"), {
      family: "payout",
      type: "payout.paid",
      source_account: "acct_QA",
      object: {
        ...e.object,
        id: "po_PAGE" + i,
        source_charge: null,
        destination: null,
        amount_reversed: null,
        reversed: null,
        status: "paid",
      },
    });
    await ingest(x);
  }
  const page = await as(
    "reader",
    "select public.stripe_financial_observations_page(null,'needs_review')v",
  );
  eq(page.records.length, 50);
  eq(page.next_after, page.records[49].event.id);
  const next = await as(
    "reader",
    "select public.stripe_financial_observations_page($1,'needs_review')v",
    [page.next_after],
  );
  eq(
    next.records.every((r) => r.event.id > page.next_after),
    true,
  );
  for (const family of ["fee", "dispute"]) {
    const x = event("evt_" + family.toUpperCase(), {
      family,
      type:
        family === "fee" ? "application_fee.created" : "charge.dispute.created",
      object: {
        ...e.object,
        id: family === "fee" ? "fee_QA" : "dp_QA",
        amount_reversed: null,
        reversed: null,
        destination: null,
        status: family === "dispute" ? "needs_response" : null,
      },
    });
    await ingest(x);
    eq((await detail("reader", x.id)).record.result.intervention_id, null);
  }
  await deny(
    service("select public.review_stripe_financial_observation($1,$2,$3,$4)", [
      e.id,
      crypto.randomUUID(),
      2,
      "QA",
    ]),
    "42501",
  );
  console.log(
    JSON.stringify({
      sql: "PASS",
      checks,
      migrations: (await readdir(dir)).filter((x) => x.endsWith(".sql")).length,
      provider: false,
      cloud: false,
    }),
  );
} catch (e) {
  console.error(e.code, e.message, e.query, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
