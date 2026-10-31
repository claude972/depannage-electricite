// Logique pure des listes de l’espace entreprise (tableau interventions M4/M66, tableau sites M13).
// Sans React ni CSS : testée par tests/ui/enterprise-lists.test.ts.
import type { Approval, ComplianceRecord, Intervention, Quote } from "../app/types";

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
