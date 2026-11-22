import test from "node:test";
import assert from "node:assert/strict";
import { invoiceDocumentInput } from "../../lib/features/platform-operations/invoice-document";
import type { Invoice } from "../../lib/features/platform-operations/types";
const row: Invoice = {
  id: "i1", request_id: "r1", kind: "credit_note", basis: "service", number: "A2026-000001", issuer_key: "artisan:x",
  issuer: { legal_name: "Électricité QA", siret: "12345678901234", address: "12 rue du Test", vat_number: null, legal_status: "EI" },
  recipient: { name: "Client QA", address: "4 rue des Tests", siret: null, vat_number: null, subject_kind: "profile", subject_id: "c1" },
  payment_id: "p1", quote_id: "0a1b2c3d-0000-4000-8000-000000000000", intervention_id: "j1", related_invoice_id: "i0",
  lines: [{ label: "Avoir sur facture F2026-000001", quantity: 1, unit_price_cents: 10000 }], subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, currency: "eur", reason: "Remise", issued_by: "u1", issued_at: "2026-10-31T10:00:00+00:00",
};
test("document input carries only stored data and the related invoice number", () => {
  const doc = invoiceDocumentInput(row, { number: "F2026-000001" });
  assert.equal(doc.related_number, "F2026-000001"); assert.equal(doc.quote_reference, "DEV-0A1B2C"); assert.equal(doc.issuer.vat_number, null); assert.equal(doc.recipient.name, "Client QA"); assert.equal(doc.tax_rate, 20);
  assert.equal(invoiceDocumentInput({ ...row, kind: "invoice", related_invoice_id: null }, null).related_number, null);
  assert.ok(!("mentions" in doc));
});
test("inconsistent amounts are refused instead of rendered", () => {
  assert.throws(() => invoiceDocumentInput({ ...row, tax_cents: 1 }, null), /incohérents/);
});
