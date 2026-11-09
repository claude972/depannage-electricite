import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { actor, assignee, requester, asUser, freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

const artisan = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "refund-artisan@example.test" };
const session = `cs_test_QA${randomUUID().replaceAll("-", "")}`;
const amount = 12_000;
const refundAmount = 2_000;
const command = randomUUID();

async function seed(db) {
  for (const [user, role] of [[actor, "client"], [assignee, "client"], [requester, "client"], [artisan, "artisan"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [user.id, user.email, { role, full_name: "Compte QA" }]);
  }
  await db.query("update public.profiles set role='admin' where id=$1", [assignee.id]);
  await asUser(db, assignee, "select public.platform_grant_scope($1,'finance_read','Recette isolée') v", [actor.id]);
  const grant = (await asUser(db, assignee, "select public.platform_grant_scope($1,'finance_write','Recette isolée') v", [actor.id])).grant.id;
  const job = (await db.query(`insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)
    values($1,$2,'socket','Intervention QA','Adresse fictive','97200','Fort-de-France','scheduled',2000,20000,'completed') returning id`, [requester.id, artisan.id])).rows[0].id;
  const quote = (await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)
    values($1,$2,'[]',12000,0,0,12000,'accepted') returning id`, [job, artisan.id])).rows[0].id;
  const checkout = (await db.query(`insert into public.platform_checkouts(quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)
    values($1,$2,$3,$4,12000,'[]','acct_QA','https://app.example',2000,2400,'open',$5,clock_timestamp()+interval'1 hour') returning id`,
  [quote, job, requester.id, artisan.id, session])).rows[0].id;
  await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status) values($1,$2,12000,'eur','pending')", [quote, session]);
  await db.transaction(async tx => {
    await tx.exec("set local role service_role");
    await tx.query("select public.confirm_stripe_payment($1,'checkout.session.completed',$2,$3,12000,'eur')", [`evt_QA${randomUUID().replaceAll("-", "")}`, session, quote]);
  });
  const payment = (await db.query("select id from public.payments where quote_id=$1", [quote])).rows[0].id;
  const r = await asUser(db, assignee, "select public.platform_request_refund($1,$2,$3,'Motif synthétique de recette') v", [randomUUID(), payment, refundAmount]);
  await asUser(db, assignee, "select public.platform_decide_refund($1,'approve',1,'Recette isolée') v", [r.request.id]);
  return { grant, quote, checkout, payment, id: r.request.id };
}

test("E78 — a revoked operator cannot emit, and the new operator resumes the same preparation", async () => {
  const db = await freshDatabase();
  let stripe;
  let releaseCharge;
  try {
    const f = await seed(db);
    const reached = Promise.withResolvers();
    const gate = Promise.withResolvers();
    releaseCharge = gate.resolve;
    let charges = 0;
    const writes = [];
    const metadata = { quote_id: f.quote, platform_checkout_id: f.checkout };
    const refundMeta = { platform_refund_execution_id: command, platform_refund_request_id: f.id, payment_id: f.payment, quote_id: f.quote };
    const intent = { id: "pi_QA", status: "succeeded", livemode: false, amount, amount_received: amount, currency: "eur", metadata,
      transfer_data: { destination: "acct_QA" }, application_fee_amount: 2400, latest_charge: "ch_QA" };
    stripe = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      let result;
      if (request.url === `/v1/checkout/sessions/${session}`) result = { id: session, object: "checkout.session", mode: "payment", livemode: false,
        client_reference_id: f.quote, metadata, amount_total: amount, currency: "eur", payment_status: "paid", payment_intent: "pi_QA" };
      else if (request.url === "/v1/payment_intents/pi_QA") result = intent;
      else if (request.url === "/v1/charges/ch_QA") {
        charges++;
        if (charges === 1) { reached.resolve(); await gate.promise; }
        result = { id: "ch_QA", livemode: false, paid: true, captured: true, amount, amount_captured: amount, amount_refunded: 0, currency: "eur",
          payment_intent: "pi_QA", transfer_data: { destination: "acct_QA" }, application_fee_amount: 2400 };
      } else if (request.url === "/v1/refunds" && request.method === "POST") {
        writes.push({ idempotency: request.headers["idempotency-key"], params: new URLSearchParams(body) });
        result = { id: "re_QA", object: "refund", amount: refundAmount, currency: "eur", charge: "ch_QA", payment_intent: "pi_QA", status: "pending", metadata: refundMeta };
      } else { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    });
    stripe.listen(0, "127.0.0.1");
    await once(stripe, "listening");
    await withNext(db, async http => {
      const path = `/api/platform-operations/finance/refund-requests/${f.id}/execution`;
      const post = (user, key = command) => http(path, { method: "POST", body: JSON.stringify({ command_id: key, expected_version: 2 }) }, user);
      const original = post(actor);
      try {
        await Promise.race([reached.promise, original.then(response => assert.fail(`Original stopped before Charge with HTTP ${response.status}`))]);
        const activeOwner = await http(path, {}, assignee);
        assert.equal(activeOwner.status, 200);
        assert.equal((await activeOwner.json()).reason, "operator_mismatch");
        await asUser(db, assignee, "select public.platform_revoke_scope($1,'Retrait pendant lecture de la charge') v", [f.grant]);
      } finally { gate.resolve(); }
      assert.equal((await original).status, 403);
      assert.equal(writes.length, 0);
      assert.equal((await (await http(path, {}, actor)).json()).reason, "read_only");
      const next = await http(path, {}, assignee);
      assert.equal(next.status, 200);
      const availability = await next.json();
      assert.deepEqual([availability.available, availability.reason, availability.execution_id], [true, "provider_verification_required", command]);
      assert.equal((await post(assignee, randomUUID())).status, 409);
      const takeover = await post(assignee);
      assert.equal(takeover.status, 202);
      assert.deepEqual(await takeover.json(), { request_status: "approved", execution_status: "submitted", execution_id: command, bank_confirmation: false });
      assert.equal(writes.length, 1);
      assert.equal(writes[0].idempotency, `platform-refund:${command}`);
      assert.equal(writes[0].params.get("amount"), String(refundAmount));
      assert.deepEqual((await db.query("select actor_id,state,provider_refund_id from public.platform_refund_executions where id=$1", [command])).rows,
        [{ actor_id: assignee.id, state: "submitted", provider_refund_id: "re_QA" }]);
      assert.equal((await db.query("select count(*)::int n from public.platform_audit where action='refund_execution_reassigned' and target_id=$1", [f.id])).rows[0].n, 1);
      await asUser(db, assignee, "select public.platform_grant_scope($1,'finance_write','Nouvelle habilitation de recette') v", [actor.id]);
      assert.equal((await post(actor)).status, 409, "an already submitted execution cannot be taken over");
      assert.equal(writes.length, 1);
    }, {
      QA_STRIPE_FIXTURE: "refund", QA_STRIPE_LOOPBACK_PORT: String(stripe.address().port), SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      STRIPE_SECRET_KEY: "sk_test_synthetic", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_qa", PLATFORM_REFUND_POLICY_VERSION: "qa",
      PLATFORM_REFUND_REVERSE_TRANSFER: "true", PLATFORM_REFUND_APPLICATION_FEE: "false",
    }, {
      users: [actor, assignee],
      rpcAllowlist: new Set(["has_platform_scope", "begin_refund_execution", "read_refund_execution", "authorize_refund_execution"]),
      serviceRpcAllowlist: new Set(["refund_execution_private", "qualify_refund_execution", "bind_refund_execution"]),
    });
  } finally {
    releaseCharge?.();
    if (stripe) {
      stripe.closeAllConnections();
      await new Promise(resolve => stripe.close(resolve));
    }
    await db.close();
  }
});
