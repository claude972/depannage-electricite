// ENT-12 enterprise approvals — pure model + controllers (no React). Contract (read-only):
// docs/ENTERPRISE_APPROVALS_BACKEND.md (codex/enterprise-approvals d5fc0c5; strict browser mirror):
//   GET /api/enterprise/approvals?organization_id=&site_id=&status=all|pending|approved|rejected&cursor=
//     → { items, page: { limit: 50, has_more, next_cursor } }   (created_at DESC, then UUID DESC)
//   GET /api/enterprise/approvals/<id>?organization_id=&site_id=
//     → { approval: row, rule: { enabled, required_role, threshold_cents } | null }
//     rule null = read succeeded and the exact site has NO rule (proven, not « unread »).
//   row = { id, quote_id, site_id, status, note, decided_by, created_at, decided_at,
//           site: { id, name, organization_id }, quote: { id, intervention_id, total_cents, status },
//           intervention: { id, category, status } }   — base quote amount, decider UUID only.
// Bound at render to identity + organization + site (+ status filter / approval id); late replies
// dropped; 401/403/404 ⇒ cleared + inaccessible; 422 on a next page ⇒ page 1. No decision right here.
import { z } from "zod";

export const APPROVALS_LIMIT = 50;
export type StatusFilter = "all" | "pending" | "approved" | "rejected";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const stamp = z.iso.datetime({ offset: true });
const row = z
  .object({
    id,
    quote_id: id,
    site_id: id,
    status: z.enum(["pending", "approved", "rejected"]),
    note: z.string().max(4000),
    decided_by: id.nullable(),
    created_at: stamp,
    decided_at: stamp.nullable(),
    site: z.object({ id, name: z.string().min(1).max(160), organization_id: id }).strict(),
    quote: z.object({ id, intervention_id: id, total_cents: z.number().int().min(0).max(2147483647), status: z.string().min(1).max(40) }).strict(),
    intervention: z.object({ id, category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]) }).strict(),
  })
  .strict();
export type ApprovalRow = z.infer<typeof row>;
const listSchema = z
  .object({ items: z.array(row).max(APPROVALS_LIMIT), page: z.object({ limit: z.literal(APPROVALS_LIMIT), has_more: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,800}$/).nullable() }).strict() })
  .strict();
const pointSchema = z
  .object({ approval: row, rule: z.object({ enabled: z.boolean(), required_role: z.enum(["owner", "manager"]), threshold_cents: z.number().int().min(0).max(2147483647) }).strict().nullable() })
  .strict();
export type ApprovalPoint = z.infer<typeof pointSchema>;
const lower = (x: string) => x.toLowerCase();
/** Coherent row inside the asked scope: joins consistent, organization (and site) as asked. */
function inScope(r: ApprovalRow, org: string, site: string | null) {
  return lower(r.site.id) === lower(r.site_id) && lower(r.quote.id) === lower(r.quote_id) && lower(r.intervention.id) === lower(r.quote.intervention_id) && lower(r.site.organization_id) === lower(org) && (!site || lower(r.site_id) === lower(site));
}
export function parseList(body: unknown, q: { org: string; site: string | null; status: StatusFilter }, after: ApprovalRow | null = null, seen: ReadonlySet<string> = new Set()): { items: ApprovalRow[]; next: string | null } | null {
  const r = listSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  const ids = p.items.map((x) => lower(x.id));
  if (new Set(ids).size !== ids.length) return null;
  let prev = after;
  for (const x of p.items) {
    if (!inScope(x, q.org, q.site) || (q.status !== "all" && x.status !== q.status)) return null;
    if (seen.has(lower(x.id))) continue;
    if (prev) {
      const d = Date.parse(x.created_at) - Date.parse(prev.created_at);
      const order = d || (lower(x.id) < lower(prev.id) ? -1 : lower(x.id) > lower(prev.id) ? 1 : 0);
      if (order >= 0) return null; // created_at DESC, then UUID DESC
    }
    prev = x;
  }
  return { items: p.items, next: p.page.next_cursor };
}
export function parsePoint(body: unknown, q: { id: string; org: string; site: string | null }): ApprovalPoint | null {
  const r = pointSchema.safeParse(body);
  if (!r.success) return null;
  if (lower(r.data.approval.id) !== lower(q.id) || !inScope(r.data.approval, q.org, q.site)) return null;
  return r.data;
}
const scopeQuery = (org: string, site: string | null) => `organization_id=${encodeURIComponent(org)}${site ? `&site_id=${encodeURIComponent(site)}` : ""}`;
export const listUrl = (org: string, site: string | null, status: StatusFilter, cursor: string | null) =>
  `/api/enterprise/approvals?${scopeQuery(org, site)}${status !== "all" ? `&status=${status}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export const pointUrl = (approvalId: string, org: string, site: string | null) => `/api/enterprise/approvals/${encodeURIComponent(approvalId)}?${scopeQuery(org, site)}`;

