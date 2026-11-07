// ENT-11: SLA rolled up over the organisation's visible sites (GET /api/organizations/:id/sla).
// Contract /tmp/depannage-organization-sla-contract.json (ROOT 30f6ce2). Rules: a page is its own
// atomic snapshot (own captured_at) — pages are never added together; the summary is presented
// as organisation-wide only when complete_for_organization is true; a failed load is an error,
// never a zero.
export const SLA_TIMEOUT_MS = 15_000;

export type TrackStatus = "met" | "breached" | "pending" | "not_measurable";
export type OrgSlaCase = { case_id: string; evaluation: { response: { status: TrackStatus }; resolution: { status: TrackStatus }; measurable: boolean } | null; reason: string | null };
export type OrgSlaSite = { id: string; name: string; cases_total: number; cases: OrgSlaCase[]; complete: boolean; reasons: string[] };
export type OrgSlaSummary = {
  cases: number; measurable: number; not_measurable: number; breached: number; pending: number; met: number;
  indeterminate: number; cases_evaluated: number; cases_returned: number; partially_measurable: number; unavailable: number; complete: boolean; basis: "returned_visible_sites";
};
export type OrgSlaReport = {
  organization_id: string;
  captured_at: string;
  scope: { kind: "organization" | "visible_sites"; visible_sites_total: number; organization_wide: boolean };
  state: "complete" | "partial";
  reasons: string[];
  complete_for_visible_scope: boolean;
  complete_for_organization: boolean;
  page: { limit: number; has_more: boolean; next_cursor: string | null; returned_sites: number; remaining_sites_total: number };
  summary: OrgSlaSummary;
  sites: OrgSlaSite[];
};
export type SlaResult = { status: number; body: unknown };
export type OrgSlaApi = { get(organizationId: string, cursor: string | null): Promise<SlaResult> };

export const SLA_REASON: Record<string, string> = {
  sites_limited: "plus de 20 sites : seule cette page est résumée",
  paginated_subset: "page suivante d’une liste paginée : ce résumé ne couvre que ces sites",
  calendars_limited: "plus de 100 calendriers référencés : certains n’ont pas été chargés",
  cases_limited: "plus de 100 cas sur un site : seuls les 100 plus récents sont évalués",
  pauses_limited: "plus de 20 pauses sur un cas : évaluation incomplète",
  policy_unavailable: "politique SLA introuvable pour certains cas",
  calendar_unavailable: "calendrier référencé non chargé pour certains cas (aucun calendrier par défaut substitué)",
};
export const reasonText = (r: string) => SLA_REASON[r] ?? "donnée incomplète";

const int = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown) => typeof v === "string" && v.length > 0;
const STATUSES = new Set(["met", "breached", "pending", "not_measurable"]);

/** Structural check of the reply: anything off the contract is an error, never an empty report. */
export function parseOrgSla(body: unknown, organizationId: string): OrgSlaReport | null {
  if (!body || typeof body !== "object") return null;
  const r = body as OrgSlaReport;
  if (r.organization_id !== organizationId || !str(r.captured_at) || Number.isNaN(Date.parse(r.captured_at))) return null;
  if (!r.scope || (r.scope.kind !== "organization" && r.scope.kind !== "visible_sites") || typeof r.scope.organization_wide !== "boolean" || !int(r.scope.visible_sites_total)) return null;
  if ((r.scope.kind === "organization") !== r.scope.organization_wide) return null;
  if (r.state !== "complete" && r.state !== "partial") return null;
  if (!Array.isArray(r.reasons) || !r.reasons.every(str) || (r.state === "complete") !== (r.reasons.length === 0)) return null;
  if (typeof r.complete_for_visible_scope !== "boolean" || typeof r.complete_for_organization !== "boolean") return null;
  if (r.complete_for_organization && (!r.complete_for_visible_scope || !r.scope.organization_wide)) return null;
  const p = r.page;
  if (!p || !int(p.returned_sites) || !int(p.remaining_sites_total) || typeof p.has_more !== "boolean") return null;
  if (p.has_more !== (p.next_cursor !== null) || (p.next_cursor !== null && !/^[-A-Za-z0-9_]{1,200}$/.test(p.next_cursor))) return null;
  if (!Array.isArray(r.sites) || r.sites.length !== p.returned_sites || r.sites.length > 20) return null;
  for (const s of r.sites) {
    if (!str(s.id) || !str(s.name) || !int(s.cases_total) || !Array.isArray(s.cases) || typeof s.complete !== "boolean" || !Array.isArray(s.reasons)) return null;
    for (const c of s.cases) {
      if (!str(c.case_id)) return null;
      if (c.evaluation === null ? !str(c.reason) : !c.evaluation || !STATUSES.has(c.evaluation.response?.status) || !STATUSES.has(c.evaluation.resolution?.status)) return null;
    }
  }
  const m = r.summary;
  if (!m || m.basis !== "returned_visible_sites" || typeof m.complete !== "boolean") return null;
  for (const k of ["cases", "measurable", "not_measurable", "breached", "pending", "met", "indeterminate", "cases_evaluated", "cases_returned", "partially_measurable", "unavailable"] as const) if (!int(m[k])) return null;
  if (m.cases_returned !== r.sites.reduce((n, s) => n + s.cases.length, 0)) return null;
  return r;
}

