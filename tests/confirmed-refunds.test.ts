import test from "node:test";
import assert from "node:assert/strict";
import { confirmedRefundsFrom } from "../lib/features/payments/confirmed-refunds";
import { refundSentence, refundSummary } from "../components/features/payment-refunds/refund-notice";

test("FIN-04 confirmed refunds: summed, capped by the payment, strict", () => {
  assert.deepEqual(confirmedRefundsFrom([{ amount_cents: 1000, settled_at: "2026-11-22T14:28:20Z" }], 16275), { count: 1, cents: 1000, last_settled_at: "2026-11-22T14:28:20Z" });
  assert.deepEqual(confirmedRefundsFrom([{ amount_cents: 1000, settled_at: "2026-11-20T10:00:00Z" }, { amount_cents: 500, settled_at: "2026-11-22T10:00:00Z" }], 16275), { count: 2, cents: 1500, last_settled_at: "2026-11-22T10:00:00Z" });
  assert.equal(confirmedRefundsFrom([], 16275), null);
  assert.equal(confirmedRefundsFrom([{ amount_cents: 20000, settled_at: null }], 16275), null, "above the payment: nothing shown");
  assert.equal(confirmedRefundsFrom([{ amount_cents: -1, settled_at: null }], 16275), null);
  assert.equal(confirmedRefundsFrom(null, 16275), null);
});

test("FIN-04 refund notice: only for a paid payment with a coherent server summary", () => {
  const payment = { status: "paid", total_cents: 16275, currency: "eur", created_at: "2026-11-22T04:29:42Z" };
  const base = { payment, attempts: [], attempts_limit: 50, history_limited: false };
  assert.equal(refundSummary(base), null);
  assert.equal(refundSummary({ ...base, payment: { ...payment, status: "pending" }, refunds: { count: 1, cents: 1000, last_settled_at: null } }), null);
  assert.equal(refundSummary({ ...base, refunds: { count: 1, cents: 99999, last_settled_at: null } }), null);
  const s = refundSummary({ ...base, refunds: { count: 1, cents: 1000, last_settled_at: "2026-11-22T14:28:20Z" } });
  assert.deepEqual(s, { count: 1, cents: 1000, lastSettledAt: "2026-11-22T14:28:20Z" });
  assert.match(refundSentence(s!, "payer"), /Remboursement de 10,00\s€ confirmé \(le 22 novembre 2026\) par le prestataire de paiement/);
  assert.match(refundSentence(s!, "artisan"), /au client sur ce règlement/);
  assert.match(refundSentence({ count: 2, cents: 1500, lastSettledAt: null }, "payer"), /^2 remboursements confirmés pour un total de 15,00\s€ par/);
});
