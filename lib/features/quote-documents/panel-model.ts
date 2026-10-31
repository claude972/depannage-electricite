// Pure state and validation of the QuoteDocumentsPanel leaf: everything the component decides
// lives here so it can be tested without a DOM. Rules of WEB-SHARED-001: a `null` command result
// is a stale chain (no notice, no update); write controls need canWrite AND the server permission.
import { formatEuro, formatTaxRate } from "./format";
import type { QuoteDocumentsCommandResult, QuoteDocumentsFailure, QuoteDocumentsOverview, QuoteDocumentsScope, QuoteDocumentsTarget, QuoteLine } from "./types";
import { validateValidUntil } from "./validity";

export type Phase = "idle" | "loading" | "ready" | "error";
export interface PanelState {
  key: string;
  phase: Phase;
  overview: QuoteDocumentsOverview | null;
  loadError: QuoteDocumentsFailure | null;
  /** Command in flight (its action), guarding against double submission. */
  pending: string | null;
  notice: string | null;
  commandError: QuoteDocumentsFailure | null;
  /** 409: the dossier changed since display; the user reloads explicitly. */
  conflict: QuoteDocumentsFailure | null;
  /** Issuer configuration error (code issuer_incomplete): fields listed by the server. */
  issuerMissing: string[] | null;
}
export type PanelEvent =
  | { type: "reset"; key: string }
  | { type: "load" }
  | { type: "loaded"; overview: QuoteDocumentsOverview }
  | { type: "load_failed"; failure: QuoteDocumentsFailure }
  | { type: "command"; action: string }
  | { type: "command_done"; result: QuoteDocumentsCommandResult }
  | { type: "command_failed"; failure: QuoteDocumentsFailure }
  | { type: "stale" }
  | { type: "dismiss" };

export function initialPanelState(key: string): PanelState {
  return { key, phase: "idle", overview: null, loadError: null, pending: null, notice: null, commandError: null, conflict: null, issuerMissing: null };
}
export function scopeKey(scope: QuoteDocumentsScope, target: QuoteDocumentsTarget): string {
  const targetKey = "interventionId" in target ? `i:${target.interventionId}` : `q:${target.quoteId}`;
  return [scope.userId, scope.organizationId ?? "", scope.siteId ?? "", targetKey].join("|");
}
export function successMessage(result: QuoteDocumentsCommandResult): string {
  switch (result.action) {
    case "set_terms":
      return result.terms.valid_until ? "Validité du devis enregistrée." : "Validité du devis retirée : elle est désormais indiquée comme non renseignée.";
    case "generate":
      return result.created ? `Document ${result.document.reference} généré (révision ${result.document.revision}).` : `Le document ${result.document.reference} était déjà à jour : aucune nouvelle révision n’était nécessaire.`;
    case "propose":
      return `Avenant n° ${result.amendment.version} proposé. Il doit être accepté explicitement pour s’appliquer.`;
    case "withdraw":
      return "Avenant retiré.";
    case "accept":
      return "Avenant accepté. Le règlement en ligne reste celui du devis accepté.";
    case "reject":
      return "Avenant refusé.";
  }
}
export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  switch (event.type) {
    case "reset":
      return initialPanelState(event.key);
    case "load":
      return { ...state, phase: "loading", loadError: null, conflict: null };
    case "loaded":
      return { ...state, phase: "ready", overview: event.overview, loadError: null, conflict: null };
    case "load_failed":
      return { ...state, phase: "error", loadError: event.failure };
    case "command":
      return state.pending ? state : { ...state, pending: event.action, notice: null, commandError: null, conflict: null, issuerMissing: null };
    case "command_done":
      return { ...state, pending: null, notice: successMessage(event.result), commandError: null, conflict: null, issuerMissing: null };
    case "command_failed": {
      const failure = event.failure;
      if (failure.code === "issuer_incomplete") return { ...state, pending: null, issuerMissing: failure.missing ?? [], commandError: null };
      if (failure.status === 409) return { ...state, pending: null, conflict: failure, commandError: null };
      return { ...state, pending: null, commandError: failure };
    }
    case "stale":
      // Identity changed or logged out meanwhile: nothing is shown, nothing is updated.
      return { ...state, pending: null };
    case "dismiss":
      return { ...state, notice: null, commandError: null };
  }
}

