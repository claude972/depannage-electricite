import test from "node:test";
import assert from "node:assert/strict";
import { checkoutCommissionBps, financeConfig, paymentProviderState } from "../../lib/features/platform-operations/config";
test("commission rate is reported as not configured unless PLATFORM_FEE_BPS is a valid integer", () => {
  assert.equal(checkoutCommissionBps({}), null);
  assert.equal(checkoutCommissionBps({ PLATFORM_FEE_BPS: "" }), null);
  assert.equal(checkoutCommissionBps({ PLATFORM_FEE_BPS: "15%" }), null);
  assert.equal(checkoutCommissionBps({ PLATFORM_FEE_BPS: "10001" }), null);
  assert.equal(checkoutCommissionBps({ PLATFORM_FEE_BPS: "1500" }), 1500);
});
test("provider state never exposes the key and distinguishes test from live", () => {
  assert.deepEqual(paymentProviderState({}), { configured: false, mode: null, live_enabled: false });
  assert.deepEqual(paymentProviderState({ STRIPE_SECRET_KEY: "sk_test_abc" }), { configured: true, mode: "test", live_enabled: false });
  assert.deepEqual(paymentProviderState({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_LIVE_PAYMENTS_ENABLED: "true" }), { configured: true, mode: "live", live_enabled: true });
  assert.ok(!JSON.stringify(paymentProviderState({ STRIPE_SECRET_KEY: "sk_test_secret" })).includes("secret"));
});
test("setting and checkout rates are compared, alignment unknown when either is missing", () => {
  assert.equal(financeConfig({}, null, false).commission.aligned, null);
  assert.equal(financeConfig({ PLATFORM_FEE_BPS: "1500" }, null, false).commission.aligned, null);
  assert.equal(financeConfig({ PLATFORM_FEE_BPS: "1500" }, { bps: 1500, version: 2 }, true).commission.aligned, true);
  const c = financeConfig({ PLATFORM_FEE_BPS: "1500" }, { bps: 1000, version: 3 }, true);
  assert.deepEqual(c.commission, { setting_bps: 1000, setting_version: 3, checkout_bps: 1500, aligned: false });
  assert.equal(c.invoice_issuer.configured, true);
});
