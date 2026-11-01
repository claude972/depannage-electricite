import test from "node:test";
import assert from "node:assert/strict";
import { bookingOptions, cardHoldConfigured } from "../lib/features/guest/payment-options";
test("card capability never enables live keys by their presence alone", () => {
  for (const value of [undefined, "", "not-a-key", "sk_live_example", "rk_live_example"])
    assert.equal(cardHoldConfigured({ STRIPE_SECRET_KEY: value }), false);
  assert.equal(cardHoldConfigured({ STRIPE_SECRET_KEY: "sk_test_example" }), true);
  assert.equal(cardHoldConfigured({ STRIPE_SECRET_KEY: "rk_live_example", STRIPE_LIVE_PAYMENTS_ENABLED: "true" }), true);
});
test("phone disabled, unknown and enabled remain distinct; response never includes credentials", async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "PUBLIC_FAKE", STRIPE_SECRET_KEY: "sk_test_FAKE" };
  for (const phone of [false, true, null]) {
    const options = await bookingOptions(env, (async (url, init) => {
      assert.equal(String(url), "https://example.supabase.co/auth/v1/settings");
      assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
      return Response.json({ external: { phone } });
    }) as typeof fetch);
    assert.equal(options.phone_auth.available, phone);
    assert.equal(options.payment_methods[0].id, "on_site");
    assert.equal(options.payment_methods[1].available, true);
    assert.doesNotMatch(JSON.stringify(options), /PUBLIC_FAKE|sk_test_FAKE/);
  }
  const unavailable = await bookingOptions(env, (async () => { throw Error("provider"); }) as typeof fetch);
  assert.equal(unavailable.phone_auth.available, null);
  assert.equal((await bookingOptions({})).payment_methods[1].available, false);
});
