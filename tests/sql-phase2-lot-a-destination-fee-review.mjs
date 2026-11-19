import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { createServer } from "node:http";
import { once } from "node:events";
import { freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E72 — the signed application-fee webhook accepts a connected payment reference only for fees", async () => {
  const db = await freshDatabase();
  let providerReads = 0;
  const provider = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/application_fees/fee_synthetic");
    providerReads++;
    response.setHeader("Content-Type", "application/json");
    // This fixture covers a fee without a platform-originating charge. The
    // connected py_ reference is valid evidence, not an invented Checkout link.
    response.end(JSON.stringify({id:"fee_synthetic",object:"application_fee",livemode:false,
      charge:"py_connected",originating_transaction:null,amount:2400,currency:"eur"}));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    const key = "sk_test_fixtureOnly";
    const secret = "whsec_fixtureOnly";
    const stripe = new Stripe(key);
    const payload = (type, id, object) => ({
      id, type, object: "event", livemode: false, created: Math.floor(Date.now() / 1000), data: { object },
    });
    const fee = payload("application_fee.created", "evt_synthetic_fee", {
      id: "fee_synthetic", object: "application_fee", amount: 2400, currency: "eur", charge: "py_connected", livemode: false,
    });
    await withNext(db, async http => {
      const deliver = value => {
        const body = JSON.stringify(value);
        return http("/api/payments/webhook", {
          method: "POST", body, headers: { "Stripe-Signature": stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
        });
      };
      const first = await deliver(fee);
      assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
      assert.deepEqual(await first.json(), { received: true });
      assert.equal((await deliver(fee)).status, 200);
      const invalid = payload("charge.dispute.created", "evt_synthetic_dispute", {
        id: "du_synthetic", object: "dispute", amount: 2400, currency: "eur", charge: "py_connected", status: "needs_response", livemode: false,
      });
      assert.equal((await deliver(invalid)).status, 400);
      assert.deepEqual((await db.query("select event_id,event->'object'->>'source_charge' reference from public.stripe_financial_observations")).rows,
        [{ event_id: "evt_synthetic_fee", reference: "py_connected" }]);
    }, { SUPABASE_SERVICE_ROLE_KEY: serviceKey, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: secret, QA_STRIPE_FIXTURE: "fee-observation", QA_STRIPE_LOOPBACK_PORT: String(provider.address().port) }, {
      serviceRpcAllowlist: new Set(["ingest_stripe_financial_observation"]),
    });
    assert.equal(providerReads, 2, "deduplicated delivery still re-reads the provider");
    assert.equal((await db.query("select count(*)::int n from public.stripe_checkout_links")).rows[0].n, 0);
  } finally {
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await db.close();
  }
});
