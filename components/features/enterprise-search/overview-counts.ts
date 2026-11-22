// Enterprise overview counters — strict browser copy of e857e56 (lib/features/enterprise-overview/
// handler.ts is server-only): POST /api/enterprise/overview { organization_id, site_id|null }
//   → { organization_id, site_id, counts: { open, urgent }, captured_at }   (urgent ≤ open)
// open = requested/assigned/quoted/accepted/in_progress, urgent ⊂ open; RLS-scoped, no 100 cap.
// Feeds ONLY the « Interventions en cours » card (value + « dont N urgentes »). Bound at render to
// identity + organization + site; loading / error never mean zero; 401/403 clear.
import { z } from "zod";

export const OVERVIEW_PATH = "/api/enterprise/overview";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reply = z
  .object({
    organization_id: z.string().regex(UUID),
    site_id: z.string().regex(UUID).nullable(),
    counts: z.object({ open: count, urgent: count }).strict(),
    captured_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type OverviewCounts = z.infer<typeof reply>;
export type CountsBody = { organization_id: string; site_id: string | null };
export const countsBody = (organizationId: string, siteId: string | null): CountsBody | null =>
  UUID.test(organizationId) && (siteId === null || UUID.test(siteId)) ? { organization_id: organizationId, site_id: siteId } : null;
/** Strict + same scope as asked (the server lowercases ids) + urgent ≤ open. */
export function parseCounts(body: unknown, req: CountsBody): OverviewCounts | null {
  const r = reply.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (d.counts.urgent > d.counts.open) return null;
  if (d.organization_id.toLowerCase() !== req.organization_id.toLowerCase()) return null;
  if ((d.site_id?.toLowerCase() ?? null) !== (req.site_id?.toLowerCase() ?? null)) return null;
  return d;
}
export type CountsResult = { status: number; body: unknown };
export type CountsApi = { read(b: CountsBody): Promise<CountsResult> };
export function createCountsApi(fetcher: typeof fetch = (...a) => fetch(...a)): CountsApi {
  return {
    async read(b) {
      try {
        const r = await fetcher(OVERVIEW_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const COUNTS_COPY = {
  loading: "Vérification du compteur…",
  failed: "Compteur indisponible pour le moment.",
  scope: "Ce périmètre n’est pas accessible.",
  forbidden: "Accès au compteur refusé. Reconnectez-vous ou changez d’organisation.",
} as const;
export type CountsState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; open: number; urgent: number; error: string };
export const COUNTS_INITIAL: CountsState = { key: "", phase: "idle", open: 0, urgent: 0, error: "" };
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const countsKey = (c: Context, organizationId: string | null, siteId: string | null) => (organizationId ? `${identityOf(c)}|${organizationId.toLowerCase()}|${siteId?.toLowerCase() ?? "-"}` : "");
/** A render shows the stored counts only if they belong to ITS key; otherwise loading (never an old figure). */
export const countsView = (s: CountsState, key: string): CountsState => (s.key === key ? s : { ...COUNTS_INITIAL, key, phase: key ? "loading" : "idle" });

export function createCountsController({ api, context, set }: { api: () => CountsApi; context: Context; set: (s: CountsState) => void }) {
  let alive = true;
  let seq = 0;
  let state: CountsState = { ...COUNTS_INITIAL };
  let current: CountsBody | null = null;
  const bound = identityOf(context);
  const put = (s: CountsState) => {
    state = s;
    if (alive) set(s);
  };
  const run = async (req: CountsBody) => {
    current = req;
    const my = ++seq;
    const key = countsKey(context, req.organization_id, req.site_id);
    put({ ...COUNTS_INITIAL, key, phase: "loading" });
    const r = await api().read(req);
    if (!alive || my !== seq || identityOf(context) !== bound) return; // stale scope / identity: dropped
    if (r.status === 401 || r.status === 403) return put({ ...COUNTS_INITIAL, key, phase: "forbidden", error: COUNTS_COPY.forbidden });
    const d = r.status === 200 ? parseCounts(r.body, req) : null;
    if (!d) return put({ ...COUNTS_INITIAL, key, phase: "error", error: r.status === 404 ? COUNTS_COPY.scope : COUNTS_COPY.failed });
    put({ key, phase: "ready", open: d.counts.open, urgent: d.counts.urgent, error: "" });
  };
  return {
    query(organizationId: string | null, siteId: string | null) {
      if (!alive || identityOf(context) !== bound) return;
      const req = organizationId ? countsBody(organizationId, siteId) : null;
      if (!req) return;
      if (current && current.organization_id === req.organization_id && current.site_id === req.site_id) return;
      void run(req);
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    /** « Actualiser »: re-read the SAME scope (same guards). */
    refresh(key: string) {
      if (!alive || !current || state.key !== key || state.phase === "loading") return false;
      void run(current);
      return true;
    },
    get: () => state,
    stop() {
      alive = false;
    },
  };
}
