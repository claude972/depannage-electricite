import test from "node:test";
import assert from "node:assert/strict";
import { parseInvoicePdfInput, renderInvoicePdf, invoicePdfFileName, InvoicePdfError, type InvoicePdfInput } from "../../lib/features/platform-operations/invoice-pdf";

function sample(patch: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
  return {
    kind: "invoice", basis: "service", number: "F2026-000042", issued_at: "2026-10-31T12:34:56.123456+00:00", currency: "eur",
    issuer: { legal_name: "Électricité QA - société de contrôle", siret: "12345678901234", address: "12 rue des Écoles\n97200 Fort-de-France", vat_number: null, legal_status: "EI" },
    recipient: { name: "Client QA Élodie", address: "4 allée de l’Étang\n97200 Fort-de-France", siret: null, vat_number: null },
    lines: [{ label: "Diagnostic électrique et main-d’œuvre", quantity: 2, unit_price_cents: 10001 }],
    subtotal_cents: 20002, tax_rate: 20, tax_cents: 4000, total_cents: 24002,
    related_number: null, reason: "", quote_reference: "0A1B2C3D", intervention_id: "10000000-0000-4000-8000-000000000001", ...patch,
  };
}
const pdfText = (input: InvoicePdfInput) => Buffer.from(renderInvoicePdf(input)).toString("latin1");

test("invoice rendering is deterministic and has exact PDF xref offsets, fonts and page count", () => {
  const input = sample();
  const bytes = renderInvoicePdf(input);
  assert.deepEqual(bytes, renderInvoicePdf(input));
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/BaseFont \/Helvetica\b/);
  assert.match(text, /\/Encoding \/WinAnsiEncoding/);
  const xref = /startxref\n(\d+)\n%%EOF/.exec(text);
  assert.ok(xref);
  assert.equal(text.slice(Number(xref[1]), Number(xref[1]) + 4), "xref");
  const entries = /xref\n0 (\d+)\n0000000000 65535 f \n([\s\S]*?)trailer/.exec(text);
  assert.ok(entries);
  const offsets = [...entries[2].matchAll(/(\d{10}) 00000 n/g)];
  assert.equal(offsets.length, Number(entries[1]) - 1);
  offsets.forEach((offset, index) => assert.ok(text.slice(Number(offset[1])).startsWith(`${index + 1} 0 obj\n`)));
  assert.match(text, /\/Type \/Pages .*\/Count 1/);
  assert.match(text, /Page 1 \/ 1/);
});

test("French accents, euro and exact cents survive; absent VAT identity is explicitly unset", () => {
  const text = pdfText(sample());
  assert.ok(text.includes("\\311metteur")); // WinAnsi É, not a black box or replacement glyph.
  assert.ok(text.includes("240,02\\240\\200")); // literal cents and euro in WinAnsi.
  assert.ok(text.includes("non renseign\\351e"));
  assert.ok(!text.includes("acquitt"));
  assert.ok(!text.includes("rembours\\351"));
});

test("long lines make a multipage invoice with repeated table headers, all lines and page footers", () => {
  const lines = Array.from({ length: 30 }, (_, index) => ({ label: `QA-${String(index + 1).padStart(2, "0")} Vérification du tableau électrique avec repérage des circuits et protections différentielles du bâtiment`, quantity: 1, unit_price_cents: 1234 }));
  const input = sample({ lines, subtotal_cents: 37020, tax_cents: 7404, total_cents: 44424 });
  const text = pdfText(input);
  const pages = Number(/\/Type \/Pages .*\/Count (\d+)/.exec(text)?.[1]);
  assert.ok(pages >= 2);
  for (let i = 1; i <= 30; i++) assert.ok(text.includes(`QA-${String(i).padStart(2, "0")}`));
  assert.ok((text.match(/\(Prestation\)/g) || []).length >= 2);
  for (let page = 1; page <= pages; page++) assert.ok(text.includes(`Page ${page} / ${pages}`));
  assert.ok(text.includes("444,24\\240\\200"));
  // All positioned text remains within the sheet; body content is never sent below its footer.
  for (const match of text.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)) {
    assert.ok(Number(match[1]) >= 0 && Number(match[1]) < 596);
    assert.ok(Number(match[2]) >= 30 && Number(match[2]) < 842);
  }
});

