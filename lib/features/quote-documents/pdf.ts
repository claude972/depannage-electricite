// Renders a quote or amendment PDF from a parsed snapshot (migration 015). Everything printed
// comes from the snapshot: issuer fields of the artisan's dossier, server-computed amounts, the
// explicit validity state and the status at generation time. Nothing is defaulted or invented.
import { PdfDocument, type FontName, type PdfPage, textWidth, wrapText } from "./pdf-writer";
import type { QuoteDocumentSnapshot } from "./snapshot";
import {
  AMENDMENT_STATUS_LABELS,
  CATEGORY_LABELS,
  QUOTE_STATUS_LABELS,
  URGENCY_LABELS,
  formatDate,
  formatDateTimeUtc,
  formatEuro,
  formatTaxRate,
  issuerFieldLabels,
  validityLabel,
} from "./format";

export interface RenderMeta {
  revision: number;
  generated_at: string;
  snapshot_sha256: string;
}

const NAVY: [number, number, number] = [0.063, 0.165, 0.263];
const TEXT: [number, number, number] = [0.09, 0.17, 0.3];
const MUTED: [number, number, number] = [0.32, 0.38, 0.47];
const MARGIN = 48;
const FOOTER_HEIGHT = 40;

class Layout {
  page!: PdfPage;
  y = 0;
  readonly width: number;
  constructor(private readonly doc: PdfDocument, private readonly onNewPage: (page: PdfPage, index: number) => number) {
    this.width = doc.width - MARGIN * 2;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage();
    this.y = this.doc.height - MARGIN;
    this.y = this.onNewPage(this.page, this.doc.pages.length - 1);
  }
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_HEIGHT) this.newPage();
  }
  paragraph(text: string, options: { font?: FontName; size?: number; color?: [number, number, number]; x?: number; width?: number; gap?: number } = {}) {
    const size = options.size ?? 10;
    const lineHeight = size * 1.35;
    const lines = wrapText(text, options.font ?? "regular", size, options.width ?? this.width);
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.text(options.x ?? MARGIN, this.y - size, line, { font: options.font, size, color: options.color ?? TEXT });
      this.y -= lineHeight;
    }
    this.y -= options.gap ?? 0;
  }
  space(h: number) {
    this.y -= h;
  }
  rule() {
    this.ensure(8);
    this.page.line(MARGIN, this.y - 2, MARGIN + this.width, this.y - 2, 0.5, 0.75);
    this.y -= 8;
  }
}

function twoColumns(layout: Layout, left: { title: string; lines: { text: string; font?: FontName; color?: [number, number, number] }[] }, right: typeof left) {
  const colWidth = (layout.width - 16) / 2;
  const size = 9.5;
  const lineHeight = size * 1.35;
  const render = (col: typeof left, x: number) => {
    const rows: { text: string; font?: FontName; color?: [number, number, number] }[] = [{ text: col.title, font: "bold", color: NAVY }];
    for (const l of col.lines) for (const wrapped of wrapText(l.text, l.font ?? "regular", size, colWidth)) rows.push({ text: wrapped, font: l.font, color: l.color });
    return { x, rows };
  };
  const a = render(left, MARGIN);
  const b = render(right, MARGIN + colWidth + 16);
  const height = Math.max(a.rows.length, b.rows.length) * lineHeight;
  layout.ensure(height);
  for (const col of [a, b]) {
    let y = layout.y;
    for (const row of col.rows) {
      layout.page.text(col.x, y - size, row.text, { font: row.font, size, color: row.color ?? TEXT });
      y -= lineHeight;
    }
  }
  layout.y -= height + 10;
}

