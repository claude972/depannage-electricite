import type { LedgerEntry, LedgerKind } from "./types";
const MAX = 9007199254740991;
function cents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} doit être un entier de centimes positif.`);
  return value;
}
/** Same formula as the checkout: round(total × bps / 10000), half away from zero on positive integers. */
export function commissionCents(totalCents: number, bps: number): number {
  cents(totalCents, "Le montant");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("Le taux doit être compris entre 0 et 10000 points de base.");
  return Math.round((totalCents * bps) / 10000);
}
/** VAT extracted from a tax-inclusive amount (never added on top): tax = total − round(total / (1 + rate/100)). */
export function extractVat(totalCents: number, rate: number): { subtotal_cents: number; tax_cents: number; total_cents: number } {
  cents(totalCents, "Le montant");
  if (![0, 5.5, 10, 20].includes(rate)) throw new Error("Taux de TVA non pris en charge.");
  const tax = totalCents - Math.round(totalCents / (1 + rate / 100));
  return { subtotal_cents: totalCents - tax, tax_cents: tax, total_cents: totalCents };
}
/** Credit note VAT share, pro rata of the invoice: round(amount × tax / total). */
export function creditNoteSplit(amountCents: number, invoice: { tax_cents: number; total_cents: number }): { subtotal_cents: number; tax_cents: number; total_cents: number } {
  cents(amountCents, "Le montant");
  if (invoice.total_cents < 1 || amountCents > invoice.total_cents) throw new Error("L’avoir dépasse la facture.");
  const tax = Math.round((amountCents * invoice.tax_cents) / invoice.total_cents);
  return { subtotal_cents: amountCents - tax, tax_cents: tax, total_cents: amountCents };
}
export function remainingCreditable(invoice: { total_cents: number }, creditNotes: { total_cents: number }[]): number {
  const credited = creditNotes.reduce((sum, note) => sum + cents(note.total_cents, "L’avoir"), 0);
  return Math.max(0, invoice.total_cents - credited);
}
export type PaymentFacts = { id: string; status: "pending" | "paid" | "failed"; total_cents: number; currency: string };
export type ReconciliationDiff = { ok: string[]; missing: string[]; mismatched: { payment_id: string; expected_cents: number; ledger_cents: number }[]; orphan: string[] };
/** Pure diff between settled payments and settlement entries; counts are exact, nothing is inferred. */
export function reconcile(payments: PaymentFacts[], entries: Pick<LedgerEntry, "payment_id" | "entry_kind" | "amount_cents" | "currency">[]): ReconciliationDiff {
  const settled = new Map<string, Pick<LedgerEntry, "amount_cents" | "currency">>();
  for (const entry of entries) if (entry.entry_kind === "payment_settled") settled.set(entry.payment_id, entry);
  const diff: ReconciliationDiff = { ok: [], missing: [], mismatched: [], orphan: [] };
  const paid = new Set<string>();
  for (const payment of payments) {
    if (payment.status !== "paid") continue;
    paid.add(payment.id);
    const entry = settled.get(payment.id);
    if (!entry) diff.missing.push(payment.id);
    else if (entry.amount_cents !== payment.total_cents || entry.currency !== payment.currency) diff.mismatched.push({ payment_id: payment.id, expected_cents: payment.total_cents, ledger_cents: entry.amount_cents });
    else diff.ok.push(payment.id);
  }
  for (const id of settled.keys()) if (!paid.has(id)) diff.orphan.push(id);
  return diff;
}
export type PaymentNet = { gross_cents: number; commission_estimated_cents: number | null; commission_withheld_cents: number | null; refunded_cents: number; net_to_artisan_cents: number | null; basis: "withheld" | "estimated" | "none" };
/** Net to the artisan for one payment. Only a withheld commission yields a confirmed net; an estimate is labelled as such. */
export function paymentNet(entries: Pick<LedgerEntry, "entry_kind" | "direction" | "amount_cents">[]): PaymentNet {
  const sum = (kind: LedgerKind) => entries.filter((e) => e.entry_kind === kind).reduce((total, e) => { const next = total + cents(e.amount_cents, "L’écriture"); if (next > MAX) throw new Error("Montant hors limites."); return next; }, 0);
  const has = (kind: LedgerKind) => entries.some((e) => e.entry_kind === kind);
  const gross = sum("payment_settled"), refunded = sum("refund_settled");
  const withheld = has("commission_withheld") ? sum("commission_withheld") : null;
  const estimated = has("commission_estimated") ? sum("commission_estimated") : null;
  const basis = withheld !== null ? "withheld" : estimated !== null ? "estimated" : "none";
  const commission = withheld ?? estimated;
  return { gross_cents: gross, commission_estimated_cents: estimated, commission_withheld_cents: withheld, refunded_cents: refunded, net_to_artisan_cents: commission === null ? null : gross - commission - refunded, basis };
}
/** Amount still requestable: settled total minus requests that are requested, approved or settled. */
export function refundableCents(payment: { total_cents: number }, requests: { status: string; amount_cents: number }[]): number {
  const committed = requests.filter((r) => ["requested", "approved", "settled"].includes(r.status)).reduce((sum, r) => sum + cents(r.amount_cents, "La demande"), 0);
  return Math.max(0, cents(payment.total_cents, "Le paiement") - committed);
}
