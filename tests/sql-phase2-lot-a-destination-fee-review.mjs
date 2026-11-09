import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E72 — the signed application-fee webhook accepts a connected payment reference only for fees", async () => {
  const db = await freshDatabase();
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
    }, { SUPABASE_SERVICE_ROLE_KEY: serviceKey, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: secret }, {
      serviceRpcAllowlist: new Set(["ingest_stripe_financial_observation"]),
    });
  } finally {
    await db.close();
  }
});
