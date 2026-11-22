// ENT-16 — accounting export of ONE organisation: issued invoices / credit notes and recorded
// settlements, as stored (integer cents, nothing recomputed). Pure module (no I/O).
import { z } from "zod";
import { csvCell } from "../../domain";
import { orderReference, quoteReference } from "../../../shared/order-reference";

const uuid = z.uuid().transform((v) => v.toLowerCase());
const cents = z.number().int().min(0).max(2147483647);
const party = z.object({ legal_name: z.string().optional(), name: z.string().optional(), siret: z.string().nullable().optional(), vat_number: z.string().nullable().optional() }).loose();
export const exportInvoice = z
  .object({
    id: uuid, kind: z.enum(["invoice", "credit_note"]), basis: z.enum(["service", "platform_commission"]), number: z.string().min(1).max(40),
    issuer: party, recipient: party, payment_id: uuid, quote_id: uuid, intervention_id: uuid, related_invoice_id: uuid.nullable(),
    subtotal_cents: cents, tax_rate: z.union([z.number(), z.string()]).nullable(), tax_cents: cents, total_cents: cents.min(1), currency: z.literal("eur"), issued_at: z.string().min(10),
  })
  .loose()
  .refine((r) => r.subtotal_cents + r.tax_cents === r.total_cents && (r.kind === "invoice") === (r.related_invoice_id === null));
export type ExportInvoice = z.infer<typeof exportInvoice>;
export const exportSettlement = z.object({
  id: uuid, quote_id: uuid, intervention_id: uuid, site_name: z.string(), total_cents: cents, status: z.string().min(1).max(40), method: z.string().max(40).nullable(),
  paid_at: z.string().nullable(), created_at: z.string().min(10),
});
export type ExportSettlement = z.infer<typeof exportSettlement>;

export const EXPORT_COLUMNS = [
  "Type de ligne", "Numéro de document", "Date (UTC)", "Dossier", "Devis", "Site", "Émetteur", "SIRET émetteur", "Destinataire",
  "Montant HT EUR", "Taux de TVA %", "TVA EUR", "Montant TTC EUR", "Facture d’origine (avoir)", "Mode de règlement", "État du règlement", "Identifiant interne",
] as const;
const euros = (value: number) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export const SETTLEMENT_STATUS: Record<string, string> = { paid: "Réglé (confirmé par la plateforme)", pending: "En attente", failed: "Échoué" };
export const SETTLEMENT_METHOD: Record<string, string> = { stripe: "Paiement en ligne (carte)", on_site: "Règlement après intervention" };

export function invoiceLine(i: ExportInvoice, siteName: string, numbers: Map<string, string>): string {
  return [
    i.kind === "invoice" ? "Facture" : "Avoir", i.number, day(i.issued_at), orderReference(i.intervention_id), quoteReference(i.quote_id), siteName,
    i.issuer.legal_name ?? i.issuer.name ?? "", i.issuer.siret ?? "", i.recipient.name ?? i.recipient.legal_name ?? "",
    euros(i.subtotal_cents), i.tax_rate === null ? "" : String(i.tax_rate).replace(".", ","), euros(i.tax_cents), euros(i.total_cents),
    i.related_invoice_id ? numbers.get(i.related_invoice_id) ?? "" : "", "", "", i.id,
  ].map(csvCell).join(";");
}
export function settlementLine(p: ExportSettlement): string {
  return [
    "Règlement", "", day(p.paid_at ?? p.created_at), orderReference(p.intervention_id), quoteReference(p.quote_id), p.site_name, "", "", "",
    "", "", "", euros(p.total_cents), "", p.method ? SETTLEMENT_METHOD[p.method] ?? p.method : "", SETTLEMENT_STATUS[p.status] ?? p.status, p.id,
  ].map(csvCell).join(";");
}
/** UTF-8 with BOM, « ; » separator, CRLF: opens as is in a spreadsheet set to French. */
export function buildAccountingCsv(invoices: ExportInvoice[], settlements: ExportSettlement[], siteOf: Map<string, string>): string {
  const numbers = new Map(invoices.map((i) => [i.id, i.number]));
  const lines = [
    EXPORT_COLUMNS.map(csvCell).join(";"),
    ...invoices.map((i) => invoiceLine(i, siteOf.get(i.intervention_id) ?? "", numbers)),
    ...settlements.map(settlementLine),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
export function exportSummary(invoices: ExportInvoice[], settlements: ExportSettlement[]) {
  return {
    invoices: invoices.filter((i) => i.kind === "invoice").length,
    credit_notes: invoices.filter((i) => i.kind === "credit_note").length,
    settlements: settlements.length,
    settlements_paid: settlements.filter((s) => s.status === "paid").length,
  };
}
