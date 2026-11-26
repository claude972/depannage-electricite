// Settlement entry written at payment confirmation (migration 20261122130000), in real isolated
// SQL (PGlite). Not a live Supabase claim: the provider event is injected as the webhook passes it.
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

  async function paidCheckout(tag, { amount = 12000, bps = 1000, fee = 1200, confirm = true } = {}) {
    await as(null, null);
    const job = await one("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA synthétique','QA adresse','97200','QA','scheduled','completed',10000,20000)returning id v", [ids.client, ids.artisan]);
    const quote = await one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":${amount}}]',${amount},0,0,${amount},'accepted')returning id v`, [job, ids.artisan]);
    const checkout = crypto.randomUUID(), session = "cs_test_" + tag;
    await q(`insert into public.platform_checkouts(id,quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)values($1,$2,$3,$4,$5,${amount},'[]','acct_QA','https://app.test',${bps},${fee},'open',$6,clock_timestamp()+interval'1hour')`, [checkout, quote, job, ids.client, ids.artisan, session]);
    const payment = await one(`insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,${amount},'eur','pending','stripe')returning id v`, [quote, session]);
    if (confirm) await q("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)", ["evt_paid_" + tag, "checkout.session.completed", session, quote, amount, "eur"]);
    return { job, quote, checkout, session, payment, amount, fee, tag };
  }
  const refs = (c) => ({
    session_id: c.session, payment_intent_id: "pi_" + c.tag, charge_id: "ch_" + c.tag, destination: "acct_QA", amount_cents: c.amount, fee_cents: c.fee, currency: "eur",
    transfer: { id: "tr_" + c.tag, amount: c.amount, currency: "eur", destination: "acct_QA", source_charge: "ch_" + c.tag, reversed: false, amount_reversed: 0, livemode: false },
    fee: { id: "fee_" + c.tag, amount: c.fee, currency: "eur", account: "acct_QA", connected_charge: "py_" + c.tag, originating_charge: "ch_" + c.tag, amount_refunded: 0, livemode: false },
  });
  const link = async (c) => { await as(null, "service_role"); try { return await one("select public.record_stripe_checkout_link($1,false,$2,null)v", [c.checkout, refs(c)]); } finally { await as(null, null); } };
  const kinds = async (p) => (await q("select entry_kind from public.platform_ledger_entries where payment_id=$1 order by entry_kind", [p])).map((r) => r.entry_kind);
  const reconcile = async (limit = 100) => { await as(ids.operator, "authenticated"); try { return await one("select public.platform_reconcile($1)v", [limit]); } finally { await as(null, null); } };
  const report = async () => { await as(ids.reader, "authenticated"); try { return await one("select public.platform_finance_report()v"); } finally { await as(null, null); } };

  const confirm = (c, event = "evt_paid_" + c.tag) => one("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)v", [event, "checkout.session.completed", c.session, c.quote, c.amount, "eur"]);
  const settled = (p) => q("select amount_cents,currency,direction,external_event_id,recorded_by,basis from public.platform_ledger_entries where payment_id=$1 and entry_kind='payment_settled'", [p]);

  // ---- 1. A pending payment has no settlement entry.
  const P = await paidCheckout("P", { confirm: false });
  eq(await kinds(P.payment), [], "paiement en attente : aucune écriture");

  // ---- 2. The confirmation writes the settlement entry itself, without any operator click.
  eq(await confirm(P), true, "confirmation appliquée");
  let rows = await settled(P.payment);
  eq(rows.length, 1, "une écriture de règlement à la confirmation");
  eq([rows[0].amount_cents, rows[0].currency, rows[0].direction, rows[0].external_event_id, rows[0].recorded_by], [12000, "eur", "credit", "cs_test_P", null], "montant, devise et session du paiement ; aucun opérateur");
  eq([rows[0].basis.source, rows[0].basis.quote_id], ["payment_confirmation", P.quote], "origine tracée");

  // ---- 3. Replays of the provider event (same or new identifier) add nothing.
  eq(await confirm(P), false, "même événement rejoué");
  eq(await confirm(P, "evt_paid_P_bis"), false, "second événement pour un paiement déjà réglé");
  eq((await settled(P.payment)).length, 1, "toujours une seule écriture de règlement");

  // ---- 4. The manual reconciliation finds nothing to settle and only estimates the commission.
  let run = await reconcile();
  eq([run.settled_added, run.commission_added, run.remaining_unsettled], [0, 1, 0], "rapprochement manuel : règlement déjà écrit");
  run = await reconcile();
  eq([run.settled_added, run.commission_added], [0, 0], "rejeu sans effet");

  // ---- 5. With the provider link first: one settlement, one withheld commission, no estimate.
  const W = await paidCheckout("W");
  await link(W);
  await reconcile();
  eq(await kinds(W.payment), ["commission_withheld", "payment_settled"], "une écriture par nature, sans estimation");

  // ---- 6. A ledger conflict never blocks the payment confirmation: the settlement stays to reconcile.
  const X = await paidCheckout("X", { confirm: false }), Z = await paidCheckout("Z", { confirm: false });
  await q("insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id)values(gen_random_uuid(),'payment_settled','credit',12000,'eur',$1,'cs_test_Z')", [X.payment]);
  eq(await confirm(Z), true, "paiement confirmé malgré le conflit d’écriture");
  eq(await one("select status v from public.payments where id=$1", [Z.payment]), "paid", "le paiement est réglé");
  eq((await settled(Z.payment)).length, 0, "écriture absente, visible au rapport");
  eq((await report()).ledger.missing_settlement, 1, "le rapport signale le règlement à rapprocher");
  eq(await one("select count(*)::integer v from public.platform_audit where action='settlement_entry_failed' and target_id=$1", [Z.payment]), 1, "l’échec est journalisé");

  // ---- 7. The ledger stays closed to members: no direct write, read under finance scope only.
  await as(ids.client, "authenticated");
  await assert.rejects(q("insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id)values(gen_random_uuid(),'payment_settled','credit',1,'eur',$1)", [P.payment]), (e) => e.code === "42501"); checks++;
  eq((await q("select id from public.platform_ledger_entries")).length, 0, "un client ne lit aucune écriture");
  await as(null, null);

  // ---- 7b. The manual catch-up survives the ledger conflict of section 6: the conflicting payment
  // stays to reconcile (counted, audited) and every other payment is still settled in the same run.
  const C = await paidCheckout("C", { confirm: false });
  await q("alter table public.payments disable trigger payments_settlement_entry");
  await confirm(C);
  await q("alter table public.payments enable trigger payments_settlement_entry");
  eq((await settled(C.payment)).length, 0, "paiement confirmé sans écriture (rattrapage attendu)");
  run = await reconcile();
  eq([run.settled_added, run.settlement_conflicts, run.remaining_unsettled], [1, 1, 1], "rattrapage : un réglé, un conflit compté, un restant");
  eq([(await settled(C.payment)).length, (await settled(Z.payment)).length], [1, 0], "l’autre paiement est réglé ; le paiement en conflit reste à rapprocher");
  eq(await one("select count(*)::integer v from public.platform_audit where action='settlement_entry_conflict' and target_id=$1", [Z.payment]), 1, "le conflit est journalisé avec le paiement");
  eq((await report()).ledger.missing_settlement, 1, "le rapport signale toujours le paiement en conflit");

  // ---- 7c. Old conflicts must not monopolise a bounded batch across repeated calls.
  // With limit 1 the old Z conflict used to win every time; later valid payments never settled.
  const B1 = await paidCheckout("batch_one", { confirm: false }), B2 = await paidCheckout("batch_two", { confirm: false });
  await q("alter table public.payments disable trigger payments_settlement_entry");
  await confirm(B1); await confirm(B2);
  await q("update public.payments set paid_at=(select paid_at from public.payments where id=$1)+interval '1 second' where id in ($2,$3)", [Z.payment, B1.payment, B2.payment]);
  await q("alter table public.payments enable trigger payments_settlement_entry");
  run = await reconcile(1);
  eq([run.settled_added, run.remaining_unsettled], [1, 2], "lot limité : un règlement valide avance malgré un conflit plus ancien");
  run = await reconcile(1);
  eq([run.settled_added, run.remaining_unsettled], [1, 1], "second lot : l’autre règlement valide avance");
  eq([(await settled(B1.payment)).length, (await settled(B2.payment)).length, (await settled(Z.payment)).length], [1, 1, 0], "les deux règlements valides sont inscrits une fois ; le conflit reste visible");
  run = await reconcile(1);
  eq([run.settled_added, run.settlement_conflicts, run.remaining_unsettled], [0, 1, 1], "lot de conflits seulement : anomalie toujours comptée sans faux règlement");

  // ---- 8. Out-of-order provider events (Stripe gives no ordering guarantee).
  const fail = (c, type, event) => one("select public.record_stripe_payment_failure($1,$2,$3,$4,$5,$6)v", [event, type, c.session, c.quote, c.amount, "eur"]);
  const attempt = (c) => one("select status v from public.payment_attempts where session_id=$1", [c.session]);
  const pay = (c) => one("select status v from public.payments where id=$1", [c.payment]);
  // 8a. Asynchronous failure first, success afterwards: one settlement, written on the success only.
  const A = await paidCheckout("A", { confirm: false });
  eq(await fail(A, "checkout.session.async_payment_failed", "evt_fail_A"), true, "échec asynchrone appliqué");
  eq([await pay(A), (await settled(A.payment)).length], ["failed", 0], "paiement en échec : aucune écriture");
  eq(await confirm(A, "evt_ok_A"), true, "succès asynchrone reçu après l’échec");
  eq([await pay(A), await attempt(A), (await settled(A.payment)).length], ["paid", "paid", 1], "réglé : une seule écriture");
  // 8b. A late failure (replayed or new identifier) never downgrades nor writes.
  eq(await fail(A, "checkout.session.async_payment_failed", "evt_fail_A"), false, "échec rejoué");
  eq(await fail(A, "checkout.session.async_payment_failed", "evt_fail_A_late"), false, "nouvel échec tardif");
  eq(await fail(A, "checkout.session.expired", "evt_exp_A_late"), false, "expiration tardive");
  eq([await pay(A), await attempt(A), (await settled(A.payment)).length], ["paid", "paid", 1], "toujours réglé, tentative réglée, une écriture");
  eq(await one("select count(*)::integer v from public.platform_ledger_entries where payment_id=$1 and direction='debit'", [A.payment]), 0, "aucune écriture inverse");
  // 8c. An expired Checkout cannot be paid by a late completion: refused, nothing written.
  const E = await paidCheckout("E", { confirm: false });
  eq(await fail(E, "checkout.session.expired", "evt_exp_E"), true, "expiration appliquée");
  eq(await one("select status v from public.platform_checkouts where id=$1", [E.checkout]), "expired", "session marquée expirée");
  await assert.rejects(confirm(E, "evt_ok_E"), (e) => e.code === "P0001"); checks++;
  eq([await pay(E), (await settled(E.payment)).length], ["failed", 0], "aucun règlement pour une session expirée");
  eq(await one("select count(*)::integer v from public.stripe_events where id='evt_ok_E'"), 0, "événement refusé non consommé : Stripe le renverra");
  // 8d. The manual reconciliation adds nothing to these payments.
  await reconcile();
  eq([(await settled(A.payment)).length, (await settled(E.payment)).length], [1, 0], "rapprochement manuel : ni doublon ni règlement d’une session expirée");

  console.log(`PASS: settlement entry written at payment confirmation, replay-safe and non-blocking (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
