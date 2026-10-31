// CODEX-INVOICE-PDF-001: renders only the immutable invoice register snapshot.
// Reuses the canonical document writer; no live issuer/payment lookup or invented legal text.
import { z } from "zod";
import { PdfDocument, wrapText, textWidth, type PdfPage, type FontName } from "../quote-documents/pdf-writer";
import { formatEuro, formatTaxRate, formatDateTimeUtc } from "../quote-documents/format";
import type { InvoiceDocumentInput } from "./invoice-document";

export type InvoicePdfInput = InvoiceDocumentInput & { basis: "service" | "platform_commission" };
export class InvoicePdfError extends Error {}

const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000]*$/);
const optionalText = (max: number) => z.string().max(max).regex(/^[^\u0000]*$/).nullable().optional();
const cents = z.number().int().min(0).max(2_147_483_647);
const inputSchema = z.object({
  kind: z.enum(["invoice", "credit_note"]), basis: z.enum(["service", "platform_commission"]),
  number: text(80), issued_at: z.iso.datetime({ offset: true }), currency: z.literal("eur"),
  issuer: z.object({ legal_name: text(160), siret: z.string().regex(/^[0-9]{14}$/), address: text(500), vat_number: optionalText(80).default(null), legal_status: optionalText(80) }),
  recipient: z.object({ name: text(160), address: text(500), siret: optionalText(14), vat_number: optionalText(80), organization: optionalText(160) }),
  lines: z.array(z.object({ label: text(160), quantity: z.number().int().min(1).max(1000), unit_price_cents: cents })).min(1).max(30),
  subtotal_cents: cents, tax_rate: z.union([z.literal(0), z.literal(5.5), z.literal(10), z.literal(20)]),
  tax_cents: cents, total_cents: cents.min(1), related_number: text(80).nullable(), reason: z.string().max(1000),
  quote_reference: text(80), intervention_id: z.string().uuid(),
});

/** Refuses an inconsistent snapshot instead of silently correcting its stored financial amounts. */
export function parseInvoicePdfInput(value: unknown): InvoicePdfInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new InvoicePdfError("Instantané de facture incomplet ou invalide.");
  const input = parsed.data;
  const subtotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal !== input.subtotal_cents || subtotal + input.tax_cents !== input.total_cents)
    throw new InvoicePdfError("Montants de facture incohérents.");
  if (input.kind === "invoice") {
    if (input.related_number !== null) throw new InvoicePdfError("Une facture ne peut pas être un avoir.");
    // 014: service VAT is added to HT; a confirmed commission is already TTC (VAT extracted).
    const tax = input.basis === "service"
      ? Math.round(input.subtotal_cents * input.tax_rate / 100)
      : input.total_cents - Math.round(input.total_cents * 1000 / (1000 + input.tax_rate * 10));
    if (tax !== input.tax_cents) throw new InvoicePdfError("TVA de facture incohérente.");
  } else if (!input.related_number || input.reason.trim().length < 1) {
    throw new InvoicePdfError("La facture liée et le motif de l’avoir sont nécessaires.");
  }
  // Credit-note VAT is the cumulative allocation recorded by 014, not a new per-note rounding.
  if (input.tax_rate === 0 && input.tax_cents !== 0) throw new InvoicePdfError("TVA de facture incohérente.");
  return input;
}

export function invoicePdfFileName(input: { kind: string; number: string }): string {
  const number = input.number.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  return `${input.kind === "credit_note" ? "avoir" : "facture"}-${number}.pdf`;
}

const MARGIN = 48;
const BOTTOM = 82;
const NAVY: [number, number, number] = [0.063, 0.165, 0.263];
const TEXT: [number, number, number] = [0.09, 0.17, 0.3];
const MUTED: [number, number, number] = [0.32, 0.38, 0.47];

