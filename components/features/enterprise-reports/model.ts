// ENT-15 on-screen enterprise report — pure model + controller (no React). Contract (read-only):
// app/api/reports/route.ts — GET /api/reports?organization_id=…[&site_id=…] (JSON). The CSV export
// uses the SAME query + format=csv (one scope for screen and file) → { sites, totals, currency:"eur", scope:{ kind:"visible_sites", site_id,
// organization_id, complete }, basis }. Rows and totals use lib/features/professional-report/model.ts
// (browser-safe zod: `reportRow`, `reportTotals`, `REPORT_BASIS`) imported as is; totals are recomputed
// and must match. Bound at render to identity + organization + site; late replies dropped; 401/403 clear.
import { z } from "zod";
import { MONEY_KEYS, REPORT_BASIS, reportRow, reportTotals, type FinancialSiteReport } from "../../../lib/features/professional-report/model";

export const REPORTS_PATH = "/api/reports";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const totals = z.object({ ...Object.fromEntries(MONEY_KEYS.map((k) => [k, count])), financial_complete: z.boolean() } as unknown as Record<(typeof MONEY_KEYS)[number] | "financial_complete", z.ZodTypeAny>).strict();
const reply = z
  .object({
    sites: z.array(reportRow).max(1000),
    totals,
    currency: z.literal("eur"),
    scope: z.object({ kind: z.literal("visible_sites"), site_id: id.nullable(), organization_id: id.nullable(), complete: z.boolean() }).strict(),
    basis: z.object(Object.fromEntries(Object.entries(REPORT_BASIS).map(([k, v]) => [k, z.literal(v)])) as unknown as Record<keyof typeof REPORT_BASIS, z.ZodTypeAny>).strict(),
  })
  .strict();
export type Report = { sites: FinancialSiteReport[]; totals: ReturnType<typeof reportTotals>; scope: { site_id: string | null; organization_id: string | null; complete: boolean } };
/** One scope query for the JSON read and the CSV export (route params: organization_id, site_id, format). */
export function reportQuery(organizationId: string, siteId: string | null, format?: "csv"): string {
  const q = [`organization_id=${encodeURIComponent(organizationId)}`];
  if (siteId) q.push(`site_id=${encodeURIComponent(siteId)}`);
  if (format) q.push(`format=${format}`);
  return `${REPORTS_PATH}?${q.join("&")}`;
}
/** Strict + same scope as asked + unique sites + totals equal to the recomputed sum of the rows. */
export function parseReport(body: unknown, organizationId: string, siteId: string | null): Report | null {
  const r = reply.safeParse(body);
  if (!r.success) return null;
  const d = r.data as unknown as Report & { scope: { kind: string } };
  const want = siteId?.toLowerCase() ?? null;
  if ((d.scope.site_id?.toLowerCase() ?? null) !== want || (d.scope.organization_id?.toLowerCase() ?? null) !== organizationId.toLowerCase()) return null;
  const ids = d.sites.map((s) => s.site_id.toLowerCase());
  if (new Set(ids).size !== ids.length || (want && ids.some((x) => x !== want))) return null;
  let sum: ReturnType<typeof reportTotals>;
  try {
    sum = reportTotals(d.sites);
  } catch {
    return null;
  }
  if (JSON.stringify(sum) !== JSON.stringify(Object.fromEntries([...MONEY_KEYS, "financial_complete"].map((k) => [k, (d.totals as Record<string, unknown>)[k]])))) return null;
  return { sites: d.sites, totals: d.totals, scope: { site_id: d.scope.site_id, organization_id: d.scope.organization_id, complete: d.scope.complete } };
}

export type ReportResult = { status: number; body: unknown };
export type ReportApi = { read(organizationId: string, siteId: string | null): Promise<ReportResult> };
export function createReportApi(fetcher: typeof fetch = (...a) => fetch(...a)): ReportApi {
  return {
    async read(organizationId, siteId) {
      try {
        const r = await fetcher(reportQuery(organizationId, siteId), { method: "GET", credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const REPORT_COPY = {
  loading: "Lecture du rapport serveur…",
  failed: "Le rapport n’a pas pu être lu. Réessayez.",
  notFound: "Ce site est introuvable dans votre périmètre.",
  forbidden: "Votre accès à ce rapport n’est plus valide. Reconnectez-vous ou changez d’organisation.",
  chooseOrg: "Choisissez une organisation pour obtenir son rapport et son export CSV.",
  serverNote: "données du serveur, tous dossiers",
  totalsNote: "Totaux calculés par le serveur sur tous les dossiers ; même source que le CSV.",
  partialNote: "Le serveur n’indique pas ce périmètre comme complet : ces sommes ne sont pas présentées comme des totaux.",
  unverified: (amount: string) => `Données financières incomplètes : ${amount} de paiements non vérifiés.`,
} as const;
export type ReportState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; data: Report | null; error: string };
export const REPORT_INITIAL: ReportState = { key: "", phase: "idle", data: null, error: "" };
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const reportKey = (c: Context, organizationId: string | null, siteId: string | null) => (organizationId ? `${identityOf(c)}|${organizationId.toLowerCase()}|${siteId?.toLowerCase() ?? "-"}` : "");
/** A render shows the stored report only if it belongs to ITS key; otherwise loading (never an old frame). */
export const reportView = (s: ReportState, key: string): ReportState => (s.key === key ? s : { ...REPORT_INITIAL, key, phase: key ? "loading" : "idle" });

export function createReportController({ api, context, set }: { api: () => ReportApi; context: Context; set: (s: ReportState) => void }) {
  let alive = true;
  let seq = 0;
  let state: ReportState = { ...REPORT_INITIAL };
  let current: { organizationId: string; siteId: string | null } | null = null;
  const bound = identityOf(context);
  const put = (s: ReportState) => {
    state = s;
    if (alive) set(s);
  };
  const run = async (q: { organizationId: string; siteId: string | null }) => {
    current = q;
    const my = ++seq;
    const key = reportKey(context, q.organizationId, q.siteId);
    put({ ...REPORT_INITIAL, key, phase: "loading" });
    const r = await api().read(q.organizationId, q.siteId);
    if (!alive || my !== seq || identityOf(context) !== bound) return; // stale scope / identity: dropped
    if (r.status === 401 || r.status === 403) return put({ ...REPORT_INITIAL, key, phase: "forbidden", error: REPORT_COPY.forbidden });
    const d = r.status === 200 ? parseReport(r.body, q.organizationId, q.siteId) : null;
    if (!d) return put({ ...REPORT_INITIAL, key, phase: "error", error: r.status === 404 ? REPORT_COPY.notFound : REPORT_COPY.failed });
    put({ key, phase: "ready", data: d, error: "" });
  };
  return {
    /** No organization chosen ⇒ nothing is read (the view says « choisissez une organisation »). */
    query(organizationId: string | null, siteId: string | null) {
      if (!alive || identityOf(context) !== bound || !organizationId || !UUID.test(organizationId)) return;
      if (siteId !== null && !UUID.test(siteId)) return;
      if (current && current.organizationId === organizationId && current.siteId === siteId) return;
      void run({ organizationId, siteId });
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    get: () => state,
    stop() {
      alive = false;
    },
  };
}
