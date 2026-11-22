import test from "node:test";
import assert from "node:assert/strict";
import { commissionCents, creditNoteSplit, extractVat, paymentNet, reconcile, refundableCents, remainingCreditable } from "../../lib/features/platform-operations/ledger";
test("commission uses the checkout formula on integer cents and rejects invalid inputs", () => {
  assert.equal(commissionCents(30000, 1000), 3000);
  assert.equal(commissionCents(30000, 1500), 4500);
  assert.equal(commissionCents(1, 1), 0);
  assert.equal(commissionCents(33333, 1500), 5000);
  assert.equal(commissionCents(5, 5000), 3); // 2.5 rounds half away from zero like PostgreSQL round()
  assert.throws(() => commissionCents(30000, 10001));
  assert.throws(() => commissionCents(-1, 100));
  assert.throws(() => commissionCents(300.5, 100));
});
test("VAT is extracted from a withheld tax-inclusive amount, never added on top", () => {
  assert.deepEqual(extractVat(3000, 20), { subtotal_cents: 2500, tax_cents: 500, total_cents: 3000 });
  assert.deepEqual(extractVat(3000, 0), { subtotal_cents: 3000, tax_cents: 0, total_cents: 3000 });
  assert.deepEqual(extractVat(1001, 5.5), { subtotal_cents: 949, tax_cents: 52, total_cents: 1001 });
  for (const rate of [0, 5.5, 10, 20]) for (const total of [1, 7, 99, 12345, 999999]) { const v = extractVat(total, rate); assert.equal(v.subtotal_cents + v.tax_cents, total); assert.ok(v.tax_cents >= 0); }
  assert.throws(() => extractVat(3000, 19.6));
});
test("credit note VAT is a cumulative delta: split notes credit exactly the invoice VAT, never more", () => {
  assert.deepEqual(creditNoteSplit(12000, { tax_cents: 5000, total_cents: 30000 }), { subtotal_cents: 10000, tax_cents: 2000, total_cents: 12000 });
  assert.deepEqual(creditNoteSplit(1, { tax_cents: 5000, total_cents: 30000 }), { subtotal_cents: 1, tax_cents: 0, total_cents: 1 });
  assert.throws(() => creditNoteSplit(30001, { tax_cents: 5000, total_cents: 30000 }));
  const invoice = { tax_cents: 17, total_cents: 100 }; const credited = { total_cents: 0, tax_cents: 0 }; const taxes: number[] = [];
  for (const amount of [33, 33, 34]) { const note = creditNoteSplit(amount, invoice, credited); taxes.push(note.tax_cents); credited.total_cents += note.total_cents; credited.tax_cents += note.tax_cents; }
  assert.deepEqual(taxes, [6, 5, 6]); assert.equal(credited.tax_cents, 17);
  assert.throws(() => creditNoteSplit(1, invoice, credited));
  const tiny = { total_cents: 0, tax_cents: 0 };
  for (let i = 0; i < 100; i++) { const note = creditNoteSplit(1, invoice, tiny); assert.ok(note.tax_cents >= 0 && note.tax_cents <= 1 && note.subtotal_cents >= 0); tiny.total_cents += 1; tiny.tax_cents += note.tax_cents; assert.ok(tiny.tax_cents <= 17); }
  assert.equal(tiny.tax_cents, 17);
  assert.deepEqual(creditNoteSplit(5, { tax_cents: 17, total_cents: 100 }, { total_cents: 95, tax_cents: 17 }), { subtotal_cents: 5, tax_cents: 0, total_cents: 5 });
  assert.equal(remainingCreditable({ total_cents: 30000 }, [{ total_cents: 12000 }, { total_cents: 18000 }]), 0);
  assert.equal(remainingCreditable({ total_cents: 30000 }, []), 30000);
});
test("reconciliation diff reports missing, mismatched and orphan settlements exactly", () => {
  const payments = [
    { id: "p1", status: "paid" as const, total_cents: 30000, currency: "eur" },
    { id: "p2", status: "paid" as const, total_cents: 20000, currency: "eur" },
    { id: "p3", status: "pending" as const, total_cents: 100, currency: "eur" },
    { id: "p4", status: "paid" as const, total_cents: 500, currency: "eur" },
  ];
  const entries = [
    { payment_id: "p1", entry_kind: "payment_settled" as const, amount_cents: 30000, currency: "eur" as const },
    { payment_id: "p2", entry_kind: "payment_settled" as const, amount_cents: 19999, currency: "eur" as const },
    { payment_id: "p9", entry_kind: "payment_settled" as const, amount_cents: 1, currency: "eur" as const },
    { payment_id: "p4", entry_kind: "commission_estimated" as const, amount_cents: 50, currency: "eur" as const },
  ];
  assert.deepEqual(reconcile(payments, entries), { ok: ["p1"], missing: ["p4"], mismatched: [{ payment_id: "p2", expected_cents: 20000, ledger_cents: 19999 }], orphan: ["p9"] });
});
test("payment net distinguishes a confirmed withheld commission from an estimate", () => {
  const settled = { entry_kind: "payment_settled" as const, direction: "credit" as const, amount_cents: 30000 };
  assert.deepEqual(paymentNet([settled]), { gross_cents: 30000, commission_estimated_cents: null, commission_withheld_cents: null, refunded_cents: 0, net_to_artisan_cents: null, basis: "none" });
  assert.deepEqual(paymentNet([settled, { entry_kind: "commission_estimated", direction: "debit", amount_cents: 3000 }]), { gross_cents: 30000, commission_estimated_cents: 3000, commission_withheld_cents: null, refunded_cents: 0, net_to_artisan_cents: 27000, basis: "estimated" });
  const net = paymentNet([settled, { entry_kind: "commission_estimated", direction: "debit", amount_cents: 3000 }, { entry_kind: "commission_withheld", direction: "debit", amount_cents: 2900 }, { entry_kind: "refund_settled", direction: "debit", amount_cents: 5000 }]);
  assert.equal(net.basis, "withheld"); assert.equal(net.net_to_artisan_cents, 22100); assert.equal(net.commission_estimated_cents, 3000);
  assert.throws(() => paymentNet([{ entry_kind: "payment_settled", direction: "credit", amount_cents: 1.5 }]));
});
test("refundable amount excludes rejected and cancelled requests and never goes negative", () => {
  assert.equal(refundableCents({ total_cents: 30000 }, [{ status: "requested", amount_cents: 5000 }, { status: "rejected", amount_cents: 30000 }, { status: "cancelled", amount_cents: 25000 }]), 25000);
  assert.equal(refundableCents({ total_cents: 30000 }, [{ status: "approved", amount_cents: 5000 }, { status: "settled", amount_cents: 25000 }]), 0);
  assert.equal(refundableCents({ total_cents: 100 }, [{ status: "settled", amount_cents: 200 }]), 0);
});
