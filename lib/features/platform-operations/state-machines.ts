import type { DisputeOutcome, DisputeStatus, InvoiceReadiness, ModerationState, RefundStatus } from "./types";

/** Readiness check bound to its exact target: a result for another payment/basis/scope is discarded, any input change resets. */
export type ReadinessTarget = { payment_id: string; basis: "service" | "platform_commission"; scope_key: string };
export type ReadinessModel = { current: string; pending: string | null; target: ReadinessTarget | null; readiness: InvoiceReadiness | null };
export type ReadinessAction =
  | { type: "input"; target: ReadinessTarget }
  | { type: "check"; target: ReadinessTarget }
  | { type: "result"; fingerprint: string; readiness: InvoiceReadiness }
  | { type: "fail"; fingerprint: string };
export function readinessFingerprint(target: ReadinessTarget): string { return `${target.scope_key}|${target.basis}|${target.payment_id.trim().toLowerCase()}`; }
export const EMPTY_READINESS: ReadinessModel = { current: "", pending: null, target: null, readiness: null };
export function readinessReduce(model: ReadinessModel, action: ReadinessAction): ReadinessModel {
  switch (action.type) {
    case "input": { const fp = readinessFingerprint(action.target); return fp === model.current ? model : { current: fp, pending: null, target: null, readiness: null }; }
    case "check": { const fp = readinessFingerprint(action.target); return { current: fp, pending: fp, target: action.target, readiness: null }; }
    case "result": return action.fingerprint === model.current && action.fingerprint === model.pending ? { ...model, pending: null, readiness: action.readiness } : model;
    case "fail": return action.fingerprint === model.pending ? { ...model, pending: null } : model;
  }
}
export type RefundAction = "approve" | "reject" | "cancel";
export type DisputeAction = "review" | "resolve" | "close";
/** Mirrors platform_decide_refund: settled is reachable only by the service function with a provider event. */
export const REFUND_TRANSITIONS: Record<RefundStatus, Partial<Record<RefundAction, RefundStatus>>> = {
  requested: { approve: "approved", reject: "rejected", cancel: "cancelled" },
  approved: { cancel: "cancelled" },
  rejected: {}, cancelled: {}, settled: {},
};
export function refundActions(status: RefundStatus): RefundAction[] { return Object.keys(REFUND_TRANSITIONS[status]) as RefundAction[]; }
export function nextRefundStatus(status: RefundStatus, action: RefundAction): RefundStatus | null { return REFUND_TRANSITIONS[status][action] ?? null; }
/** A request is never a completed refund; this is the only wording the UI may use. */
export function refundStatusLabel(status: RefundStatus): string {
  return { requested: "Demandée — aucun remboursement effectué", approved: "Approuvée — exécution non réalisée", rejected: "Rejetée", cancelled: "Annulée", settled: "Remboursement confirmé par le fournisseur" }[status];
}
export const DISPUTE_TRANSITIONS: Record<DisputeStatus, Partial<Record<DisputeAction, DisputeStatus>>> = {
  open: { review: "under_review", close: "closed" },
  under_review: { resolve: "resolved", close: "closed" },
  resolved: {}, closed: {},
};
export function disputeActions(status: DisputeStatus): DisputeAction[] { return Object.keys(DISPUTE_TRANSITIONS[status]) as DisputeAction[]; }
export function nextDisputeStatus(status: DisputeStatus, action: DisputeAction): DisputeStatus | null { return DISPUTE_TRANSITIONS[status][action] ?? null; }
export function validateDisputeDecision(input: { action: DisputeAction; note: string; outcome?: DisputeOutcome | null; refund_request_id?: string | null }): string | null {
  const note = input.note.trim();
  if (note.length > 2000) return "La note dépasse 2000 caractères.";
  if (input.action === "resolve") {
    if (!input.outcome || input.outcome === "none") return "Choisissez une issue pour résoudre le litige.";
    if (note.length < 10) return "Une note d’au moins 10 caractères est requise pour résoudre.";
    if (input.outcome === "refund_requested" && !input.refund_request_id) return "Indiquez la demande de remboursement liée.";
    if (input.outcome !== "refund_requested" && input.refund_request_id) return "Une demande de remboursement ne se lie qu’à l’issue « remboursement demandé ».";
  } else if (input.outcome || input.refund_request_id) return "L’issue ne se renseigne qu’à la résolution.";
  return null;
}
export function validateRefundDecision(input: { action: RefundAction; note: string }): string | null {
  const note = input.note.trim();
  if (note.length > 1000) return "La note dépasse 1000 caractères.";
  if (input.action === "reject" && note.length < 10) return "Un motif d’au moins 10 caractères est requis pour rejeter.";
  return null;
}
export function moderationAction(state: ModerationState | null): "hide" | "restore" { return state === "hidden" ? "restore" : "hide"; }
export function validateModeration(input: { action: "hide" | "restore"; note: string }): string | null {
  const note = input.note.trim();
  if (note.length > 1000) return "La note dépasse 1000 caractères.";
  if (input.action === "hide" && note.length < 10) return "Un motif d’au moins 10 caractères est requis pour masquer.";
  return null;
}
export function validateText(value: string, min: number, max: number, label: string): string | null {
  const text = value.trim();
  if (text.length < min) return `${label} : au moins ${min} caractères.`;
  if (text.length > max) return `${label} : au plus ${max} caractères.`;
  if (/\u0000/.test(text)) return `${label} : caractères non autorisés.`;
  return null;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateAmountCents(value: string | number, max: number): { cents: number } | { error: string } {
  const text = String(value).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: "Saisissez un montant en euros, deux décimales au plus." };
  const cents = Math.round(Number(text) * 100);
  if (cents < 1) return { error: "Le montant doit être supérieur à zéro." };
  if (cents > max) return { error: "Le montant dépasse ce qui reste disponible." };
  return { cents };
}