test("VAT validation follows service HT rounding and commission inclusive extraction", () => {
  for (const tax_rate of [0, 5.5, 10, 20]) {
    const tax_cents = Math.round(11111 * tax_rate / 100);
    assert.doesNotThrow(() => renderInvoicePdf(sample({ lines: [{ label: "QA taux", quantity: 1, unit_price_cents: 11111 }], subtotal_cents: 11111, tax_rate, tax_cents, total_cents: 11111 + tax_cents })));
  }
  // 014: commission 0,03 EUR TTC => HT 0,03 and VAT 0; adding VAT to this HT would be wrong.
  const commission = sample({ basis: "platform_commission", lines: [{ label: "Commission confirmée QA", quantity: 1, unit_price_cents: 3 }], subtotal_cents: 3, tax_cents: 0, total_cents: 3 });
  assert.doesNotThrow(() => renderInvoicePdf(commission));
  assert.throws(() => renderInvoicePdf({ ...commission, basis: "service" }), InvoicePdfError);
});

test("credit note keeps its recorded cumulative VAT allocation and linked invoice without asserting a refund", () => {
  // Example: invoice VAT1/TTC6; first credit3 allocates round(3*1/6)=1 cent VAT.
  const credit = sample({ kind: "credit_note", number: "A2026-000001", related_number: "F2026-000042", reason: "Ajustement partiel QA enregistré", lines: [{ label: "Avoir sur facture F2026-000042", quantity: 1, unit_price_cents: 2 }], subtotal_cents: 2, tax_cents: 1, total_cents: 3 });
  const text = pdfText(credit);
  assert.ok(text.includes("AVOIR"));
  assert.ok(text.includes("Avoir li\\351 \\340 la facture F2026-000042"));
  assert.ok(text.includes("0,03\\240\\200"));
  assert.ok(text.includes("ne confirme pas"));
  assert.throws(() => renderInvoicePdf({ ...credit, related_number: null }), InvoicePdfError);
  assert.throws(() => renderInvoicePdf({ ...credit, reason: "" }), InvoicePdfError);
});

test("missing identities, invalid dates, inconsistent cents and unexpected currencies fail closed", () => {
  const input = sample();
  for (const patch of [
    { issuer: { ...input.issuer, legal_name: "" } }, { issuer: { ...input.issuer, siret: "invalid" } },
    { recipient: { ...input.recipient, address: "" } }, { lines: [] },
    { subtotal_cents: 20001 }, { total_cents: 24003 }, { tax_cents: 3999, total_cents: 24001 },
    { tax_cents: 0.5 }, { issued_at: "2026-99-01T00:00:00Z" }, { currency: "usd" }, { related_number: "F2026-other" },
  ]) assert.throws(() => parseInvoicePdfInput({ ...input, ...patch }), InvoicePdfError);
});

test("stored text cannot inject PDF operators or unsafe attachment paths", () => {
  const text = pdfText(sample({ lines: [{ label: "QA ) /OpenAction ( \\ injection", quantity: 2, unit_price_cents: 10001 }] }));
  assert.ok(text.includes("QA \\) /OpenAction \\( \\\\ injection"));
  assert.ok(!text.includes("QA ) /OpenAction ("));
  assert.equal(invoicePdfFileName({ kind: "invoice", number: 'Été/../../"\r\nQA' }), "facture-Ete-QA.pdf");
  assert.equal(invoicePdfFileName({ kind: "credit_note", number: "***" }), "avoir-document.pdf");
});
