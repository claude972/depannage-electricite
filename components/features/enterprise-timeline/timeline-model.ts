// Enterprise dossier chronology — pure derivation (no React, no loading). Built ONLY from facts the
// dossier view already holds: the intervention's real status and stored dates, the approval of the
// dossier's quote (professional.approvals), the site's approval rule, the appointment / report of
// the operations read, and the payment of the accepted quote. A date is shown only when stored.

export type StepKey = "request" | "approval" | "planning" | "works" | "reception" | "payment";
export type StepState = "done" | "current" | "upcoming" | "not_applicable";
export type TimelineStep = { key: StepKey; label: string; state: StepState; detail: string; date: string | null };
export type TimelineStatus = "requested" | "assigned" | "quoted" | "accepted" | "in_progress" | "completed" | "paid" | "cancelled";

export type TimelineInput = {
  intervention: { status: TimelineStatus | string; created_at: string; completed_at?: string | null; paid_at?: string | null };
  /** Approval attached to the dossier's quote (accepted one first), if any. */
  approval?: { status: string; decided_at?: string | null; created_at?: string } | null;
  /** An enabled approval rule exists for the dossier's site. */
  ruleApplies: boolean;
  /** undefined = operations not loaded yet; null = none stored. */
  appointment?: { starts_at: string } | null;
  report?: { updated_at?: string } | null;
  payment?: { status: string; paid_at?: string | null } | null;
};

const RANK: Record<string, number> = { requested: 0, assigned: 1, quoted: 2, accepted: 3, in_progress: 4, completed: 5, paid: 6 };
export const STEP_LABEL: Record<StepKey, string> = {
  request: "Demande",
  approval: "Approbation",
  planning: "Planification",
  works: "Travaux",
  reception: "Réception",
  payment: "Règlement",
};
export const STATE_LABEL: Record<StepState, string> = { done: "Terminé", current: "En cours", upcoming: "À venir", not_applicable: "Non applicable" };
const stored = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Date.parse(v)) ? v : null);

export function buildTimeline(input: TimelineInput): TimelineStep[] {
  const { intervention: i, approval, ruleApplies, appointment, report, payment } = input;
  const step = (key: StepKey, state: StepState, detail: string, date: string | null = null): TimelineStep => ({ key, label: STEP_LABEL[key], state, detail, date });

  if (i.status === "cancelled") {
    const na = (key: StepKey) => step(key, "not_applicable", "Dossier annulé : étape non réalisée.");
    return [step("request", "done", "Demande enregistrée, puis annulée.", stored(i.created_at)), na("approval"), na("planning"), na("works"), na("reception"), na("payment")];
  }
  const rank = RANK[i.status] ?? 0;
  const approvalPending = approval?.status === "pending";
  const approvalRejected = approval?.status === "rejected";

  // Demande: current until the quote is accepted, unless the approval is the step being waited on.
  const requestDetail =
    i.status === "requested" ? "En attente d’attribution à un artisan." : i.status === "assigned" ? "Artisan attribué, devis attendu." : i.status === "quoted" ? "Devis reçu, décision attendue." : "Demande traitée.";
  const request = step("request", rank >= RANK.accepted || approvalPending || approvalRejected ? "done" : "current", requestDetail, stored(i.created_at));

  // Approbation: only when an approval exists or a site rule applies; otherwise honestly n/a.
  let approvalStep: TimelineStep;
  if (approval && approval.status === "approved") approvalStep = step("approval", "done", "Devis approuvé par votre organisation.", stored(approval.decided_at));
  else if (approvalPending) approvalStep = step("approval", "current", "Approbation du devis en attente de décision.", null);
  else if (approvalRejected) approvalStep = step("approval", rank >= RANK.accepted ? "done" : "current", "Devis refusé par l’approbateur : il ne peut pas être accepté.", stored(approval?.decided_at));
  else if (!ruleApplies) approvalStep = step("approval", "not_applicable", "Aucune règle d’approbation sur ce site : non applicable.");
  else if (rank >= RANK.quoted) approvalStep = step("approval", "not_applicable", "Aucune approbation demandée pour ce devis.");
  else approvalStep = step("approval", "upcoming", "Requise si le devis dépasse le seuil de ce site.");

  // Planification: the stored appointment of the operations read.
  let planning: TimelineStep;
  const slot = appointment ? stored(appointment.starts_at) : null;
  if (rank < RANK.accepted) planning = slot ? step("planning", "upcoming", "Rendez-vous déjà enregistré, travaux après acceptation du devis.", slot) : step("planning", "upcoming", "Après acceptation du devis.");
  else if (appointment === undefined) planning = step("planning", rank === RANK.accepted ? "current" : "done", "Rendez-vous non chargé.");
  else if (rank === RANK.accepted) planning = step("planning", "current", slot ? "Rendez-vous planifié." : "Créneau à convenir avec l’artisan.", slot);
  else planning = slot ? step("planning", "done", "Rendez-vous enregistré.", slot) : step("planning", "not_applicable", "Aucun rendez-vous enregistré.");

  // Travaux: in progress, then the stored report.
  const works =
    rank < RANK.in_progress
      ? step("works", "upcoming", "Démarrage par l’artisan sur place.")
      : rank === RANK.in_progress
        ? step("works", "current", report ? "Intervention en cours, rapport saisi." : "Intervention en cours.", stored(report?.updated_at))
        : step("works", "done", report ? "Travaux terminés, rapport enregistré." : "Travaux terminés.", stored(report?.updated_at));

  // Réception: the dossier marked completed.
  const reception = rank < RANK.completed ? step("reception", "upcoming", "Clôture de l’intervention.") : step("reception", "done", "Intervention réceptionnée.", stored(i.completed_at));

  // Règlement: paid only when the dossier says so; otherwise the stored payment state.
  let paymentStep: TimelineStep;
  if (rank === RANK.paid) paymentStep = step("payment", "done", "Dossier réglé.", stored(i.paid_at) ?? stored(payment?.paid_at));
  else if (rank === RANK.completed)
    paymentStep = step(
      "payment",
      "current",
      payment?.status === "pending" ? "Paiement en attente de confirmation : non réglé." : payment?.status === "failed" ? "Paiement échoué : le dossier reste à régler." : "À régler sur la plateforme.",
    );
  else paymentStep = step("payment", "upcoming", "Après réception de l’intervention.");

  return [request, approvalStep, planning, works, reception, paymentStep];
}
