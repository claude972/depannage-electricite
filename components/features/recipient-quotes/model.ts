// CLI-08 / ENT-12 recipient quotes — pure model + controllers (no React). Contract (read-only):
// docs/RECIPIENT_QUOTES_BACKEND.md (codex/recipient-quotes d8cde0a; strict browser mirror):
//   GET /api/quotes?status=all|sent|accepted|rejected&cursor=  (current client only)
//     → { items, page: { limit: 50, has_more, next_cursor } }   created_at DESC, UUID DESC (µs)
//     item { id, intervention_id, total_cents, status, created_at, intervention: { id, category, status, site_id } }
//   GET /api/quotes/<id>  (client owner) | ?organization_id=&site_id= (manager; organization required)
//     → { quote: ART-07 DTO, intervention: { id, category, status, site_id }, version: { current_quote_id, is_current } }
// `is_current` is INFORMATION only, never a permission: the existing guards decide every action and an
// old / superseded quote is read-only. Bound at render to identity (+ organization + site) + quote id;
// late replies dropped; 401/403/404 ⇒ cleared + inaccessible; 422 on a next page ⇒ page 1.
import { z } from "zod";
import { isTaxRate } from "../../../lib/tax-rates";

export const QUOTES_LIMIT = 50;
export type QuoteFilter = "all" | "sent" | "accepted" | "rejected";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const stamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quoteStatus = z.enum(["sent", "accepted", "rejected"]);
const intervention = z
  .object({ id, category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]), site_id: id.nullable() })
  .strict();
const item = z.object({ id, intervention_id: id, total_cents: cents, status: quoteStatus, created_at: stamp, intervention }).strict();
export type QuoteItem = z.infer<typeof item>;
const line = z.object({ label: z.string().min(1).max(200), quantity: z.number().positive().max(10000), unit_price_cents: cents }).strict();
const quote = z
  .object({ id, intervention_id: id, artisan_id: id.nullable(), lines: z.array(line).min(1).max(100), subtotal_cents: cents, tax_rate: z.number().refine(isTaxRate), tax_cents: cents, total_cents: cents, status: quoteStatus, created_at: stamp, accepted_at: stamp.nullable() })
  .strict();
export type ExactQuote = z.infer<typeof quote>;
const listSchema = z
  .object({ items: z.array(item).max(QUOTES_LIMIT), page: z.object({ limit: z.literal(QUOTES_LIMIT), has_more: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,700}$/).nullable() }).strict() })
  .strict();
const detailSchema = z.object({ quote, intervention, version: z.object({ current_quote_id: id.nullable(), is_current: z.boolean() }).strict() }).strict();
export type QuoteDetail = z.infer<typeof detailSchema>;
const lower = (x: string) => x.toLowerCase();
/** Microsecond-exact instant (the server keeps microseconds). */
export function micros(ts: string): number {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(ts);
  return m ? Date.parse(`${m[1]}${m[3]}`) * 1000 + Number((m[2] ?? "").padEnd(6, "0")) : NaN;
}
export function parseList(body: unknown, status: QuoteFilter, after: QuoteItem | null = null, seen: ReadonlySet<string> = new Set()): { items: QuoteItem[]; next: string | null } | null {
  const r = listSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  const ids = p.items.map((x) => lower(x.id));
  if (new Set(ids).size !== ids.length) return null;
  let prev = after;
  for (const x of p.items) {
    if (lower(x.intervention.id) !== lower(x.intervention_id) || (status !== "all" && x.status !== status)) return null;
    if (seen.has(lower(x.id))) continue;
    if (prev) {
      const d = micros(x.created_at) - micros(prev.created_at);
      const order = d || (lower(x.id) < lower(prev.id) ? -1 : lower(x.id) > lower(prev.id) ? 1 : 0);
      if (order >= 0) return null;
    }
    prev = x;
  }
  return { items: p.items, next: p.page.next_cursor };
}
/** Exact quote asked, consistent joins, and is_current consistent with current_quote_id. */
export function parseDetail(body: unknown, quoteId: string): QuoteDetail | null {
  const r = detailSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.quote.id) !== lower(quoteId) || lower(d.intervention.id) !== lower(d.quote.intervention_id)) return null;
  if (d.version.is_current !== (d.version.current_quote_id !== null && lower(d.version.current_quote_id) === lower(d.quote.id))) return null;
  return d;
}
export const listUrl = (status: QuoteFilter, cursor: string | null) => {
  const q = [status !== "all" ? `status=${status}` : "", cursor ? `cursor=${encodeURIComponent(cursor)}` : ""].filter(Boolean).join("&");
  return `/api/quotes${q ? `?${q}` : ""}`;
};
/** Client: no parameter. Manager: organization required, site when a site context is active. */
export const detailUrl = (quoteId: string, scope: { org: string; site: string | null } | null) =>
  `/api/quotes/${encodeURIComponent(quoteId)}${scope ? `?organization_id=${encodeURIComponent(scope.org)}${scope.site ? `&site_id=${encodeURIComponent(scope.site)}` : ""}` : ""}`;

