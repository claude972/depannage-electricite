import test from "node:test";
import assert from "node:assert/strict";
import { PDF_DEMO_NOTE, PDF_UNAVAILABLE_NOTE, invoiceDocumentLinks, invoicePdfPath } from "../../lib/features/platform-operations/invoice-links";
import { INVOICE_RENDERING_AVAILABLE } from "../../lib/features/platform-operations/config";
const id = "0a1b2c3d-0000-4000-8000-000000000001";
test("links point at the private PDF route with inline for opening and nothing for download", () => {
  assert.equal(invoicePdfPath(id, true), `/api/platform-operations/finance/invoices/${id}/pdf?inline=1`);
  assert.equal(invoicePdfPath(id.toUpperCase(), false), `/api/platform-operations/finance/invoices/${id}/pdf`);
  assert.throws(() => invoicePdfPath("../x", true));
});
test("no link without the server capability or without a stored document; demo shows disabled links", () => {
  assert.deepEqual(invoiceDocumentLinks({ invoiceId: id, rendering: false, demo: false }), { state: "unavailable", note: PDF_UNAVAILABLE_NOTE });
  assert.deepEqual(invoiceDocumentLinks({ invoiceId: id, rendering: undefined, demo: false }), { state: "unavailable", note: PDF_UNAVAILABLE_NOTE });
  assert.deepEqual(invoiceDocumentLinks({ invoiceId: null, rendering: true, demo: false }), { state: "unavailable", note: PDF_UNAVAILABLE_NOTE });
  assert.deepEqual(invoiceDocumentLinks({ invoiceId: "not-a-uuid", rendering: true, demo: false }), { state: "unavailable", note: PDF_UNAVAILABLE_NOTE });
  const demo = invoiceDocumentLinks({ invoiceId: id, rendering: true, demo: true });
  assert.equal(demo.state, "demo"); assert.equal((demo as { note: string }).note, PDF_DEMO_NOTE);
  const live = invoiceDocumentLinks({ invoiceId: id, rendering: true, demo: false });
  assert.deepEqual(live, { state: "available", open: `/api/platform-operations/finance/invoices/${id}/pdf?inline=1`, download: `/api/platform-operations/finance/invoices/${id}/pdf` });
  assert.ok(!("note" in live));
});
test("the capability constant is true in this checkpoint because the PDF route ships with it", () => {
  assert.equal(INVOICE_RENDERING_AVAILABLE, true);
});
