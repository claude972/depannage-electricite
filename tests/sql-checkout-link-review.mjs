// Automatic Checkout reconciliation (migration 20261119120000) in real isolated SQL (PGlite).
// Provider references are injected as the server would pass them after re-reading Stripe.
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
  const deny = async (p, code) => { await assert.rejects(p, (e) => e.code === code, `attendu ${code}`); checks++; };
  async function as(actor, role) { await db.exec("reset role"); await q("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]); if (role) await db.exec(`set role ${role}`); }
  const ids = Object.fromEntries(["operator", "reader", "client", "artisan"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "artisan" ? "artisan" : "client", full_name: "QA" }), n + "@example.invalid"]);
  for (const [who, scopes] of [["operator", ["finance_read", "finance_write"]], ["reader", ["finance_read"]]]) for (const scope of scopes) await q("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,$2,$1)", [ids[who], scope]);

  // One paid platform Checkout per case (destination charge, frozen fee_cents).
  async function paidCheckout(tag, { amount = 12000, bps = 2000, fee = 2400, confirm = true } = {}) {
    await as(null, null);
    const job = await one("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA synthétique','QA adresse','97200','QA','scheduled','completed',10000,20000)returning id v", [ids.client, ids.artisan]);
    const quote = await one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":${amount}}]',${amount},0,0,${amount},'accepted')returning id v`, [job, ids.artisan]);
    const checkout = crypto.randomUUID(), session = "cs_test_" + tag;
    await q(`insert into public.platform_checkouts(id,quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)values($1,$2,$3,$4,$5,${amount},'[]','acct_QA','https://app.test',${bps},${fee},'open',$6,clock_timestamp()+interval'1hour')`, [checkout, quote, job, ids.client, ids.artisan, session]);
    const payment = await one(`insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,${amount},'eur','pending','stripe')returning id v`, [quote, session]);
    if (confirm) await q("select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)", ["evt_paid_" + tag, "checkout.session.completed", session, quote, amount, "eur"]);
    return { job, quote, checkout, session, payment, amount, fee, tag };
  }
  const refs = (c, { transfer = {}, fee = {}, noTransfer = false, noFee = false, ...top } = {}) => ({
    session_id: c.session, payment_intent_id: "pi_" + c.tag, charge_id: "ch_" + c.tag, destination: "acct_QA", amount_cents: c.amount, fee_cents: c.fee, currency: "eur",
    transfer: noTransfer ? null : { id: "tr_" + c.tag, amount: c.amount, currency: "eur", destination: "acct_QA", source_charge: "ch_" + c.tag, reversed: false, amount_reversed: 0, livemode: false, ...transfer },
    fee: noFee ? null : { id: "fee_" + c.tag, amount: c.fee, currency: "eur", account: "acct_QA", connected_charge: "py_" + c.tag, originating_charge: "ch_" + c.tag, amount_refunded: 0, livemode: false, ...fee },
    ...top,
  });
  const link = async (c, r, live = false, actor = null) => { await as(null, "service_role"); try { return await one("select public.record_stripe_checkout_link($1,$2,$3,$4)v", [c.checkout, live, r, actor]); } finally { await as(null, null); } };
  const obs = (id, c, family, type, patch = {}) => ({ id, type, family, livemode: false, source_account: null, created: new Date().toISOString(), object: family === "transfer"
    ? { id: "tr_" + c.tag, amount: c.amount, currency: "eur", source_charge: "ch_" + c.tag, destination: "acct_QA", amount_reversed: 0, reversed: false, status: null, ...patch }
    : { id: "fee_" + c.tag, amount: c.fee, currency: "eur", source_charge: "py_" + c.tag, destination: null, amount_reversed: null, reversed: null, status: null, ...patch } });
  const ingest = async (e) => { await as(null, "service_role"); try { return await one("select public.ingest_stripe_financial_observation($1,$2)v", [e, "a".repeat(64)]); } finally { await as(null, null); } };
  const result = (id) => one("select result v from public.stripe_financial_observations where event_id=$1", [id]);
  const commissions = (p) => one("select count(*)::integer v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'", [p]);

  // ---- Rights: the link writer and context are service-only.
  const A = await paidCheckout("A");
  for (const role of ["authenticated", "anon"]) {
    await as(ids.operator, role);
    await deny(q("select public.record_stripe_checkout_link($1,false,$2::jsonb,null)", [A.checkout, refs(A)]), "42501");
    await deny(q("select public.stripe_checkout_link_context($1)", [A.checkout]), "42501");
    await deny(q("select * from public.stripe_checkout_links"), "42501");
  }
  await as(null, null);

  // ---- Not confirmed locally: refused, nothing written.
  const P = await paidCheckout("P", { confirm: false });
  await deny(link(P, refs(P)), "P0001");
  eq(await one("select count(*)::integer v from public.stripe_checkout_links"), 0);

  // ---- Order A: signed observations BEFORE the link (Checkout confirmed, provider objects not yet bound).
  await ingest(obs("evt_A_tr", A, "transfer", "transfer.created"));
  await ingest(obs("evt_A_fee", A, "fee", "application_fee.created"));
  eq((await result("evt_A_tr")).reason, "unlinked_transfer");
  eq((await result("evt_A_fee")).reason, "fee_reference_not_bound");
  eq("payment_id" in (await result("evt_A_tr")), false, "forme historique inchangée sans lien");

  // Immediate re-read without Transfer/Fee yet: awaiting, nothing frozen to null, no commission.
  let r = await link(A, refs(A, { noTransfer: true, noFee: true }));
  eq([r.state, r.commission, r.rematched], ["awaiting_provider", "none", []]);
  eq(await commissions(A.payment), 0);

  // JSON null / wrong type on every mandatory provider reference: 22023 before any write.
  for (const bad of [
    { destination: null }, { currency: null }, { session_id: null }, { charge_id: 12 },
    { transfer: { source_charge: null } }, { transfer: { destination: null } }, { transfer: { livemode: null } },
    { fee: { account: null } }, { fee: { originating_charge: null } }, { fee: { currency: null } }, { fee: { amount: "2400" } }, { transfer: { currency: "usd" } },
  ]) {
    const { transfer, fee, ...top } = bad;
    await deny(link(A, refs(A, { transfer: transfer ?? {}, fee: fee ?? {}, ...top })), "22023");
  }
  // Exact references: account, mode, amounts, currency, charges.
  for (const bad of [
    { destination: "acct_OTHER" }, { amount_cents: 11999 }, { fee_cents: 2300 }, { session_id: "cs_test_OTHER" },
    { transfer: { destination: "acct_OTHER" } }, { transfer: { amount: 9600 } }, { transfer: { source_charge: "ch_OTHER" } }, { transfer: { livemode: true } },
    { fee: { account: "acct_OTHER" } }, { fee: { amount: 2401 } }, { fee: { originating_charge: "ch_OTHER" } }, { fee: { livemode: true } },
  ]) {
    const { transfer, fee, ...top } = bad;
    await deny(link(A, refs(A, { transfer: transfer ?? {}, fee: fee ?? {}, ...top })), "P0001");
  }
  await deny(link(A, refs(A), true), "P0001"); // live flag different from the provider objects
  await deny(link(A, refs(A, { payment_intent_id: "pi_OTHER" })), "P0001"); // recorded link compared, never overwritten
  eq(await commissions(A.payment), 0);

  // Operator actor rights are re-checked inside the write transaction (client / read-only: refused).
  await deny(link(A, refs(A), false, ids.client), "42501");
  await deny(link(A, refs(A), false, ids.reader), "42501");
  eq(await one("select count(*)::integer v from public.stripe_checkout_links where payment_id=$1 and state<>'awaiting_provider'", [A.payment]), 0);
  // Complete link: one commission from frozen fee_cents, both observations re-associated with history.
  r = await link(A, refs(A), false, ids.operator);
  eq([r.state, r.commission], ["linked", "recorded"]);
  eq([...r.rematched].sort(), ["evt_A_fee", "evt_A_tr"]);
  let tr = await result("evt_A_tr"), fe = await result("evt_A_fee");
  eq([tr.state, tr.reason, tr.payment_id, tr.intervention_id, tr.quote_id, tr.settlement_id], ["matched", "linked_checkout_transfer", A.payment, A.job, A.quote, null]);
  eq([fe.state, fe.reason, fe.payment_id], ["matched", "linked_checkout_fee", A.payment]);
  eq(await one("select amount_cents v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'", [A.payment]), 2400);
  eq(await one("select external_event_id v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'", [A.payment]), "fee_A");
  eq(await one("select count(*)::integer v from public.stripe_financial_rematches where payment_id=$1", [A.payment]), 2);
  await as(ids.reader, "authenticated");
  const d = await one("select public.stripe_financial_observation_detail('evt_A_tr')v");
  eq([d.record.version, d.automatic_history.length, d.automatic_history[0].previous.reason, d.automatic_history[0].outcome.reason], [2, 1, "unlinked_transfer", "linked_checkout_transfer"]);
  await as(null, null);

  // Replay / lost answer: same result, no second commission, no new version.
  r = await link(A, refs(A));
  eq([r.state, r.commission, r.rematched], ["linked", "existing", []]);
  eq(await commissions(A.payment), 1);
  eq(await one("select version v from public.stripe_financial_observations where event_id='evt_A_tr'"), 2);

  // Order B: observations AFTER the link are associated at ingestion; distinct event for the same Fee: no 2nd commission.
  await ingest(obs("evt_A_tr2", A, "transfer", "transfer.updated"));
  await ingest(obs("evt_A_fee2", A, "fee", "application_fee.created"));
  eq((await result("evt_A_tr2")).reason, "linked_checkout_transfer");
  eq((await result("evt_A_fee2")).reason, "linked_checkout_fee");
  eq(await commissions(A.payment), 1);
  // A connected-account envelope or a mismatching amount is never associated.
  await ingest({ ...obs("evt_A_fee_conn", A, "fee", "application_fee.created"), source_account: "acct_QA" });
  eq((await result("evt_A_fee_conn")).reason, "fee_proof_mismatch");
  await ingest(obs("evt_A_tr_bad", A, "transfer", "transfer.updated", { amount: 9600 }));
  eq([(await result("evt_A_tr_bad")).reason, (await result("evt_A_tr_bad")).intervention_id], ["transfer_proof_mismatch", null]);

  // Same Fee / Transfer / Charge for another payment: refused.
  const B = await paidCheckout("B");
  await deny(link(B, refs(B, { fee: { id: "fee_A" } })), "P0001");
  await deny(link(B, refs(B, { transfer: { id: "tr_A" } })), "P0001");
  await deny(link(B, refs(B, { charge_id: "ch_A", transfer: { source_charge: "ch_A" }, fee: { originating_charge: "ch_A" } })), "P0001");
  eq(await commissions(B.payment), 0);

  // Later reversal read on an operator re-run: CURRENT state to review, initial proof kept, no 2nd commission.
  r = await link(A, refs(A, { transfer: { reversed: true, amount_reversed: 12000 } }), false, ids.operator);
  eq([r.state, r.review_reason, r.commission], ["needs_review", "transfer_reversal", "existing"]);
  eq(await one("select transfer_reversed v from public.stripe_checkout_links where payment_id=$1", [A.payment]), false);
  eq([(await result("evt_A_tr")).state, (await result("evt_A_tr")).reason], ["needs_review", "transfer_reversal"]);
  eq([(await result("evt_A_fee")).state, (await result("evt_A_fee")).reason], ["needs_review", "checkout_link_review"]);
  eq(await commissions(A.payment), 1);
  r = await link(A, refs(A)); // a later clean read never returns to linked
  eq(r.state, "needs_review");
  await ingest(obs("evt_A_fee_ref", A, "fee", "application_fee.refunded"));
  eq([(await result("evt_A_fee_ref")).state, (await result("evt_A_fee_ref")).reason], ["needs_review", "fee_refund_review"]);

  // Codex point 8: awaiting -> complete combines frozen proofs with the CURRENT provider state.
  const C = await paidCheckout("C");
  eq((await link(C, refs(C, { noFee: true }))).state, "awaiting_provider"); // Transfer frozen clean
  r = await link(C, refs(C, { transfer: { reversed: true, amount_reversed: 100 } })); // now reversed, Fee present
  eq([r.state, r.review_reason, r.commission], ["needs_review", "transfer_reversal", "none"]);
  eq(await commissions(C.payment), 0);
  const D = await paidCheckout("D");
  eq((await link(D, refs(D, { noTransfer: true }))).state, "awaiting_provider"); // Fee frozen clean
  r = await link(D, refs(D, { fee: { amount_refunded: 2400 } }));
  eq([r.state, r.review_reason, r.commission], ["needs_review", "fee_refunded", "none"]);
  eq(await commissions(D.payment), 0);

  // Zero commission: no Application Fee exists; the Transfer alone completes the link, no ledger entry.
  const Z = await paidCheckout("Z", { bps: 0, fee: 0 });
  r = await link(Z, refs(Z, { noFee: true }));
  eq([r.state, r.commission], ["linked", "none"]);
  eq(await commissions(Z.payment), 0);
  await deny(link(Z, refs(Z, { fee: { amount: 0 } })), "P0001"); // a Fee object for a zero commission is inconsistent

  // Operator review recomputes with the link (no forced state); immutability of link and ledger.
  await ingest(obs("evt_B_tr", B, "transfer", "transfer.created"));
  await link(B, refs(B));
  eq((await result("evt_B_tr")).reason, "linked_checkout_transfer");
  await as(null, null);
  await deny(q("update public.stripe_checkout_links set fee_cents=1 where payment_id=$1", [B.payment]), "P0001");
  await deny(q("update public.stripe_checkout_links set state='linked',review_reason=null where payment_id=$1", [A.payment]), "P0001");
  await deny(q("delete from public.stripe_checkout_links where payment_id=$1", [B.payment]), "P0001");
  await deny(q("update public.platform_ledger_entries set amount_cents=1 where payment_id=$1", [B.payment]), "P0001");
  eq(await one("select count(*)::integer v from public.platform_audit where action='checkout_provider_linked' and target_kind='reconciliation'") > 0, true);
  // Revocation between the HTTP check and the SQL write: refused for the operator, webhook (null actor) unaffected.
  await q("update public.platform_operator_grants set status='revoked',revoked_at=now(),revoked_by=user_id where user_id=$1 and scope='finance_write'", [ids.operator]);
  await deny(link(B, refs(B), false, ids.operator), "42501");
  eq((await link(B, refs(B))).commission, "existing");
  // Guest settlement path untouched: payment/charge statuses unchanged, no transfer or charge object created here.
  eq(await one("select status v from public.payments where id=$1", [A.payment]), "paid");

  console.log(JSON.stringify({ sql: "PASS", checks, scope: "checkout provider link", provider: false, cloud: false }));
} finally {
  await db.close();
}