class InvoiceLayout {
  page!: PdfPage;
  y = 0;
  readonly width: number;
  constructor(readonly document: PdfDocument, readonly input: InvoicePdfInput) {
    this.width = document.width - MARGIN * 2;
    this.newPage();
  }
  newPage() {
    this.page = this.document.addPage();
    this.y = this.document.height - MARGIN;
    const title = this.input.kind === "credit_note" ? "AVOIR" : "FACTURE";
    this.page.text(MARGIN, this.y - 18, title, { font: "bold", size: 18, color: NAVY });
    this.y -= 32;
    for (const line of wrapText(`${this.input.number}${this.document.pages.length > 1 ? " (suite)" : ""}`, "bold", 11, this.width)) {
      this.page.text(MARGIN, this.y - 11, line, { font: "bold", size: 11, color: NAVY });
      this.y -= 15;
    }
    this.page.line(MARGIN, this.y - 3, MARGIN + this.width, this.y - 3, 1, 0.3);
    this.y -= 19;
  }
  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }
  paragraph(value: string, options: { size?: number; font?: FontName; color?: [number, number, number]; gap?: number } = {}) {
    const size = options.size ?? 10;
    const lineHeight = size * 1.4;
    for (const line of wrapText(value, options.font ?? "regular", size, this.width)) {
      this.ensure(lineHeight);
      this.page.text(MARGIN, this.y - size, line, { size, font: options.font, color: options.color ?? TEXT });
      this.y -= lineHeight;
    }
    this.y -= options.gap ?? 0;
  }
}

function parties(layout: InvoiceLayout) {
  const input = layout.input;
  const columns = [
    ["Émetteur", input.issuer.legal_name, input.issuer.legal_status, `SIRET : ${input.issuer.siret}`, input.issuer.address,
      `TVA intracommunautaire : ${input.issuer.vat_number || "non renseignée"}`],
    ["Destinataire", input.recipient.name, input.recipient.organization, input.recipient.address,
      input.recipient.siret ? `SIRET : ${input.recipient.siret}` : null,
      input.recipient.vat_number ? `TVA intracommunautaire : ${input.recipient.vat_number}` : null],
  ];
  const width = (layout.width - 24) / 2;
  const rows = columns.map((column) => column.flatMap((value, index) => value ? wrapText(value, index < 2 ? "bold" : "regular", 9.5, width).map((line) => ({ line, bold: index < 2 })) : []));
  for (let index = 0; index < Math.max(...rows.map((r) => r.length)); index++) {
    layout.ensure(14);
    rows.forEach((column, col) => {
      const row = column[index];
      if (row) layout.page.text(MARGIN + col * (width + 24), layout.y - 9.5, row.line, { size: 9.5, font: row.bold ? "bold" : "regular", color: TEXT });
    });
    layout.y -= 14;
  }
  layout.y -= 16;
}

