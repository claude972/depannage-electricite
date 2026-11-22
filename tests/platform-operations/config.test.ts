import test from "node:test";
import assert from "node:assert/strict";
import { checkoutCommissionBps, financeConfig, outstandingEstimate, paymentProviderState, refundExecutionMessage } from "../../lib/features/platform-operations/config";
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
test("FIN-04: the refund banner states the true reason — « non configuré » only when the provider is not configured", () => {
  assert.match(refundExecutionMessage(paymentProviderState({})), /fournisseur de paiement non configuré/);
  const test_mode = refundExecutionMessage(paymentProviderState({ STRIPE_SECRET_KEY: "sk_test_abcdefgh" }));
  assert.doesNotMatch(test_mode, /non configuré/);
  assert.match(test_mode, /n’est pas activée/);
  assert.match(test_mode, /mode test/);
  assert.doesNotMatch(refundExecutionMessage(paymentProviderState({ STRIPE_SECRET_KEY: "sk_live_abcdefgh" })), /non configuré|mode test/);
  assert.match(refundExecutionMessage(null), /non vérifié/);
  for (const m of [refundExecutionMessage(null), test_mode]) assert.match(m, /Une demande approuvée n’est pas un remboursement effectué\.$/);
});
test("FIN-06: an estimate for a payment whose commission is already withheld is not shown as outstanding", () => {
  const ledger = { commission_estimated_count: 4, commission_estimated_cents: 4557 };
  assert.deepEqual(outstandingEstimate({ ledger, commission_estimated_superseded: { count: 3, cents: 3472 } }), { count: 1, cents: 1085, superseded: { count: 3, cents: 3472 } });
  // Not determined, nothing superseded or an inconsistent correction: the server totals are kept as they are.
  for (const superseded of [undefined, null, { count: 0, cents: 0 }, { count: 5, cents: 10 }, { count: 1, cents: 9999 }, { count: 1.5, cents: 10 }])
    assert.deepEqual(outstandingEstimate({ ledger, commission_estimated_superseded: superseded }), { count: 4, cents: 4557, superseded: null });
});