export type Result = { status: number; body: unknown };
export type QuotesApi = { get(url: string): Promise<Result> };
export function createQuotesApi(fetcher: typeof fetch = (...a) => fetch(...a)): QuotesApi {
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
export const QUOTES_COPY = {
  loading: "Lecture des devis…",
  loadingOne: "Lecture du devis…",
  failed: "Les devis n’ont pas pu être lus. Réessayez.",
  failedOne: "Ce devis n’a pas pu être lu. Réessayez.",
  moreFailed: "La suite n’a pas pu être lue. Réessayez.",
  inaccessible: "Ces devis ne sont pas (ou plus) accessibles avec votre compte.",
  inaccessibleOne: "Ce devis est introuvable ou inaccessible avec votre compte.",
  chooseOrg: "Choisissez une organisation pour ouvrir ce devis.",
  more: "Afficher plus",
  readOnly: "Version en lecture seule : aucune action n’est possible sur cette version.",
  openDossierToAct: "Ce devis n’est pas parmi les dossiers chargés : ouvrez le dossier pour accepter ou refuser la version en cours.",
} as const;
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;

export type ListState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; items: QuoteItem[]; next: string | null; loadingMore: boolean; failed: "first" | "more" | null; error: string };
export const LIST_INITIAL: ListState = { key: "", phase: "idle", items: [], next: null, loadingMore: false, failed: null, error: "" };
export const listKey = (c: Context, status: QuoteFilter) => `${identityOf(c)}|${status}`;
export const listView = (s: ListState, key: string): ListState => (s.key === key ? s : { ...LIST_INITIAL, key, phase: "loading" });

export function createListController({ api, context, set }: { api: () => QuotesApi; context: Context; set: (s: ListState) => void }) {
  let alive = true, seq = 0;
  let state: ListState = { ...LIST_INITIAL };
  let current: QuoteFilter | null = null;
  const bound = identityOf(context);
  const put = (s: ListState) => ((state = s), alive && set(s));
  const same = (my: number) => alive && my === seq && identityOf(context) === bound;
  const refused = (st: number) => st === 401 || st === 403 || st === 404;
  const first = async (status: QuoteFilter) => {
    current = status;
    const my = ++seq, key = listKey(context, status);
    put({ ...LIST_INITIAL, key, phase: "loading" });
    const r = await api().get(listUrl(status, null));
    if (!same(my)) return;
    if (refused(r.status)) return put({ ...LIST_INITIAL, key, phase: "forbidden", error: QUOTES_COPY.inaccessible });
    const p = r.status === 200 ? parseList(r.body, status) : null;
    if (!p) return put({ ...LIST_INITIAL, key, phase: "error", failed: "first", error: QUOTES_COPY.failed });
    put({ key, phase: "ready", items: p.items, next: p.next, loadingMore: false, failed: null, error: "" });
  };
  const more = async () => {
    if (!alive || current === null || state.phase !== "ready" || !state.next || state.loadingMore) return;
    const my = seq, status = current, key = state.key;
    put({ ...state, loadingMore: true, failed: null, error: "" });
    const r = await api().get(listUrl(status, state.next));
    if (!same(my)) return;
    if (refused(r.status)) return put({ ...LIST_INITIAL, key, phase: "forbidden", error: QUOTES_COPY.inaccessible });
    if (r.status === 422) return void first(status);
    const seen = new Set(state.items.map((x) => lower(x.id)));
    const p = r.status === 200 ? parseList(r.body, status, state.items[state.items.length - 1] ?? null, seen) : null;
    if (!p) return put({ ...state, loadingMore: false, failed: "more", error: QUOTES_COPY.moreFailed });
    put({ ...state, loadingMore: false, items: [...state.items, ...p.items.filter((x) => !seen.has(lower(x.id)))], next: p.next });
  };
  return {
    query(status: QuoteFilter) {
      if (!alive || identityOf(context) !== bound || current === status) return;
      void first(status);
    },
    more: (key: string) => (state.key === key ? more() : Promise.resolve()),
    retry(key: string) {
      if (current === null || state.key !== key) return;
      if (state.failed === "more") return void more();
      if (state.phase === "error") void first(current);
    },
    stop() {
      alive = false;
    },
  };
}

