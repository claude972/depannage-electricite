// Private PDF links for the invoice register. Pure: the component renders plain links, never fetches.
export type InvoiceDocumentLinks =
  | { state: "unavailable"; note: string }
  | { state: "demo"; note: string; open: string; download: string }
  | { state: "available"; open: string; download: string };
export const PDF_UNAVAILABLE_NOTE = "Rendu PDF non disponible sur ce service.";
export const PDF_DEMO_NOTE = "Mode démonstration : document non ouvert.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function invoicePdfPath(invoiceId: string, inline: boolean): string {
  if (!UUID.test(invoiceId)) throw new Error("Identifiant de document invalide.");
  return `/api/platform-operations/finance/invoices/${invoiceId.toLowerCase()}/pdf${inline ? "?inline=1" : ""}`;
}
/** Links exist only for a stored document and only when the server advertises invoice_rendering; demo never navigates. */
export function invoiceDocumentLinks(input: { invoiceId: string | null | undefined; rendering: boolean | undefined; demo: boolean }): InvoiceDocumentLinks {
  if (!input.invoiceId || !UUID.test(input.invoiceId) || input.rendering !== true) return { state: "unavailable", note: PDF_UNAVAILABLE_NOTE };
  const open = invoicePdfPath(input.invoiceId, true), download = invoicePdfPath(input.invoiceId, false);
  return input.demo ? { state: "demo", note: PDF_DEMO_NOTE, open, download } : { state: "available", open, download };
}
