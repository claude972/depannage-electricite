// Site sheet paginated records — pure model + controller (no React). Contract (read-only):
// docs/SITE_RECORDS_BACKEND.md + lib/features/site-records/handler.ts (codex/site-records 1c0acea;
// server-only, so a strict browser mirror of its schemas and checks):
//   GET /api/sites/<id>/records?kind=open|past|upcoming|completed|audits[&cursor=opaque]
//   → { items, page: { limit: 50, has_more, next_cursor } } — no other key.
//   open: requested/assigned/quoted/accepted/in_progress · past: completed/paid/cancelled
//     (created_at DESC, then UUID DESC) — items { id, site_id, category, status, created_at }
//   upcoming: pending/scheduled (overdue included) · completed: completed · audits: audit/safety, any
//     status (due_on ASC, then UUID ASC) — items { id, site_id, title, kind, due_on, status, notes }
// Read under the member's identity / RLS. Every read is bound to identity (uid+gen) + site + kind; a
// kind switch resets the cursor (page 1, never mixed); « Afficher plus » appends with dedupe; late
// replies dropped; 401/403/404 honest. Rights for actions stay with the caller (canWriteSite).
import { z } from "zod";

export const SITE_RECORDS_LIMIT = 50;
export type JobKind = "open" | "past";
export type DueKind = "upcoming" | "completed" | "audits";
export type Kind = JobKind | DueKind;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const OPEN = ["requested", "assigned", "quoted", "accepted", "in_progress"] as const;
const PAST = ["completed", "paid", "cancelled"] as const;
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const job = z
  .object({ id, site_id: id, category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), status: z.enum([...OPEN, ...PAST]), created_at: timestamp })
  .strict();
const due = z
  .object({ id, site_id: id, title: z.string().min(1).max(160), kind: z.enum(["audit", "maintenance", "safety", "equipment", "contract"]), due_on: z.iso.date(), status: z.enum(["pending", "scheduled", "completed"]), notes: z.string().max(4000) })
  .strict();
export type JobRow = z.infer<typeof job>;
export type DueRow = z.infer<typeof due>;
const page = z.object({ limit: z.literal(SITE_RECORDS_LIMIT), has_more: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,600}$/).nullable() }).strict();
const jobPage = z.object({ items: z.array(job).max(SITE_RECORDS_LIMIT), page }).strict();
const duePage = z.object({ items: z.array(due).max(SITE_RECORDS_LIMIT), page }).strict();
export type RecordsPage = { items: (JobRow | DueRow)[]; next: string | null };
export const isJobKind = (k: Kind): k is JobKind => k === "open" || k === "past";

/** Strict: the handler's shape, has_more ⇔ next_cursor, this site only, the kind's own filter, unique
 *  (lower-cased) ids, and the handler's order (jobs created_at DESC, id DESC; due dates due_on ASC,
 *  id ASC), continuing after `after` (the last row already shown) for a next page. */