function lineTable(layout: InvoiceLayout) {
  const labelWidth = layout.width - 250;
  const qtyRight = MARGIN + labelWidth + 45;
  const unitRight = MARGIN + labelWidth + 145;
  const totalRight = MARGIN + layout.width - 6;
  const header = () => {
    layout.ensure(24);
    layout.page.rect(MARGIN, layout.y - 21, layout.width, 21, 0.94);
    layout.page.text(MARGIN + 6, layout.y - 14, "Prestation", { size: 9, font: "bold", color: NAVY });
    layout.page.textRight(qtyRight, layout.y - 14, "Qté", { size: 9, font: "bold", color: NAVY });
    layout.page.textRight(unitRight, layout.y - 14, "Prix unitaire HT", { size: 9, font: "bold", color: NAVY });
    layout.page.textRight(totalRight, layout.y - 14, "Montant HT", { size: 9, font: "bold", color: NAVY });
    layout.y -= 27;
  };
  header();
  for (const item of layout.input.lines) {
    const wrapped = wrapText(item.label, "regular", 9.5, labelWidth - 12);
    const height = wrapped.length * 13.5 + 10;
    if (layout.y - height < BOTTOM) { layout.newPage(); header(); }
    wrapped.forEach((line, index) => layout.page.text(MARGIN + 6, layout.y - 10 - index * 13.5, line, { size: 9.5, color: TEXT }));
    layout.page.textRight(qtyRight, layout.y - 10, String(item.quantity), { size: 9.5, color: TEXT });
    layout.page.textRight(unitRight, layout.y - 10, formatEuro(item.unit_price_cents), { size: 9.5, color: TEXT });
    layout.page.textRight(totalRight, layout.y - 10, formatEuro(item.quantity * item.unit_price_cents), { size: 9.5, color: TEXT });
    layout.y -= height;
    layout.page.line(MARGIN, layout.y + 3, MARGIN + layout.width, layout.y + 3, 0.3, 0.85);
  }
  layout.y -= 10;
  layout.ensure(85);
  const input = layout.input;
  const totals: [string, number, boolean][] = [
    ["Total HT", input.subtotal_cents, false],
    [`TVA ${formatTaxRate(input.tax_rate)} (montant enregistré)`, input.tax_cents, false],
    [input.kind === "credit_note" ? "Total TTC à déduire" : "Total TTC", input.total_cents, true],
  ];
  for (const [label, amount, bold] of totals) {
    if (bold) layout.page.rect(MARGIN, layout.y - 23, layout.width, 25, 0.94);
    layout.page.text(MARGIN + 8, layout.y - 14, label, { size: bold ? 11 : 10, font: bold ? "bold" : "regular", color: NAVY });
    layout.page.textRight(totalRight, layout.y - 14, formatEuro(amount), { size: bold ? 11 : 10, font: bold ? "bold" : "regular", color: TEXT });
    layout.y -= 26;
  }
}

export function renderInvoicePdf(value: InvoicePdfInput): Uint8Array<ArrayBuffer> {
  const input = parseInvoicePdfInput(value);
  const document = new PdfDocument();
  const layout = new InvoiceLayout(document, input);
  layout.paragraph(`Émis le ${formatDateTimeUtc(input.issued_at)}`, { size: 9.5, color: MUTED, gap: 13 });
  parties(layout);
  layout.paragraph(`Devis : ${input.quote_reference}`, { size: 9.5 });
  layout.paragraph(`Dossier : INT-${input.intervention_id.slice(0, 8).toUpperCase()}`, { size: 9, color: MUTED, gap: 12 });
  if (input.kind === "credit_note") {
    layout.paragraph(`Avoir lié à la facture ${input.related_number}`, { font: "bold", color: NAVY, gap: 5 });
    layout.paragraph(`Motif : ${input.reason}`, { size: 9.5, gap: 12 });
  }
  lineTable(layout);
  layout.y -= 12;
  layout.paragraph(input.kind === "credit_note"
    ? "Cet avoir constate un montant à déduire de la facture liée. Son émission ne confirme pas l’exécution d’un remboursement."
    : "Document établi à partir des données figées lors de son émission. Aucun état de règlement supplémentaire n’est déduit par ce document.",
  { size: 8.5, color: MUTED, gap: 5 });
  if (input.kind === "credit_note") layout.paragraph("La TVA affichée est celle enregistrée dans le registre des avoirs, avec allocation cumulative des arrondis.", { size: 8.5, color: MUTED });
  const totalPages = document.pages.length;
  document.pages.forEach((page, index) => {
    page.line(MARGIN, 64, document.width - MARGIN, 64, 0.5, 0.75);
    const footer = `${input.kind === "credit_note" ? "Avoir" : "Facture"} ${input.number}`;
    const rows = wrapText(footer, "regular", 7.5, layout.width - 95);
    rows.slice(0, 2).forEach((line, row) => page.text(MARGIN, 52 - row * 10, line, { size: 7.5, color: MUTED }));
    const label = `Page ${index + 1} / ${totalPages}`;
    page.text(document.width - MARGIN - textWidth(label, "regular", 7.5), 52, label, { size: 7.5, color: MUTED });
  });
  return document.build({ title: `${input.kind === "credit_note" ? "Avoir" : "Facture"} ${input.number}`, subject: input.issuer.legal_name, createdAt: input.issued_at });
}
