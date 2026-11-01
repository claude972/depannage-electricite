// Logique pure des listes de l’espace entreprise (tableau interventions M4/M66, tableau sites M13).
// Sans React ni CSS : testée par tests/ui/enterprise-lists.test.ts.
import type { Approval, ComplianceRecord, ContractState, Intervention, Quote, Site } from "../app/types";

/** Accepted commitment of a quote = base + accepted amendments, as computed by the server
 *  (Quote.accepted_total_cents, FASTSPLIT-ACCEPTED-TOTALS-001). Falls back to the base total ONLY
 *  when the field is absent (demo data / older API). Never a max/clamp with what was paid. */
export type QuoteWithAccepted = Pick<Quote, "total_cents"> & { accepted_total_cents?: number };
export function acceptedCommittedCents(q: QuoteWithAccepted): number {
  // validateWorkspace already rejects a present-but-malformed value: absent ⇒ base (legacy/demo).
  return q.accepted_total_cents === undefined ? q.total_cents : q.accepted_total_cents;
}

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

/** Date ISO (AAAA-MM-JJ) décalée de `days` jours, en UTC. */
const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Chiffres du tableau de bord V5-C05, uniquement à partir des dossiers chargés : interventions
 * ouvertes (selon `isOpen`), dont celles marquées urgentes, et échéances non terminées dues dans
 * les 30 jours (bornes incluses, dépassées exclues). Aucune consommation, projection ni tendance.
 */
export function overviewFigures(
  scope: { interventions: Pick<Intervention, "status" | "urgency">[]; compliance: Pick<ComplianceRecord, "status" | "due_on">[] },
  today: string,
  isOpen: (status: Intervention["status"]) => boolean,
) {
  const open = scope.interventions.filter((i) => isOpen(i.status));
  const horizon = shiftDate(today, 30);
  const deadlines30 = scope.compliance.filter((r) => r.status !== "completed" && r.due_on >= today && r.due_on <= horizon).length;
  return { open: open.length, urgent: open.filter((i) => i.urgency === "urgent").length, deadlines30 };
}

export type SiteBudgetBar = {
  id: string;
  name: string;
  committed: number;
  budget: number;
  ratio: number | null;
  width: number;
  over: boolean;
};
/** « Budget par site » (V5-C05) : engagé = devis acceptés des dossiers du site ; taux réel via `budgetFigures`. */
export function siteBudgetBars(
  sites: Pick<Site, "id" | "name" | "budget_cents">[],
  interventions: Pick<Intervention, "id" | "site_id">[],
  quotes: (Pick<Quote, "intervention_id" | "status" | "total_cents"> & { accepted_total_cents?: number })[],
): SiteBudgetBar[] {
  return sites.map((site) => {
    const ids = new Set(interventions.filter((i) => i.site_id === site.id).map((i) => i.id));
    const committed = quotes
      .filter((q) => q.status === "accepted" && ids.has(q.intervention_id))
      .reduce((sum, q) => sum + acceptedCommittedCents(q), 0);
    const budget = site.budget_cents || 0;
    return { id: site.id, name: site.name, committed, budget, ...budgetFigures(committed, budget) };
  });
}

/** Lisibilité d’un chiffre dépendant des données professionnelles (même règle que `siteAlertSummary`). */
export type FigureState = "checking" | "unverified" | "loaded";
export const figureState = (state: ContractState): FigureState =>
  state === "unknown" ? "checking" : state === "available" ? "loaded" : "unverified";

/**
 * Chiffres du tableau de bord V5-C05 dépendant du contrat professionnel : échéances à 30 jours,
 * approbations en attente et budget engagé ne sont des nombres que lorsque les données sont
 * réellement chargées ; sinon `null` (vérification en cours ou non vérifié), jamais un 0.
 * Les interventions ouvertes et les urgences viennent de l’espace de travail et restent chiffrées.
 */
export function dashboardFigures(
  state: ContractState,
  scope: {
    interventions: Pick<Intervention, "status" | "urgency">[];
    compliance: Pick<ComplianceRecord, "status" | "due_on">[];
    approvals: Pick<Approval, "status">[];
    quotes: (Pick<Quote, "status" | "total_cents"> & { accepted_total_cents?: number })[];
  },
  today: string,
  isOpen: (status: Intervention["status"]) => boolean,
) {
  const base = overviewFigures(scope, today, isOpen);
  const professional = figureState(state);
  const loaded = professional === "loaded";
  return {
    open: base.open,
    urgent: base.urgent,
    professional,
    deadlines30: loaded ? base.deadlines30 : null,
    approvalsPending: loaded ? scope.approvals.filter((a) => a.status === "pending").length : null,
    committedCents: loaded ? scope.quotes.filter((q) => q.status === "accepted").reduce((sum, q) => sum + acceptedCommittedCents(q), 0) : null,
  };
}

/** Libellé d’un chiffre non chiffrable : l’état est dit, jamais remplacé par une valeur. */
export const FIGURE_PLACEHOLDER: Record<Exclude<FigureState, "loaded">, string> = {
  checking: "Vérification…",
  unverified: "Non vérifié",
};

/**
 * Sous-titre du tableau de bord : « parmi les données chargées » seulement quand les données
 * professionnelles le sont réellement ; sinon l’état de vérification est annoncé.
 */
export function overviewSubtitle(state: ContractState, organizationName: string, loadedNote: string): string {
  const figure = figureState(state);
  if (figure === "loaded") return `${organizationName} · parmi les ${loadedNote.charAt(0).toLowerCase()}${loadedNote.slice(1)}`;
  if (figure === "checking") return `${organizationName} · vérification des données professionnelles en cours`;
  return `${organizationName} · données professionnelles non vérifiées (service indisponible)`;
}
