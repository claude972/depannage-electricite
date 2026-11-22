// Logique pure du tableau de bord Super Admin (M43) : indicateurs, listes du tableau de bord et
// mentions de borne. Sans React ni CSS : testée par tests/ui/admin-lists.test.ts. Les valeurs
// viennent exclusivement des totaux serveur ; aucune période, tendance ou revenu n’est déduit.
import type { AdminOverview, Intervention, Status } from "../app/types";
import { money } from "../app/format";

export type AdminKpi = {
  id: "interventions" | "active" | "paid" | "pending";
  icon: string;
  tone: "blue" | "amber" | "green" | "navy";
  label: string;
  value: string;
  /** Note courte, une ligne (M43). */
  note: string;
  /** Base de calcul complète, affichée sous la rangée. */
  basis: string;
};

export const ACTIVE_STATUSES: Status[] = ["requested", "assigned", "quoted", "accepted", "in_progress", "completed"];
export const loadedNote = (limit: number) => `parmi les ${limit} derniers chargés`;

export function adminKpis(o: AdminOverview): AdminKpi[] {
  return [
    {
      id: "interventions",
      icon: "list",
      tone: "blue",
      label: "Interventions",
      value: String(o.counts.interventions),
      note: "Total plateforme",
      basis: "Interventions : total plateforme, tous statuts confondus (compteur serveur global).",
    },
    {
      id: "active",
      icon: "clock",
      tone: "amber",
      label: "Interventions en cours",
      value: String(o.counts.active_interventions),
      note: "Dossiers non clos",
      basis: "Interventions en cours : dossiers non clos, décompte serveur global.",
    },
    {
      id: "paid",
      icon: "euro",
      tone: "green",
      label: "Prestations payées TTC",
      value: money(o.financial.paid_service_cents),
      note: paidBreakdown(o) ?? "Hors revenu plateforme",
      basis: `Prestations payées TTC : ${o.financial.note}${paidBreakdown(o) ? ` Ventilation : ${paidBreakdown(o)}.` : ""} Revenu plateforme : non calculé.`,
    },
    {
      id: "pending",
      icon: "shield",
      tone: "navy",
      label: "Candidatures à examiner",
      value: String(o.counts.pending_applications),
      note: "En attente de décision",
      basis: "Candidatures à examiner : dossiers artisans soumis, en attente d’une décision de l’opérateur (compteur serveur global).",
    },
  ];
}

const byNewest = <T extends { created_at: string }>(a: T, b: T) => Date.parse(b.created_at) - Date.parse(a.created_at);

/**
 * Candidatures soumises dans l’ordre transmis par le serveur, et six dossiers actifs les plus
 * récents, sur les listes chargées. La vue d’ensemble ne transmet ni date de soumission ni
 * `created_at` de candidature : aucun tri ni affichage de date n’est déduit du compte.
 */
export function dashboardRows(o: AdminOverview, activeLimit = 6) {
  const pending = o.artisans.filter((a) => a.application_status === "submitted");
  const active: Intervention[] = o.interventions
    .filter((i) => ACTIVE_STATUSES.includes(i.status))
    .sort(byNewest)
    .slice(0, activeLimit);
  return { pending, active };
}

/** Optional server breakdown (ROOT projection): bank-confirmed vs declared received on site. Only
 *  shown when BOTH fields are real numbers — never an invented 0 when the server omits them. */
export function paidBreakdown(o: Pick<AdminOverview, "financial">): string | null {
  const f = o.financial as { bank_paid_service_cents?: unknown; on_site_declared_cents?: unknown };
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!ok(f.bank_paid_service_cents) || !ok(f.on_site_declared_cents)) return null;
  return `dont ${money(f.bank_paid_service_cents)} confirmés par la banque et ${money(f.on_site_declared_cents)} déclarés reçus sur place`;
}
