import test from "node:test";
import assert from "node:assert/strict";
import { isBookingHoldSession } from "../../lib/payment-events";
import { fakeServerHelpers, loadModule } from "../documents/harness";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const REQUEST = "20000000-0000-4000-8000-000000000002";
const QUOTE = "30000000-0000-4000-8000-000000000003";
const hold = {
  object: "checkout.session", mode: "payment", client_reference_id: REQUEST,
  metadata: { booking_actor: ACTOR, booking_request: REQUEST, booking_method: "card_hold" },
};
test("hold classification requires a bound booking actor/request and never masks a quote payment", () => {
  assert.equal(isBookingHoldSession(hold), true);
  for (const changed of [
    { object: "payment_intent" }, { mode: "setup" }, { client_reference_id: QUOTE },
    { metadata: { ...hold.metadata, booking_actor: "invalid" } },
    { metadata: { ...hold.metadata, quote_id: QUOTE } }, { metadata: null },
  ]) assert.equal(isBookingHoldSession({ ...hold, ...changed }), false);
});
function fixture(object: Record<string, unknown>, type = "checkout.session.expired", signed = true) {
  const calls: string[] = [];
  const helpers = fakeServerHelpers({ db: {} });
  const route = loadModule("app/api/payments/webhook/route.ts", {
    "node:process": { env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE_LOCAL_ONLY" } },
    "@/lib/supabase/stripe": { stripeClient: () => ({ webhooks: { constructEvent: () => {
      calls.push("signature");
      if (!signed) throw Error("Bad signature");
      return { id: "evt_FAKE_LOCAL_ONLY", livemode: false, type, data: { object } };
    } } }) },
    "@/lib/supabase/server": { ...helpers, adminClient: () => {
      calls.push("admin");
      return { rpc: async (name: string) => { calls.push(name); return { error: null }; } };
    } },
  });
  return { calls, send: () => (route.POST as (r: Request) => Promise<Response>)(new Request("https://app.example.test/api/payments/webhook", {
    method: "POST", headers: { "stripe-signature": "FAKE_LOCAL_ONLY" }, body: "{}",
  })) };
}
test("signed hold completed/expired is acknowledged without writing legacy payments or declaring it paid", async () => {
  for (const type of ["checkout.session.completed", "checkout.session.expired"]) {
    const f = fixture({ ...hold, id: "cs_test_fake", payment_status: "unpaid", status: type.endsWith("expired") ? "expired" : "complete" }, type);
    const r = await f.send();
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { received: true });
    assert.deepEqual(f.calls, ["signature"]);
  }
});
test("a hold label cannot bypass signature verification", async () => {
  const f = fixture(hold, "checkout.session.completed", false);
  assert.equal((await f.send()).status, 400);
  assert.deepEqual(f.calls, ["signature"]);
});
test("legacy paid quote events still reach the existing payment confirmation RPC", async () => {
  const f = fixture({ object: "checkout.session", id: "cs_test_legacy", mode: "payment", status: "complete", payment_status: "paid", currency: "eur", amount_total: 12000, client_reference_id: QUOTE, metadata: { quote_id: QUOTE } }, "checkout.session.completed");
  assert.equal((await f.send()).status, 200);
  assert.deepEqual(f.calls, ["signature", "admin", "confirm_stripe_payment"]);
});