export function parseRecords(body: unknown, siteId: string, kind: Kind, after: JobRow | DueRow | null = null, seen: ReadonlySet<string> = new Set()): RecordsPage | null {
  const r = (isJobKind(kind) ? jobPage : duePage).safeParse(body);
  if (!r.success) return null;
  const p = r.data as { items: (JobRow | DueRow)[]; page: z.infer<typeof page> };
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  const ids = p.items.map((x) => x.id.toLowerCase());
  if (new Set(ids).size !== ids.length) return null;
  const site = siteId.toLowerCase();
  const at = (x: JobRow | DueRow) => ("created_at" in x ? Date.parse(x.created_at) : 0);
  let prev = after;
  for (const x of p.items) {
    if (prev && !seen.has(x.id.toLowerCase())) {
      const dir = isJobKind(kind) ? at(x) - at(prev) : (x as DueRow).due_on.localeCompare((prev as DueRow).due_on);
      const order = dir || (x.id.toLowerCase() < prev.id.toLowerCase() ? -1 : x.id.toLowerCase() > prev.id.toLowerCase() ? 1 : 0);
      if (isJobKind(kind) ? order >= 0 : order <= 0) return null;
    }
    if (!seen.has(x.id.toLowerCase())) prev = x;
    if (x.site_id.toLowerCase() !== site) return null;
    if (kind === "open" && !(OPEN as readonly string[]).includes(x.status)) return null;
    if (kind === "past" && !(PAST as readonly string[]).includes(x.status)) return null;
    if (kind === "upcoming" && !["pending", "scheduled"].includes(x.status)) return null;
    if (kind === "completed" && x.status !== "completed") return null;
    if (kind === "audits" && !["audit", "safety"].includes((x as DueRow).kind)) return null;
  }
  return { items: p.items, next: p.page.next_cursor };
}
export const recordsUrl = (siteId: string, kind: Kind, cursor: string | null) =>
  `/api/sites/${encodeURIComponent(siteId)}/records?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

export type RecordsResult = { status: number; body: unknown };
export type RecordsApi = { read(siteId: string, kind: Kind, cursor: string | null): Promise<RecordsResult> };
export function createRecordsApi(fetcher: typeof fetch = (...a) => fetch(...a)): RecordsApi {
  return {
    async read(siteId, kind, cursor) {
      try {
        const r = await fetcher(recordsUrl(siteId, kind, cursor), { method: "GET", credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const RECORDS_COPY = {
  loading: "Lecture des enregistrements du site…",
  failed: "Les enregistrements du site n’ont pas pu être lus. Réessayez.",
  moreFailed: "La suite n’a pas pu être lue. Réessayez.",
  notFound: "Ce site n’est pas (ou plus) accessible avec votre compte.",
  forbidden: "Votre accès à ce site n’est plus valide. Reconnectez-vous ou changez d’organisation.",
  more: "Afficher plus",
} as const;
export type RecordsState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; items: (JobRow | DueRow)[]; next: string | null; loadingMore: boolean; failed: "first" | "more" | null; error: string };
export const RECORDS_INITIAL: RecordsState = { key: "", phase: "idle", items: [], next: null, loadingMore: false, failed: null, error: "" };
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const recordsKey = (c: Context, siteId: string | null, kind: Kind) => (siteId ? `${identityOf(c)}|${siteId.toLowerCase()}|${kind}` : "");
/** A render shows the stored rows only if they belong to ITS key (identity + site + kind). */
export const recordsView = (s: RecordsState, key: string): RecordsState => (s.key === key ? s : { ...RECORDS_INITIAL, key, phase: key ? "loading" : "idle" });

export function createRecordsController({ api, context, set }: { api: () => RecordsApi; context: Context; set: (s: RecordsState) => void }) {
  let alive = true;
  let seq = 0;
  let state: RecordsState = { ...RECORDS_INITIAL };
  let current: { siteId: string; kind: Kind } | null = null;
  const bound = identityOf(context);
  const put = (s: RecordsState) => {
    state = s;
    if (alive) set(s);
  };
  const same = (my: number) => alive && my === seq && identityOf(context) === bound;
  // 401/403/404 (same 404 for an absent or a foreign site) on page 1 OR a next page: every private
  // row and the cursor are cleared, then « inaccessible » — never rows kept after a revocation.
  const fail = (key: string, status: number, more: boolean) =>
    status === 401 || status === 403 || status === 404
      ? put({ ...RECORDS_INITIAL, key, phase: "forbidden", error: status === 404 ? RECORDS_COPY.notFound : RECORDS_COPY.forbidden })
      : more
        ? put({ ...state, loadingMore: false, failed: "more", error: RECORDS_COPY.moreFailed })
        : put({ ...RECORDS_INITIAL, key, phase: "error", failed: "first", error: RECORDS_COPY.failed });
  const first = async (q: { siteId: string; kind: Kind }) => {
    current = q;
    const my = ++seq;
    const key = recordsKey(context, q.siteId, q.kind);
    put({ ...RECORDS_INITIAL, key, phase: "loading" });
    const r = await api().read(q.siteId, q.kind, null);
    if (!same(my)) return; // another identity / site / kind (or a newer read): dropped
    const p = r.status === 200 ? parseRecords(r.body, q.siteId, q.kind) : null;
    if (!p) return fail(key, r.status, false);
    put({ key, phase: "ready", items: p.items, next: p.next, loadingMore: false, failed: null, error: "" });
  };
  const more = async () => {
    if (!alive || !current || state.phase !== "ready" || !state.next || state.loadingMore) return;
    const my = seq, q = current, cursor = state.next, key = state.key;
    put({ ...state, loadingMore: true, failed: null, error: "" });
    const r = await api().read(q.siteId, q.kind, cursor);
    if (!same(my)) return;
    if (r.status === 422) return void first(q); // invalid / expired cursor: restart at page 1
    const seen = new Set(state.items.map((x) => x.id.toLowerCase()));
    const p = r.status === 200 ? parseRecords(r.body, q.siteId, q.kind, state.items[state.items.length - 1] ?? null, seen) : null;
    if (!p) return fail(key, r.status, true);
    put({ ...state, loadingMore: false, items: [...state.items, ...p.items.filter((x) => !seen.has(x.id.toLowerCase()))], next: p.next });
  };
  return {
    /** Site or kind change ⇒ page 1 of the new key (cursor reset, never mixed). */
    query(siteId: string | null, kind: Kind) {
      if (!alive || identityOf(context) !== bound || !siteId || !UUID.test(siteId)) return;
      if (current && current.siteId === siteId && current.kind === kind) return;
      void first({ siteId, kind });
    },
    more: (key: string) => (state.key === key ? more() : Promise.resolve()),
    retry(key: string) {
      if (!current || state.key !== key) return;
      if (state.failed === "more") return void more();
      if (state.phase === "error") void first(current);
    },
    /** Re-read page 1 of the SAME key after a server-confirmed action. Always a FRESH read: the
     *  sequence is bumped, so any earlier read (page 1 or next page, even still loading) is ignored. */
    refresh(key: string) {
      if (!current || state.key !== key) return;
      void first(current);
    },
    get: () => state,
    stop() {
      alive = false;
    },
  };
}
