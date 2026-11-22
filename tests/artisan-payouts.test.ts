import test from "node:test";
import assert from "node:assert/strict";
import { payoutsReport, projectPayout } from "../lib/features/artisan-payouts/model";

test("FIN-06 payout projection: amounts, dates and status only; unexpected rows dropped", () => {
  const p = projectPayout({ id: "po_1Abc", amount: 9005, currency: "eur", status: "paid", created: 1795000000, arrival_date: 1795086400, automatic: true, destination: "ba_secret", description: "x", metadata: { a: "b" } });
  assert.deepEqual(Object.keys(p!).sort(), ["amount_cents", "arrival_date", "automatic", "created_at", "currency", "id", "status"]);
  assert.equal(p!.amount_cents, 9005);
  assert.equal(p!.status, "paid");
  assert.equal(projectPayout({ id: "po_1", amount: 100, currency: "usd", status: "paid", created: 1795000000, arrival_date: null }), null);
  assert.equal(projectPayout({ id: "tr_1", amount: 100, currency: "eur", status: "paid", created: 1795000000 }), null);
  assert.equal(projectPayout({ id: "po_1", amount: 100, currency: "eur", status: "weird", created: 1795000000 }), null);
  assert.equal(projectPayout(null), null);
  assert.ok(payoutsReport.safeParse({ state: "available", livemode: false, payouts: [p], has_more: false, read_at: new Date().toISOString() }).success);
  assert.ok(!payoutsReport.safeParse({ state: "available", livemode: false, payouts: [{ ...p, destination: "ba_x" }], has_more: false, read_at: "x" }).success);
});
