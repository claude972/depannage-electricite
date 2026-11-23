// Manual reconciliation vs. a commission already withheld (migration 20261122120000), in real
// isolated SQL (PGlite). Not a live Supabase claim: provider references are injected as the server
// would pass them after re-reading Stripe.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      is_anonymous boolean not null default false, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
    const migration = await isolatedMigrationSql(db, name, await readFile(new URL(name, dir), "utf8"));
    await db.exec(migration.replace("create extension if not exists pgcrypto;", "-- stub for isolated test"));
  }
  let checks = 0;
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0]?.v;
  async function as(actor, role) { await db.exec("reset role"); await q("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]); if (role) await db.exec(`set role ${role}`); }
  const ids = Object.fromEntries(["operator", "reader", "client", "artisan"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "artisan" ? "artisan" : "client", full_name: "QA" }), n + "@example.invalid"]);
  for (const [who, scopes] of [["operator", ["finance_read", "finance_write"]], ["reader", ["finance_read"]]]) for (const scope of scopes) await q("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,$2,$1)", [ids[who], scope]);
  // Audited commission setting, 10 % (owner decision of 21 November 2026).
  await q("insert into public.platform_settings(key,value,version,updated_by)values('commission_bps','{\"bps\":1000}',1,$1)", [ids.operator]);

  async function paidCheckout(tag, { amount = 12000, bps = 1000, fee = 1200 } = {}) {
    await as(null, null);
    const job = await one("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA synthétique','QA adresse','97200','QA','scheduled','completed',10000,20000)returning id v", [ids.client, ids.artisan]);
    const quote = await one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":${amount}}]',${amount},0,0,${amount},'accepted')returning id v`, [job, ids.artisan]);
    const checkout = crypto.randomUUID(), session = "cs_test_" + tag;
    await q(`insert into public.platform_checkouts(id,quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)values($1,$2,$3,$4,$5,${amount},'[]','acct_QA','https://app.test',${bps},${fee},'open',$6,clock_timestamp()+interval'1hour')`, [checkout, quote, job, ids.client, ids.artisan, session]);
    const payment = await one(`insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,${amount},'eur','pending','stripe')returning id v`, [quote, session]);
    await q("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)", ["evt_paid_" + tag, "checkout.session.completed", session, quote, amount, "eur"]);
    return { job, quote, checkout, session, payment, amount, fee, tag };
  }
  const refs = (c) => ({
    session_id: c.session, payment_intent_id: "pi_" + c.tag, charge_id: "ch_" + c.tag, destination: "acct_QA", amount_cents: c.amount, fee_cents: c.fee, currency: "eur",
    transfer: { id: "tr_" + c.tag, amount: c.amount, currency: "eur", destination: "acct_QA", source_charge: "ch_" + c.tag, reversed: false, amount_reversed: 0, livemode: false },
    fee: { id: "fee_" + c.tag, amount: c.fee, currency: "eur", account: "acct_QA", connected_charge: "py_" + c.tag, originating_charge: "ch_" + c.tag, amount_refunded: 0, livemode: false },
  });
  const link = async (c) => { await as(null, "service_role"); try { return await one("select public.record_stripe_checkout_link($1,false,$2,null)v", [c.checkout, refs(c)]); } finally { await as(null, null); } };
  const kinds = async (p) => (await q("select entry_kind from public.platform_ledger_entries where payment_id=$1 order by entry_kind", [p])).map((r) => r.entry_kind);
  const reconcile = async () => { await as(ids.operator, "authenticated"); try { return await one("select public.platform_reconcile(100)v"); } finally { await as(null, null); } };
  const report = async () => { await as(ids.reader, "authenticated"); try { return await one("select public.platform_finance_report()v"); } finally { await as(null, null); } };

  // ---- 1. Legacy case: an estimate was written BEFORE the provider confirmed the commission.
  const L = await paidCheckout("L");
  let run = await reconcile();
  eq([run.settled_added, run.commission_added], [0, 1], "paiement sans commission prélevée : estimation écrite (règlement déjà posé à la confirmation)");
  await link(L);
  eq(await kinds(L.payment), ["commission_estimated", "commission_withheld", "payment_settled"], "l’estimation antérieure reste au journal immuable");

  // ---- 2. Commission already withheld: the manual reconciliation books the settlement only.
  const W = await paidCheckout("W");
  await link(W);
  eq(await kinds(W.payment), ["commission_withheld", "payment_settled"], "commission prélevée confirmée par le lien fournisseur");
  run = await reconcile();
  eq([run.settled_added, run.commission_added], [0, 0], "aucune estimation pour une commission déjà prélevée");
  eq(await kinds(W.payment), ["commission_withheld", "payment_settled"], "une seule écriture de commission pour le paiement");

  // ---- 3. Replays stay without effect, whatever their number.
  for (let i = 0; i < 3; i++) { run = await reconcile(); eq([run.settled_added, run.commission_added, run.remaining_unsettled], [0, 0, 0], "rejeu sans effet"); }
  eq(await kinds(W.payment), ["commission_withheld", "payment_settled"], "rejeux : toujours une seule commission");

  // ---- 4. A payment with no withheld commission still gets its estimate, exactly once.
  const E = await paidCheckout("E", { amount: 10850, fee: 1085 });
  run = await reconcile();
  eq([run.settled_added, run.commission_added], [0, 1], "estimation conservée quand rien n’est prélevé");
  eq(await one("select amount_cents v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_estimated'", [E.payment]), 1085, "10 % du montant réglé");
  run = await reconcile();
  eq([run.settled_added, run.commission_added], [0, 0], "rejeu sans seconde estimation");

  // ---- 5. The report names the estimates superseded by a withheld commission (legacy rows).
  const r = await report();
  eq(r.commission_estimated_superseded, { count: 1, cents: 1200 }, "estimation remplacée par une commission prélevée, comptée à part");
  eq([r.ledger.commission_estimated_count, r.ledger.commission_withheld_count], [2, 2], "totaux bruts du journal inchangés");

  // ---- 6. The run is audited with the number of skipped payments.
  const audit = await one("select details v from public.platform_audit where action='reconciliation_run' order by created_at desc, id desc limit 1");
  eq(typeof audit.commission_skipped_withheld, "number", "le journal d’audit porte le nombre de paiements à commission déjà prélevée");

  console.log(`PASS: manual reconciliation never estimates a commission already withheld (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