/** Per-site figures from the returned cases only (never from another page). */
export function siteFigures(site: OrgSlaSite) {
  let breached = 0, pending = 0, met = 0, other = 0, unavailable = 0;
  for (const c of site.cases) {
    if (!c.evaluation) {
      unavailable++;
      continue;
    }
    const t = [c.evaluation.response.status, c.evaluation.resolution.status];
    if (t.includes("breached")) breached++;
    else if (t.includes("pending")) pending++;
    else if (t[0] === "met" && t[1] === "met") met++;
    else other++;
  }
  return { evaluated: site.cases.length - unavailable, breached, pending, met, other, unavailable, notReturned: Math.max(0, site.cases_total - site.cases.length) };
}

/** Honest heading for the page summary. */
export function summaryScope(r: OrgSlaReport): string {
  if (r.complete_for_organization) return "Toute l’organisation";
  if (r.complete_for_visible_scope) return `Les ${r.scope.visible_sites_total} site${r.scope.visible_sites_total > 1 ? "s" : ""} visibles avec vos droits (pas toute l’organisation)`;
  return `Cette page seulement : ${r.page.returned_sites} site${r.page.returned_sites > 1 ? "s" : ""} sur ${r.scope.visible_sites_total} visibles — résumé partiel`;
}

export function createOrgSlaApi(fetcher: typeof fetch = (...a) => fetch(...a), timeoutMs = SLA_TIMEOUT_MS): OrgSlaApi {
  return {
    async get(organizationId, cursor) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const res = await fetcher(`/api/organizations/${encodeURIComponent(organizationId)}/sla${qs}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return { status: res.status, body };
      } catch {
        return { status: 0, body: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type SlaView =
  | { phase: "loading" }
  | { phase: "error"; text: string; retry: boolean; restart?: boolean }
  | { phase: "ready"; report: OrgSlaReport; cursor: string | null; pageIndex: number };

export function viewFromResult(r: SlaResult, organizationId: string, cursor: string | null, pageIndex: number): SlaView {
  if (r.status === 200) {
    const report = parseOrgSla(r.body, organizationId);
    return report ? { phase: "ready", report, cursor, pageIndex } : { phase: "error", text: "Le rapport SLA reçu est incohérent : il n’est pas affiché.", retry: true };
  }
  if (r.status === 401) return { phase: "error", text: "Votre session a expiré. Reconnectez-vous.", retry: false };
  if (r.status === 403 || r.status === 404) return { phase: "error", text: "Ce rapport n’est pas accessible avec vos droits dans cette organisation.", retry: false };
  if (r.status === 422) return { phase: "error", text: "La page demandée n’est plus valide : rechargez le rapport depuis le début.", retry: true, restart: true };
  return { phase: "error", text: "Le rapport SLA n’a pas pu être chargé.", retry: true };
}
