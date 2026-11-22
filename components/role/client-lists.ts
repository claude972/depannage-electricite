// Logique pure de l’espace client (M61 accueil, V8-C06 devis, V8-C07 détail d’intervention).
// Sans React ni CSS : testée par tests/ui/client-lists.test.ts. Aucune valeur n’est déduite :
// seuls les champs enregistrés sont décrits, les absences restent explicites.
import type { Intervention, Payment, Quote, Status } from "../app/types";

/** Ligne « Interventions récentes » (M61) : titre, adresse sur une ligne, état, date. */
export interface RecentRowDescriptor {
  title: string;
  address: string;
  status: Status;
  createdAt: string;
}
export function recentRowDescriptor(
  i: Pick<Intervention, "category" | "address" | "postal_code" | "city" | "status" | "created_at">,
  categoryLabel: (id: string) => string,
): RecentRowDescriptor {
  const parts = [i.address.trim(), [i.postal_code, i.city].filter(Boolean).join(" ").trim()].filter(Boolean);
  return { title: categoryLabel(i.category), address: parts.join(", "), status: i.status, createdAt: i.created_at };
}

/** Prefer recorded settlement, then accepted or received quotes; never infer payment from dossier status. */
export function requestAmount(
  i: Pick<Intervention, "id" | "status" | "estimate_min_cents" | "estimate_max_cents">,
  quotes: Quote[],
  payments: Payment[],
  money: (cents: number) => string,
): string {
  const accepted = quotes.filter((q) => q.intervention_id === i.id && q.status === "accepted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const paid = payments.filter((p) => p.quote_id === accepted?.id && p.status === "paid" && p.paid_at)
    .sort((a, b) => b.paid_at!.localeCompare(a.paid_at!))[0];
  if (paid) return `${paid.method === "on_site_declared" ? "Règlement déclaré" : "Montant payé"} : ${money(paid.total_cents)}`;
  if (accepted) return `${i.status === "completed" ? "À régler" : "Devis accepté"} : ${money(accepted.accepted_total_cents ?? accepted.total_cents)}`;
  const received = quotes.filter((q) => q.intervention_id === i.id && q.status === "sent")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (received) return `Devis reçu : ${money(received.total_cents)}`;
  return `Estimation : ${money(i.estimate_min_cents)} – ${money(i.estimate_max_cents)}`;
}

/** Cellules d’une ligne de devis (V8-C06) : « quantité × PU HT » et total HT de la ligne (affichage). */
export function quoteLineCells(line: { quantity: number; unit_price_cents: number }, money: (cents: number) => string) {
  return { unit: `${line.quantity} × ${money(line.unit_price_cents)}`, total_cents: Math.round(line.quantity * line.unit_price_cents) };
}

/** État de décision d’un devis affiché, à partir des versions réelles du dossier. */
export type QuoteDecisionState = "active" | "superseded" | "accepted" | "closed";
export function quoteDecisionState(
  quote: Pick<Quote, "id" | "status">,
  current: Pick<Quote, "id" | "status"> | undefined,
  interventionStatus: Status,
): QuoteDecisionState {
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "rejected") return "superseded";
  if (current && current.id !== quote.id) return "superseded";
  if (quote.status === "sent" && interventionStatus === "quoted") return "active";
  return "closed";
}

/** Étapes du stepper V8-C07, alignées sur les statuts réels (pas de « À planifier »). */
export const CLIENT_STEPS: { label: string; reachedAt: Status }[] = [
  { label: "Demandée", reachedAt: "requested" },
  { label: "Artisan", reachedAt: "assigned" },
  { label: "Devis", reachedAt: "quoted" },
  { label: "Intervention", reachedAt: "accepted" },
  { label: "Règlement", reachedAt: "completed" },
];
const PROGRESS: Status[] = ["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid"];
export const progressIndex = (status: Status) => PROGRESS.indexOf(status);
/** Règlement confirmé par le serveur : statut « paid » ET horodatage `paid_at` enregistré. */
export const isSettled = (i: { status: Status; paid_at?: string | null }) => i.status === "paid" && Boolean(i.paid_at);
/**
 * Index de l’étape courante (−1 pour une demande annulée ou inconnue). Un dossier réglé avec
 * `paid_at` serveur renvoie `CLIENT_STEPS.length` : toutes les étapes sont terminées. Sans
 * confirmation serveur, la dernière étape reste courante — jamais de succès anticipé.
 */
export function currentStepIndex(status: Status, paidAt?: string | null): number {
  if (isSettled({ status, paid_at: paidAt })) return CLIENT_STEPS.length;
  const progress = progressIndex(status);
  return CLIENT_STEPS.reduce((acc, step, index) => (progress >= PROGRESS.indexOf(step.reachedAt) ? index : acc), -1);
}

export interface HistoryEntry {
  label: string;
  when: string;
  state: "done" | "current" | "upcoming";
}
/**
 * Chronologie V8-C07 : seules les dates enregistrées apparaissent (« — » sinon) ; les étapes
 * postérieures à l’étape courante sont « À venir ». Une demande annulée a deux entrées.
 */
export function detailHistory(
  i: Pick<Intervention, "status" | "created_at" | "completed_at" | "paid_at">,
  dates: { quoteReceivedAt?: string | null; quoteAcceptedAt?: string | null; appointmentStartsAt?: string | null },
  format: (iso: string) => string,
): HistoryEntry[] {
  if (i.status === "cancelled")
    return [
      { label: "Demande créée", when: format(i.created_at), state: "done" },
      { label: "Demande annulée", when: "—", state: "done" },
    ];
  const reached = progressIndex(i.status);
  const progress = i.status === "accepted" || i.status === "completed" ? reached + 1 : reached;
  const rows: [string, string][] = [
    ["Demande créée", format(i.created_at)],
    ["Artisan attribué", "—"],
    ["Devis reçu", dates.quoteReceivedAt ? format(dates.quoteReceivedAt) : "—"],
    ["Devis accepté", dates.quoteAcceptedAt ? format(dates.quoteAcceptedAt) : "—"],
    ["Intervention", dates.appointmentStartsAt ? `Créneau ${format(dates.appointmentStartsAt)}` : "—"],
    ["Intervention terminée", i.completed_at ? format(i.completed_at) : "—"],
    ["Règlement", i.paid_at ? format(i.paid_at) : "—"],
  ];
  // The terminal event is "done" only once the server has recorded the payment (paid + paid_at).
  const settled = isSettled(i);
  return rows.map(([label, when], index) => ({
    label,
    when: index > progress ? "À venir" : when,
    state: settled || index < progress ? "done" : index === progress ? "current" : "upcoming",
  }));
}
