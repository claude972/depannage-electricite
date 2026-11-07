// Client « Mes demandes » server search — pure model + controller (no React). ROOT contract:
//   POST /api/client/interventions/search  { filter: "active"|"all"|"past", search, cursor: string|null }
//   → { items: [{ id, category, address, postal_code, city, urgency, status, estimate_min_cents,
//        estimate_max_cents, created_at }], total, page: { limit: 50, has_more, next_cursor } }
// The query and the address never go in the URL (JSON body). Results are private: memory only, never
// stored, never in the URL. Every request is bound to the identity (uid + generation), the filter, the
// trimmed search and a sequence number; a reply for anything else is dropped. Search is debounced
// (~300 ms), a filter change applies at once; « Afficher plus » appends by cursor (deduped by id) and
// any change resets it. 401/403 clear the results.
import { z } from "zod";

export const SEARCH_PATH = "/api/client/interventions/search";
export const SEARCH_TIMEOUT_MS = 15_000;
export const SEARCH_TIMEOUT = -1;
export const DEBOUNCE_MS = 300;
export type Filter = "active" | "all" | "past";
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = z.string().refine((x) => Number.isFinite(Date.parse(x)));
const cents = z.number().int().min(0).max(2147483647);
const item = z
  .object({
    id: z.string().regex(UUID),
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
    address: z.string().max(500),
    postal_code: z.string().max(20),
    city: z.string().max(200),
    urgency: z.enum(["urgent", "scheduled"]),
    status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]),
    estimate_min_cents: cents,
    estimate_max_cents: cents,
    created_at: time,
  })
  .strict();
export type SearchItem = z.infer<typeof item>;
const reply = z
  .object({
    items: z.array(item).max(50),
    total: z.number().int().nonnegative(),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(1000).nullable() }).strict(),
  })
  .strict();
export type SearchPage = z.infer<typeof reply>;

/** Strict: exact keys, ≤ 50 unique items, has_more ⇔ next_cursor, total ≥ items shown so far. */
export function parsePage(body: unknown, alreadyShown = 0): SearchPage | null {
  const r = reply.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  const ids = p.items.map((x) => x.id);
  if (new Set(ids).size !== ids.length) return null;
  if (p.total < alreadyShown + p.items.length) return null;
  return p;
}
/** Shape expected by the existing RequestList (it never reads `description`). */
export const toListRows = (items: SearchItem[]) => items.map((x) => ({ ...x, description: "" }));

async function timed(fetcher: typeof fetch, body: string, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: SEARCH_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(SEARCH_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? SEARCH_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type SearchBody = { filter: Filter; search: string; cursor: string | null };
export type SearchApi = { search(body: SearchBody): Promise<Result> };
export function createSearchApi(fetcher: typeof fetch = (...a) => fetch(...a)): SearchApi {
  return { search: (b) => timed(fetcher, JSON.stringify({ filter: b.filter, search: b.search, cursor: b.cursor }), SEARCH_TIMEOUT_MS) };
}

export const COPY = {
  loading: "Recherche de vos demandes…",
  failed: "Vos demandes n’ont pas pu être chargées. Réessayez.",
  moreFailed: "La suite de la liste n’a pas pu être chargée. Réessayez.",
  forbidden: "Votre session ne permet plus de lire vos demandes. Reconnectez-vous pour les retrouver.",
  more: "Afficher plus",
} as const;

export type SearchState = {
  phase: "idle" | "loading" | "ready" | "error" | "forbidden";
  items: SearchItem[];
  total: number;
  cursor: string | null;
  loadingMore: boolean;
  /** Which read failed (retry target). */
  failed: "first" | "more" | null;
  error: string;
};
export const SEARCH_INITIAL: SearchState = { phase: "idle", items: [], total: 0, cursor: null, loadingMore: false, failed: null, error: "" };
export type Context = { generation(): number; userId(): string | null };
export type Timers = { set(f: () => void, ms: number): unknown; clear(handle: unknown): void };

export function createSearchController({ api, context, set, timers, delayMs = DEBOUNCE_MS }: { api: () => SearchApi; context: Context; set: (s: SearchState) => void; timers: Timers; delayMs?: number }) {
  let alive = true;
  let state: SearchState = { ...SEARCH_INITIAL };
  let seq = 0;
  let current: { filter: Filter; search: string } | null = null;
  let timer: unknown = null;
  const identity = () => `${context.userId() ?? "-"}|${context.generation()}`;
  const bound = identity();
  const put = (s: SearchState) => {
    state = s;
    if (alive) set(s);
  };
  const valid = (my: number, key: { filter: Filter; search: string }) => alive && my === seq && identity() === bound && current !== null && current.filter === key.filter && current.search === key.search;
  const cancelTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const first = async (my: number, key: { filter: Filter; search: string }) => {
    if (!valid(my, key)) return;
    const r = await api().search({ filter: key.filter, search: key.search, cursor: null });
    if (!valid(my, key)) return; // stale sequence, other identity or other filters: dropped
    if (r.status === 401 || r.status === 403) return put({ ...SEARCH_INITIAL, phase: "forbidden", error: COPY.forbidden });
    const p = r.status === 200 ? parsePage(r.body) : null;
    if (!p) return put({ ...SEARCH_INITIAL, phase: "error", failed: "first", error: COPY.failed });
    put({ phase: "ready", items: p.items, total: p.total, cursor: p.page.next_cursor, loadingMore: false, failed: null, error: "" });
  };
  const start = (key: { filter: Filter; search: string }, debounce: boolean) => {
    cancelTimer();
    current = key;
    const my = ++seq;
    put({ ...SEARCH_INITIAL, phase: "loading" });
    if (debounce) timer = timers.set(() => ((timer = null), void first(my, key)), delayMs);
    else void first(my, key);
  };
  const more = async () => {
      if (!alive || !current || state.phase !== "ready" || !state.cursor || state.loadingMore) return;
      const my = seq, key = current, cursor = state.cursor;
      put({ ...state, loadingMore: true, failed: null, error: "" });
      const r = await api().search({ filter: key.filter, search: key.search, cursor });
      if (!valid(my, key)) return;
      if (r.status === 401 || r.status === 403) return put({ ...SEARCH_INITIAL, phase: "forbidden", error: COPY.forbidden });
      const p = r.status === 200 ? parsePage(r.body) : null;
      const seen = new Set(state.items.map((x) => x.id));
      const merged = p ? [...state.items, ...p.items.filter((x) => !seen.has(x.id))] : [];
      // total must cover every distinct item shown after the append.
      if (!p || p.total < merged.length) return put({ ...state, loadingMore: false, failed: "more", error: COPY.moreFailed });
      put({ ...state, loadingMore: false, items: merged, total: p.total, cursor: p.page.next_cursor });
    };
  return {
    more,
    /** Filter change ⇒ immediate; search change ⇒ debounced; same query ⇒ nothing. */
    query(filter: Filter, search: string) {
      if (!alive || identity() !== bound) return;
      const key = { filter, search: search.trim() };
      if (current && current.filter === key.filter && current.search === key.search) return;
      start(key, !!current && current.filter === key.filter);
    },
    retry() {
      if (!current || state.loadingMore) return;
      if (state.failed === "more") return void more();
      const key = current;
      current = null;
      start(key, false);
    },
    get: () => state,
    stop() {
      alive = false;
      cancelTimer();
    },
  };
}