/** A write control is shown only when the lead's authority allows writing AND the server permits it. */
export function canWrite(scope: QuoteDocumentsScope, permission: boolean | undefined): boolean {
  return scope.authority.canWrite && permission === true;
}
export function readOnlyReason(scope: QuoteDocumentsScope): string {
  return scope.authority.reason || "Votre accès à ce dossier est en lecture seule.";
}

// --- Amendment form -------------------------------------------------------------------------
export interface LineInput {
  label: string;
  quantity: string;
  price: string;
}
export interface AmendmentFormInput {
  lines: LineInput[];
  taxRate: string;
  reason: string;
  validUntil: string;
}
export interface LineInputErrors {
  label?: string;
  quantity?: string;
  price?: string;
}
export interface AmendmentFormErrors {
  lines: LineInputErrors[];
  taxRate?: string;
  reason?: string;
  validUntil?: string;
  form?: string;
}
export const TAX_RATES = ["0", "5.5", "10", "20"] as const;
export const MAX_LINES = 30;
export const emptyLine = (): LineInput => ({ label: "", quantity: "1", price: "" });

export function parseQuantity(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : null;
}
export function parsePrice(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents >= 0 && cents <= 10_000_000 ? cents : null;
}
export function lineInputErrors(line: LineInput): LineInputErrors {
  const errors: LineInputErrors = {};
  if (!line.label.trim()) errors.label = "Indiquez la prestation.";
  else if (line.label.length > 160) errors.label = "160 caractères maximum.";
  if (parseQuantity(line.quantity) === null) errors.quantity = "Entier de 1 à 1 000.";
  if (parsePrice(line.price) === null) errors.price = "Montant de 0 à 100 000 € HT.";
  return errors;
}
export function validateAmendmentForm(input: AmendmentFormInput, now: Date = new Date()):
  | { ok: true; value: { lines: QuoteLine[]; tax_rate: 0 | 5.5 | 10 | 20; reason: string; valid_until: string | null } }
  | { ok: false; errors: AmendmentFormErrors } {
  const errors: AmendmentFormErrors = { lines: input.lines.map(lineInputErrors) };
  let failed = errors.lines.some((e) => Object.keys(e).length > 0);
  if (!input.lines.length) {
    errors.form = "Ajoutez au moins une prestation.";
    failed = true;
  } else if (input.lines.length > MAX_LINES) {
    errors.form = `${MAX_LINES} prestations maximum.`;
    failed = true;
  }
  if (!(TAX_RATES as readonly string[]).includes(input.taxRate)) {
    errors.taxRate = "Choisissez un taux de TVA.";
    failed = true;
  }
  const reason = input.reason.trim();
  if (!reason) {
    errors.reason = "Expliquez ce qui motive cet avenant.";
    failed = true;
  } else if (reason.length > 2000) {
    errors.reason = "2 000 caractères maximum.";
    failed = true;
  }
  const validity = validateValidUntil(input.validUntil, now);
  if (!validity.ok) {
    errors.validUntil = validity.message;
    failed = true;
  }
  if (failed || !validity.ok) return { ok: false, errors };
  const lines = input.lines.map((l) => ({ label: l.label.trim(), quantity: parseQuantity(l.quantity)!, unit_price_cents: parsePrice(l.price)! }));
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
  const taxRate = Number(input.taxRate) as 0 | 5.5 | 10 | 20;
  if (subtotal < 1) return { ok: false, errors: { ...errors, form: "Le montant de l’avenant doit être supérieur à zéro." } };
  if (subtotal + Math.round((subtotal * taxRate) / 100) > 10_000_000) return { ok: false, errors: { ...errors, form: "Le montant de l’avenant dépasse la limite autorisée." } };
  return { ok: true, value: { lines, tax_rate: taxRate, reason, valid_until: validity.value } };
}
/** Indicative preview typed in the form; the server recomputes and its totals are the only truth. */
export function previewTotals(input: AmendmentFormInput): { subtotal: string; tax: string; total: string; taxLabel: string } | null {
  const lines = input.lines.map((l) => ({ quantity: parseQuantity(l.quantity), price: parsePrice(l.price) }));
  if (!lines.length || lines.some((l) => l.quantity === null || l.price === null) || !(TAX_RATES as readonly string[]).includes(input.taxRate)) return null;
  const subtotal = lines.reduce((s, l) => s + l.quantity! * l.price!, 0);
  const rate = Number(input.taxRate);
  const tax = Math.round((subtotal * rate) / 100);
  return { subtotal: formatEuro(subtotal), tax: formatEuro(tax), total: formatEuro(subtotal + tax), taxLabel: formatTaxRate(rate) };
}