export type Result = { status: number; body: unknown };
export type ApprovalsApi = { get(url: string): Promise<Result> };
export function createApprovalsApi(fetcher: typeof fetch = (...a) => fetch(...a)): ApprovalsApi {
  return {
    async get(url) {
      try {
        const r = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const APPROVALS_COPY = {
  loading: "Lecture des approbations…",
  failed: "Les approbations n’ont pas pu être lues. Réessayez.",
  moreFailed: "La suite n’a pas pu être lue. Réessayez.",
  inaccessible: "Ces approbations ne sont pas (ou plus) accessibles avec votre compte.",
  pointInaccessible: "Cette approbation est introuvable ou inaccessible avec votre compte.",
  chooseOrg: "Choisissez une organisation pour voir ses approbations.",
  more: "Afficher plus",
  noRule: "Aucune règle d’approbation pour ce site (vérifié par le serveur).",
} as const;
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;

export type ListState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; items: ApprovalRow[]; next: string | null; loadingMore: boolean; failed: "first" | "more" | null; error: string };
export const LIST_INITIAL: ListState = { key: "", phase: "idle", items: [], next: null, loadingMore: false, failed: null, error: "" };
export const listKey = (c: Context, org: string | null, site: string | null, status: StatusFilter) => (org ? `${identityOf(c)}|${lower(org)}|${site ? lower(site) : "-"}|${status}` : "");
export const listView = (s: ListState, key: string): ListState => (s.key === key ? s : { ...LIST_INITIAL, key, phase: key ? "loading" : "idle" });

export function createListController({ api, context, set }: { api: () => ApprovalsApi; context: Context; set: (s: ListState) => void }) {
  let alive = true, seq = 0;
  let state: ListState = { ...LIST_INITIAL };
  let current: { org: string; site: string | null; status: StatusFilter } | null = null;
  const bound = identityOf(context);
  const put = (s: ListState) => ((state = s), alive && set(s));
  const same = (my: number) => alive && my === seq && identityOf(context) === bound;
  const keyOf = (q: { org: string; site: string | null; status: StatusFilter }) => listKey(context, q.org, q.site, q.status);
  const refused = (st: number) => st === 401 || st === 403 || st === 404;
  const first = async (q: { org: string; site: string | null; status: StatusFilter }) => {
    current = q;
    const my = ++seq, key = keyOf(q);
    put({ ...LIST_INITIAL, key, phase: "loading" });
    const r = await api().get(listUrl(q.org, q.site, q.status, null));
    if (!same(my)) return;
    if (refused(r.status)) return put({ ...LIST_INITIAL, key, phase: "forbidden", error: APPROVALS_COPY.inaccessible });
    const p = r.status === 200 ? parseList(r.body, q) : null;
    if (!p) return put({ ...LIST_INITIAL, key, phase: "error", failed: "first", error: APPROVALS_COPY.failed });
    put({ key, phase: "ready", items: p.items, next: p.next, loadingMore: false, failed: null, error: "" });
  };
  const more = async () => {
    if (!alive || !current || state.phase !== "ready" || !state.next || state.loadingMore) return;
    const my = seq, q = current, key = state.key;
    put({ ...state, loadingMore: true, failed: null, error: "" });
    const r = await api().get(listUrl(q.org, q.site, q.status, state.next));
    if (!same(my)) return;
    if (refused(r.status)) return put({ ...LIST_INITIAL, key, phase: "forbidden", error: APPROVALS_COPY.inaccessible });
    if (r.status === 422) return void first(q);
    const seen = new Set(state.items.map((x) => lower(x.id)));
    const p = r.status === 200 ? parseList(r.body, q, state.items[state.items.length - 1] ?? null, seen) : null;
    if (!p) return put({ ...state, loadingMore: false, failed: "more", error: APPROVALS_COPY.moreFailed });
    put({ ...state, loadingMore: false, items: [...state.items, ...p.items.filter((x) => !seen.has(lower(x.id)))], next: p.next });
  };
  return {
    query(org: string | null, site: string | null, status: StatusFilter) {
      if (!alive || identityOf(context) !== bound || !org || !UUID.test(org) || (site !== null && !UUID.test(site))) return;
      if (current && current.org === org && current.site === site && current.status === status) return;
      void first({ org, site, status });
    },
    more: (key: string) => (state.key === key ? more() : Promise.resolve()),
    retry(key: string) {
      if (!current || state.key !== key) return;
      if (state.failed === "more") return void more();
      if (state.phase === "error") void first(current);
    },
    /** Fresh page 1 of the same key (supersedes any earlier read). */
    refresh(key: string) {
      if (current && state.key === key) void first(current);
    },
    stop() {
      alive = false;
    },
  };
}

export type PointState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; data: ApprovalPoint | null; error: string };
export const POINT_INITIAL: PointState = { key: "", phase: "idle", data: null, error: "" };
export const pointKey = (c: Context, approvalId: string | null, org: string | null, site: string | null) => (approvalId && org ? `${identityOf(c)}|${lower(org)}|${site ? lower(site) : "-"}|${lower(approvalId)}` : "");
export const pointView = (s: PointState, key: string): PointState => (s.key === key ? s : { ...POINT_INITIAL, key, phase: key ? "loading" : "idle" });

export function createPointController({ api, context, set }: { api: () => ApprovalsApi; context: Context; set: (s: PointState) => void }) {
  let alive = true, seq = 0;
  let state: PointState = { ...POINT_INITIAL };
  let current: { id: string; org: string; site: string | null } | null = null;
  const bound = identityOf(context);
  const put = (s: PointState) => ((state = s), alive && set(s));
  const run = async (q: { id: string; org: string; site: string | null }) => {
    current = q;
    const my = ++seq, key = pointKey(context, q.id, q.org, q.site);
    put({ ...POINT_INITIAL, key, phase: "loading" });
    const r = await api().get(pointUrl(q.id, q.org, q.site));
    if (!alive || my !== seq || identityOf(context) !== bound) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return put({ ...POINT_INITIAL, key, phase: "forbidden", error: APPROVALS_COPY.pointInaccessible });
    const d = r.status === 200 ? parsePoint(r.body, q) : null;
    if (!d) return put({ ...POINT_INITIAL, key, phase: "error", error: APPROVALS_COPY.failed });
    put({ key, phase: "ready", data: d, error: "" });
  };
  return {
    query(approvalId: string | null, org: string | null, site: string | null) {
      if (!alive || identityOf(context) !== bound || !approvalId || !UUID.test(approvalId) || !org || !UUID.test(org) || (site !== null && !UUID.test(site))) return;
      if (current && current.id === approvalId && current.org === org && current.site === site) return;
      void run({ id: approvalId, org, site });
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    /** After a server-confirmed decision: fresh read (supersedes any earlier one). */
    refresh(key: string) {
      if (current && state.key === key) void run(current);
    },
    stop() {
      alive = false;
    },
  };
}
