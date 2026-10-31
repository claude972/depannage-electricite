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
      note: "Hors revenu plateforme",
      basis: `Prestations payées TTC : ${o.financial.note} Revenu plateforme : non calculé.`,
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