interface Part {
  lines: { label: string; quantity: number; unit_price_cents: number }[];
  subtotal_cents: number;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
}
function linesTable(layout: Layout, part: Part) {
  const size = 9.5;
  const lineHeight = size * 1.4;
  const colQty = 60;
  const colUnit = 90;
  const colAmount = 95;
  const colLabel = layout.width - colQty - colUnit - colAmount;
  const xLabel = MARGIN + 6;
  const xQty = MARGIN + colLabel + colQty - 6;
  const xUnit = xQty + colUnit;
  const xAmount = xUnit + colAmount;
  const header = () => {
    layout.ensure(lineHeight + 6);
    layout.page.rect(MARGIN, layout.y - lineHeight - 2, layout.width, lineHeight + 2, 0.93);
    const y = layout.y - size - 2;
    layout.page.text(xLabel, y, "Désignation", { font: "bold", size, color: NAVY });
    layout.page.textRight(xQty, y, "Qté", { font: "bold", size, color: NAVY });
    layout.page.textRight(xUnit, y, "PU HT", { font: "bold", size, color: NAVY });
    layout.page.textRight(xAmount, y, "Montant HT", { font: "bold", size, color: NAVY });
    layout.y -= lineHeight + 4;
  };
  header();
  for (const line of part.lines) {
    const wrapped = wrapText(line.label, "regular", size, colLabel - 12);
    const height = wrapped.length * lineHeight + 4;
    if (layout.y - height < MARGIN + FOOTER_HEIGHT) {
      layout.newPage();
      header();
    }
    const top = layout.y - size - 2;
    wrapped.forEach((text, i) => layout.page.text(xLabel, top - i * lineHeight, text, { size, color: TEXT }));
    layout.page.textRight(xQty, top, String(line.quantity), { size, color: TEXT });
    layout.page.textRight(xUnit, top, formatEuro(line.unit_price_cents), { size, color: TEXT });
    layout.page.textRight(xAmount, top, formatEuro(line.quantity * line.unit_price_cents), { size, color: TEXT });
    layout.y -= height;
    layout.page.line(MARGIN, layout.y, MARGIN + layout.width, layout.y, 0.3, 0.85);
  }
  layout.space(6);
  const totals: [string, string, FontName][] = [
    ["Sous-total HT", formatEuro(part.subtotal_cents), "regular"],
    [`TVA ${formatTaxRate(part.tax_rate)}`, formatEuro(part.tax_cents), "regular"],
    ["Total TTC", formatEuro(part.total_cents), "bold"],
  ];
  for (const [label, value, font] of totals) {
    layout.ensure(lineHeight);
    const y = layout.y - size;
    layout.page.textRight(xUnit, y, label, { font, size: font === "bold" ? 11 : size, color: font === "bold" ? NAVY : TEXT });
    layout.page.textRight(xAmount, y, value, { font, size: font === "bold" ? 11 : size, color: font === "bold" ? NAVY : TEXT });
    layout.y -= lineHeight;
  }
}

