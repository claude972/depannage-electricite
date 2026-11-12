import test from "node:test";
import assert from "node:assert/strict";
import { bookingOptions, cardHoldConfigured } from "../lib/features/guest/payment-options";
const testConfig = {
  STRIPE_SECRET_KEY: "sk_test_FAKE",
  GUEST_SETTLEMENT_ENABLED: "true",
  PLATFORM_FEE_BPS: "2000",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
};
test("new holds require a valid mode, capture switch, commission and return origin", () => {
  for (const value of [undefined, "", "not-a-key", "sk_live_example", "rk_live_example"])
    assert.equal(cardHoldConfigured({ ...testConfig, STRIPE_SECRET_KEY: value }), false);
  for (const partial of [
    { GUEST_SETTLEMENT_ENABLED: undefined }, { GUEST_SETTLEMENT_ENABLED: "false" },
    ...[undefined, " ", "-1", "1.5", "10000"].map(PLATFORM_FEE_BPS => ({ PLATFORM_FEE_BPS })),
    ...[undefined, "malformed", "http://app.example.test", "https://user@app.example.test"].map(NEXT_PUBLIC_APP_URL => ({ NEXT_PUBLIC_APP_URL })),
  ]) assert.equal(cardHoldConfigured({ ...testConfig, ...partial }), false);
  assert.equal(cardHoldConfigured({ STRIPE_SECRET_KEY: testConfig.STRIPE_SECRET_KEY }), false);
  assert.equal(cardHoldConfigured(testConfig), true);
  assert.equal(cardHoldConfigured({ ...testConfig, PLATFORM_FEE_BPS: "0", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }), true);
  const live = { ...testConfig, STRIPE_SECRET_KEY: "rk_live_example", STRIPE_LIVE_PAYMENTS_ENABLED: "true" };
  assert.equal(cardHoldConfigured(live), false);
  assert.equal(cardHoldConfigured({ ...live, GUEST_SETTLEMENT_LIVE_ENABLED: "true" }), true);
});
test("phone disabled, unknown and enabled remain distinct; response never includes credentials", async () => {
  const env = { ...testConfig, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "PUBLIC_FAKE" };
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
test("deferred booking means platform-only collection; unavailable card hold never offers direct artisan settlement",async()=>{
 const options=await bookingOptions({});const deferred=options.payment_methods.find(m=>m.id==="on_site")!;
 assert.equal(deferred.available,true);assert.match(deferred.label,/plateforme/);assert.match(deferred.description,/Aucun paiement direct/);
 assert.doesNotMatch(deferred.label,/sur place/i);assert.match(options.payment_methods[1].reason!,/plateforme après l’intervention/);
});

test("a preview with no valid test list never advertises phone auth or requests provider settings", async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "PUBLIC_FAKE" };
  let reads = 0;
  const fetcher: typeof fetch = async () => { reads++; return Response.json({ external: { phone: true } }); };
  for (const list of [undefined, "", "+590690000101,malformed"]) {
    const options = await bookingOptions({ ...env, VERCEL_ENV: "preview", TEST_PHONE_NUMBERS: list }, fetcher);
    assert.equal(options.phone_auth.available, false);
  }
  assert.equal(reads, 0);
  const options = await bookingOptions({ ...env, VERCEL_ENV: "preview", TEST_PHONE_NUMBERS: "+596696000101" }, fetcher);
  assert.equal(options.phone_auth.available, true);
  assert.equal(reads, 1);
});
