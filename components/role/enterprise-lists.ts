// Logique pure des listes de l’espace entreprise (tableau interventions M4/M66, tableau sites M13).
// Sans React ni CSS : testée par tests/ui/enterprise-lists.test.ts.
import type { Approval, ComplianceRecord, ContractState, Intervention, Quote } from "../app/types";

export type InterventionFilters = {
  site: string;
  type: string;
  status: string;
  search: string;
  sort: "recent" | "oldest";
};
export const NO_FILTERS: InterventionFilters = {
  site: "",
  type: "",
  status: "",
  search: "",
  sort: "recent",
};

export const isFiltered = (f: InterventionFilters) =>
  Boolean(f.site || f.type || f.status || f.search.trim());

/** Périmètre global (barre de contexte) dont dépend la validité du filtre local de site. */
export type ListContext = { organizationId: string; siteId: string };

/**
 * Filtre local de site après un changement de périmètre global (VIS-REV-002).
 * Le sélecteur local est masqué dès qu’un site global est actif : un site local conservé
 * produirait une liste vide sans moyen visible de le retirer. Le site local est donc effacé
 * quand l’organisation ou le site global change, ou quand il n’appartient plus aux sites
 * du périmètre. Les autres filtres (type, statut, recherche, tri) restent valables.
 * Retourne le même objet quand rien ne change, pour ne pas provoquer de rendu inutile.
 */
export function reconcileFilters(
  filters: InterventionFilters,
  previous: ListContext,
  next: ListContext,
  siteIds: readonly string[],
): { filters: InterventionFilters; reset: boolean } {
  const contextChanged =
    previous.organizationId !== next.organizationId || previous.siteId !== next.siteId;
  const orphan = Boolean(filters.site) && !siteIds.includes(filters.site);
  if (!contextChanged && !orphan) return { filters, reset: false };
  return {
    filters: filters.site ? { ...filters, site: "" } : filters,
    // Le périmètre a changé : la pagination repart de la première page.
    reset: true,
  };
}

/** Filtre puis trie ; `haystack` fournit le texte recherché pour chaque dossier. */
export function filterInterventions(
  rows: Intervention[],
  f: InterventionFilters,
  haystack: (i: Intervention) => string,
): Intervention[] {
  const needle = f.search.trim().toLowerCase();
  const direction = f.sort === "oldest" ? 1 : -1;
  return rows
    .filter(
      (i) =>
        (!f.site || i.site_id === f.site) &&
        (!f.type || i.category === f.type) &&
        (!f.status || i.status === f.status) &&
        (!needle || haystack(i).toLowerCase().includes(needle)),
    )
    .sort((a, b) => direction * (Date.parse(a.created_at) - Date.parse(b.created_at)));
}

/** Numéros de page à afficher (M4/M66 : 1 2 3 … 5) ; `null` = ellipse. */
export function pageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, k) => k + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => keep.add(n));
  const pages = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((n, k) => {
    if (k > 0 && n - pages[k - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/** Alertes réelles d’un site : approbations en attente et contrôles de conformité non terminés. */
export function siteAlerts(
  siteId: string,
  approvals: Approval[],
  compliance: ComplianceRecord[],
  interventions: Intervention[],
  quotes: Quote[],
  today = new Date().toISOString().slice(0, 10),
) {
  const siteInterventions = new Set(
    interventions.filter((i) => i.site_id === siteId).map((i) => i.id),
  );
  const siteQuotes = new Set(
    quotes.filter((q) => siteInterventions.has(q.intervention_id)).map((q) => q.id),
  );
  const approvalsPending = approvals.filter(
    (a) =>
      a.status === "pending" && (a.site_id ? a.site_id === siteId : siteQuotes.has(a.quote_id)),
  ).length;
  const open = compliance.filter((r) => r.site_id === siteId && r.status !== "completed");
  const overdue = open.filter((r) => r.due_on && r.due_on < today).length;
  return { approvalsPending, complianceOpen: open.length, overdue };
}

/** Teinte de la barre de budget : la couleur porte l’état, jamais la décoration. */
export const budgetTone = (ratio: number, over: boolean): "normal" | "warning" | "over" =>
  over ? "over" : ratio >= 80 ? "warning" : "normal";

/**
 * Taux d’engagement d’un budget (VIS-REV-003) : `ratio` est le pourcentage réel, affiché et
 * annoncé tel quel (150 % pour 150 engagés sur 100) ; `width` est la seule valeur plafonnée
 * à 100, pour la largeur de la barre. Budget absent ou nul : `ratio` null, rien n’est déduit.
 */
export function budgetFigures(committedCents: number, budgetCents: number) {
  if (!(budgetCents > 0)) return { ratio: null, width: 0, over: false };
  const ratio = (committedCents / budgetCents) * 100;
  return { ratio, width: Math.min(100, Math.max(0, ratio)), over: committedCents > budgetCents };
}

/** Pourcentage entier pour l’affichage (« 150 % ») ; null = budget non renseigné. */
export const wholePercent = (ratio: number | null) =>
  ratio === null ? null : `${Math.round(ratio)} %`;

export type SiteAlertCounts = ReturnType<typeof siteAlerts>;
export type SiteAlertSummary =
  | { kind: "checking" }
  | { kind: "unverified" }
  | { kind: "none" }
  | { kind: "alerts"; parts: string[]; overdue: boolean };

/**
 * Cellule « Alertes » d’un site (VIS-REV-001). L’absence d’alerte n’est affirmée que lorsque
 * les données professionnelles sont réellement chargées ; sinon l’état est explicite
 * (vérification en cours ou non vérifié). Aucune conformité réglementaire n’est déduite.
 */
export function siteAlertSummary(state: ContractState, alerts: SiteAlertCounts): SiteAlertSummary {
  if (state === "unknown") return { kind: "checking" };
  if (state !== "available") return { kind: "unverified" };
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const pending = alerts.complianceOpen - alerts.overdue;
  const parts = [
    alerts.approvalsPending > 0 && plural(alerts.approvalsPending, "devis à approuver", "devis à approuver"),
    alerts.overdue > 0 && plural(alerts.overdue, "échéance dépassée", "échéances dépassées"),
    pending > 0 && plural(pending, "contrôle à traiter", "contrôles à traiter"),
  ].filter((x): x is string => typeof x === "string");
  return parts.length ? { kind: "alerts", parts, overdue: alerts.overdue > 0 } : { kind: "none" };
}