/** Builds the PDF bytes. Throws only on programming errors: the snapshot must already be parsed. */
export function renderQuoteDocumentPdf(snapshot: QuoteDocumentSnapshot, meta: RenderMeta): Uint8Array<ArrayBuffer> {
  const doc = new PdfDocument();
  const isAmendment = snapshot.kind === "amendment";
  const amendment = snapshot.amendment;
  const title = isAmendment && amendment ? `AVENANT N° ${amendment.version} AU DEVIS ${snapshot.quote.reference}` : "DEVIS";
  const generated = formatDateTimeUtc(meta.generated_at);
  const layout = new Layout(doc, (page, index) => {
    let y = doc.height - MARGIN;
    if (index === 0) {
      page.text(MARGIN, y - 18, title, { font: "bold", size: isAmendment ? 14 : 18, color: NAVY });
      page.textRight(doc.width - MARGIN, y - 12, snapshot.reference, { font: "bold", size: 12, color: NAVY });
      page.textRight(doc.width - MARGIN, y - 26, `Révision ${meta.revision} — généré le ${generated}`, { size: 8.5, color: MUTED });
      y -= 34;
      page.line(MARGIN, y, doc.width - MARGIN, y, 1, 0.08);
      y -= 14;
    } else {
      page.text(MARGIN, y - 10, `${title} — ${snapshot.reference} (suite)`, { font: "bold", size: 9.5, color: NAVY });
      y -= 22;
    }
    return y;
  });

  const issuer = snapshot.issuer;
  const issuerLines: { text: string; font?: FontName; color?: [number, number, number] }[] = [{ text: issuer.company_name, font: "bold" }];
  if (issuer.legal_status) issuerLines.push({ text: issuer.legal_status });
  issuerLines.push({ text: `SIRET ${issuer.siret}` });
  issuerLines.push({ text: issuer.address });
  issuerLines.push({ text: `Contact : ${issuer.contact_name}${issuer.phone ? ` — ${issuer.phone}` : ""}` });
  if (issuer.missing_optional.length)
    issuerLines.push({ text: `Non renseigné dans le dossier professionnel : ${issuerFieldLabels(issuer.missing_optional)}.`, color: MUTED });
  const recipient = snapshot.recipient;
  const recipientLines: typeof issuerLines = [];
  if (recipient.organization) recipientLines.push({ text: recipient.organization.name, font: "bold" });
  if (recipient.name) recipientLines.push({ text: recipient.name, font: recipient.organization ? "regular" : "bold" });
  if (recipient.site) recipientLines.push({ text: `Site : ${recipient.site.name} — ${recipient.site.address}` });
  const job = snapshot.intervention;
  recipientLines.push({ text: `Lieu d’intervention : ${job.address}, ${job.postal_code} ${job.city}` });
  recipientLines.push({ text: `Dossier ${job.reference} — ${CATEGORY_LABELS[job.category] ?? job.category}, ${URGENCY_LABELS[job.urgency] ?? job.urgency}` });
  twoColumns(layout, { title: "Émetteur", lines: issuerLines }, { title: "Destinataire", lines: recipientLines });

  if (job.description) {
    layout.paragraph("Objet", { font: "bold", size: 9.5, color: NAVY });
    layout.paragraph(job.description, { size: 9.5, gap: 8 });
  }

  const quote = snapshot.quote;
  if (!isAmendment) {
    const status = QUOTE_STATUS_LABELS[quote.status] ?? quote.status;
    const statusLine = quote.status === "accepted" && quote.accepted_at ? `${status} le ${formatDateTimeUtc(quote.accepted_at)}` : status;
    layout.paragraph(`Devis ${quote.reference} établi le ${formatDateTimeUtc(quote.created_at)} — état au moment de la génération : ${statusLine}.`, { size: 9.5 });
    layout.paragraph(`${validityLabel(quote.terms)} (état constaté à la génération).`, { size: 9.5, font: "bold", gap: 10 });
    linesTable(layout, quote);
  } else if (amendment) {
    const status = AMENDMENT_STATUS_LABELS[amendment.status];
    const statusLine = amendment.decided_at ? `${status} le ${formatDateTimeUtc(amendment.decided_at)}` : status;
    layout.paragraph(`Avenant proposé le ${formatDateTimeUtc(amendment.created_at)} — état au moment de la génération : ${statusLine}.`, { size: 9.5 });
    layout.paragraph(`${validityLabel(amendment.terms)} (état constaté à la génération).`, { size: 9.5, font: "bold" });
    layout.paragraph("Motif", { font: "bold", size: 9.5, color: NAVY });
    layout.paragraph(amendment.reason, { size: 9.5, gap: 4 });
    if (amendment.decision_note) layout.paragraph(`Commentaire de décision : ${amendment.decision_note}`, { size: 9.5, gap: 4 });
    layout.paragraph("Prestations supplémentaires de cet avenant", { font: "bold", size: 9.5, color: NAVY, gap: 2 });
    linesTable(layout, amendment);
    layout.space(8);
    const previous = amendment.cumulative_total_cents - amendment.total_cents - quote.total_cents;
    layout.paragraph(`Total TTC du devis accepté ${quote.reference}${quote.accepted_at ? ` le ${formatDateTimeUtc(quote.accepted_at)}` : ""} : ${formatEuro(quote.total_cents)}.`, { size: 9.5 });
    if (previous > 0) layout.paragraph(`Total TTC des avenants acceptés antérieurs : ${formatEuro(previous)}.`, { size: 9.5 });
    layout.paragraph(`Total cumulé TTC (devis + avenants acceptés + cet avenant) : ${formatEuro(amendment.cumulative_total_cents)}.`, { size: 10.5, font: "bold", color: NAVY, gap: 6 });
  }

  layout.space(10);
  layout.rule();
  for (const notice of snapshot.notices) layout.paragraph(notice, { size: 8.5, color: MUTED });
  if (isAmendment) layout.paragraph("Règlement : l’acceptation d’un avenant n’est pas reliée au paiement en ligne ; le montant réglé en ligne reste celui du devis accepté.", { size: 8.5, color: MUTED });
  layout.paragraph("Document généré par la plateforme à partir des données enregistrées ; aucune signature électronique certifiée n’y est apposée.", { size: 8.5, color: MUTED });

  const total = doc.pages.length;
  const footer = `${snapshot.reference} — révision ${meta.revision} — généré le ${generated} — empreinte ${meta.snapshot_sha256.slice(0, 12)}`;
  doc.pages.forEach((page, i) => {
    page.line(MARGIN, MARGIN + 18, doc.width - MARGIN, MARGIN + 18, 0.5, 0.75);
    page.text(MARGIN, MARGIN + 6, footer, { size: 7.5, color: MUTED });
    const label = `Page ${i + 1} / ${total}`;
    page.text(doc.width - MARGIN - textWidth(label, "regular", 7.5), MARGIN + 6, label, { size: 7.5, color: MUTED });
  });
  return doc.build({
    title: `${isAmendment ? "Avenant" : "Devis"} ${snapshot.reference} — révision ${meta.revision}`,
    subject: `${snapshot.issuer.company_name} — dossier ${job.reference}`,
    createdAt: meta.generated_at,
  });
}
