import type { Invoice } from "./types";
import { quoteReference } from "@/shared/order-reference";
/** Interface expected from ADV-DOCUMENTS-001 (branch claude/web-documents). No rendering happens in this lot. */
export type InvoiceDocumentInput = {
  kind: "invoice" | "credit_note"; number: string; issued_at: string; currency: "eur";
  issuer: { legal_name: string; siret: string; address: string; vat_number: string | null; legal_status?: string | null };
  recipient: { name: string; address: string; siret?: string | null; vat_number?: string | null; organization?: string | null };
  lines: { label: string; quantity: number; unit_price_cents: number }[];
  subtotal_cents: number; tax_rate: number; tax_cents: number; total_cents: number;
  related_number: string | null; reason: string; quote_reference: string; intervention_id: string;
};
export interface InvoiceDocumentRenderer { render(input: InvoiceDocumentInput): Promise<{ bytes: Uint8Array; mime: "application/pdf" }>; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullable(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
/** Maps a stored register row to the renderer input. Only data present in the row is carried; nothing is added. */
export function invoiceDocumentInput(row: Invoice, related: { number: string } | null): InvoiceDocumentInput {
  if (row.subtotal_cents + row.tax_cents !== row.total_cents) throw new Error("Montants de facture incohérents.");
  return {
    kind: row.kind, number: row.number, issued_at: row.issued_at, currency: row.currency,
    issuer: { legal_name: text(row.issuer.legal_name), siret: text(row.issuer.siret), address: text(row.issuer.address), vat_number: nullable(row.issuer.vat_number), legal_status: nullable(row.issuer.legal_status) },
    recipient: { name: text(row.recipient.name ?? row.recipient.legal_name), address: text(row.recipient.address), siret: nullable(row.recipient.siret), vat_number: nullable(row.recipient.vat_number), organization: nullable(row.recipient.organization) },
    lines: row.lines.map((line) => ({ label: line.label, quantity: line.quantity, unit_price_cents: line.unit_price_cents })),
    subtotal_cents: row.subtotal_cents, tax_rate: Number(row.tax_rate), tax_cents: row.tax_cents, total_cents: row.total_cents,
    related_number: related?.number ?? null, reason: row.reason, quote_reference: quoteReference(row.quote_id), intervention_id: row.intervention_id,
  };
}