export type DetailState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; data: QuoteDetail | null; error: string; /** 404 (absent / foreign / outside the scope) vs 401/403. */ notFound: boolean };
export const DETAIL_INITIAL: DetailState = { key: "", phase: "idle", data: null, error: "", notFound: false };
export const detailKey = (c: Context, quoteId: string | null, scope: { org: string | null; site: string | null } | null) =>
  !quoteId || (scope && !scope.org) ? "" : `${identityOf(c)}|${scope ? `${lower(scope.org!)}|${scope.site ? lower(scope.site) : "-"}` : "client"}|${lower(quoteId)}`;
export const detailView = (s: DetailState, key: string): DetailState => (s.key === key ? s : { ...DETAIL_INITIAL, key, phase: key ? "loading" : "idle" });

export function createDetailController({ api, context, set }: { api: () => QuotesApi; context: Context; set: (s: DetailState) => void }) {
  let alive = true, seq = 0;
  let state: DetailState = { ...DETAIL_INITIAL };
  let current: { quoteId: string; scope: { org: string; site: string | null } | null } | null = null;
  const bound = identityOf(context);
  const put = (s: DetailState) => ((state = s), alive && set(s));
  const run = async (q: { quoteId: string; scope: { org: string; site: string | null } | null }) => {
    current = q;
    const my = ++seq, key = detailKey(context, q.quoteId, q.scope);
    put({ ...DETAIL_INITIAL, key, phase: "loading" });
    const r = await api().get(detailUrl(q.quoteId, q.scope));
    if (!alive || my !== seq || identityOf(context) !== bound) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return put({ ...DETAIL_INITIAL, key, phase: "forbidden", error: QUOTES_COPY.inaccessibleOne, notFound: r.status === 404 });
    const d = r.status === 200 ? parseDetail(r.body, q.quoteId) : null;
    if (!d) return put({ ...DETAIL_INITIAL, key, phase: "error", error: QUOTES_COPY.failedOne });
    put({ key, phase: "ready", data: d, error: "", notFound: false });
  };
  return {
    query(quoteId: string | null, scope: { org: string | null; site: string | null } | null) {
      if (!alive || identityOf(context) !== bound || !quoteId || !UUID.test(quoteId)) return;
      if (scope && (!scope.org || !UUID.test(scope.org) || (scope.site !== null && !UUID.test(scope.site)))) return;
      const sc = scope ? { org: scope.org!, site: scope.site } : null;
      if (current && current.quoteId === quoteId && JSON.stringify(current.scope) === JSON.stringify(sc)) return;
      void run({ quoteId, scope: sc });
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    refresh(key: string) {
      if (current && state.key === key) void run(current);
    },
    stop() {
      alive = false;
    },
  };
}
