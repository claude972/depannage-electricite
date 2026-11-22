// Artisan mission history (live « En cours » / « Terminées ») — pure model, no React. STRICT MIRROR of
// the backend contract 6932c6f (lib/features/artisan-mission-history/handler.ts, not merged here):
//   GET /api/artisan/mission-history?filter=active|done[&cursor=…]
//   → { items, counts: { active, done }, filter, order: "newest_first", captured_at,
//       page: { limit: 50, has_more, next_cursor } }
//   item = exactly { id, category, address, city, urgency, status, created_at, completed_at, paid_at }
//   active = assigned / quoted / accepted / in_progress ; done = completed / paid (« Terminée » ≠ « payée »).
//   counts: exact over the whole scope, independent of filter and cursor, same snapshot as the page.
//   401 / 403 / 422 (invalid cursor or params) / 503.
import { z } from "zod";

export const HISTORY_PATH = "/api/artisan/mission-history";
export type HistoryFilter = "active" | "done";
export type Result = { status: number; body: unknown };
export type Context = { generation(): number; userId(): string | null };
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const ACTIVE = ["assigned", "quoted", "accepted", "in_progress"] as const;
const DONE = ["completed", "paid"] as const;
export const itemSchema = z
  .object({
    id: z.uuid(),
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
    address: z.string().min(5).max(500),
    city: z.string().min(2).max(120),
    urgency: z.enum(["urgent", "scheduled"]),
    status: z.enum([...ACTIVE, ...DONE]),
    created_at: timestamp,
    completed_at: timestamp.nullable(),
    paid_at: timestamp.nullable(),
  })
  .strict();
export type HistoryItem = z.infer<typeof itemSchema>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const replySchema = z
  .object({
    items: z.array(itemSchema).max(50),
    counts: z.object({ active: count, done: count }).strict(),
    filter: z.enum(["active", "done"]),
    order: z.literal("newest_first"),
    captured_at: timestamp,
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(600).nullable() }).strict(),
  })
  .strict();
export type HistoryPage = z.infer<typeof replySchema>;
export type Counts = HistoryPage["counts"];
/** Exact keys, filter echoed, statuses of the segment, unique ids, has_more ⇔ next_cursor. */
export function parseHistory(body: unknown, filter: HistoryFilter): HistoryPage | null {
  const r = replySchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.filter !== filter || p.page.has_more !== (p.page.next_cursor !== null)) return null;
  const allowed: readonly string[] = filter === "active" ? ACTIVE : DONE;
  if (p.items.some((i) => !allowed.includes(i.status))) return null;
  if (new Set(p.items.map((i) => i.id.toLowerCase())).size !== p.items.length) return null;
  return p;
}
export const historyUrl = (filter: HistoryFilter, cursor: string | null) =>
  `${HISTORY_PATH}?filter=${filter}${cursor !== null ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export async function fetchHistory(fetcher: typeof fetch, filter: HistoryFilter, cursor: string | null, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(historyUrl(filter, cursor), { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const HISTORY_COPY = {
  loading: "Chargement des missions…",
  loadFailed: "Les missions n’ont pas pu être vérifiées. Réessayez.",
  cursor: "La liste a changé ou n’est plus valable : elle repart de la première page.",
  session: "Votre session a expiré. Reconnectez-vous.",
  forbidden: "Cet historique est réservé aux comptes artisans.",
  more: "Afficher plus",
  refresh: "Actualiser",
  moreFailed: "La suite n’a pas pu être chargée. Réessayez.",
} as const;
/** Live labels: the server's exact counts once read, otherwise no number (never the 100-row cache). */
export function historyLabel(filter: HistoryFilter, counts: Counts | null): string {
  const base = filter === "active" ? "En cours" : "Terminées";
  return counts ? `${base} (${counts[filter]})` : base;
}

export type HistoryState = {
  phase: "loading" | "ready" | "error" | "forbidden";
  items: HistoryItem[];
  next: string | null;
  loadingMore: boolean;
  error: string;
  moreError: string;
  /** Honest note after a refused cursor (422): the list restarted from page 1. */
  notice: string;
};
export const HISTORY_INITIAL: HistoryState = { phase: "loading", items: [], next: null, loadingMore: false, error: "", moreError: "", notice: "" };

/** One controller per (identity, segment) mount; every reply is bound to identity + sequence. */
export function createHistory({ fetcher, filter, context, get, set, onCounts, onForbidden }: { fetcher: () => typeof fetch; filter: HistoryFilter; context: Context; get: () => HistoryState; set: (s: HistoryState) => void; onCounts: (c: Counts) => void; /** 401/403: the host drops the counts it holds. */ onForbidden?: () => void }) {
  let seq = 0;
  let alive = true;
  const fail = (status: number) => (status === 401 ? HISTORY_COPY.session : status === 403 ? HISTORY_COPY.forbidden : HISTORY_COPY.loadFailed);
  const forbid = (status: number) => {
    onForbidden?.();
    set({ ...HISTORY_INITIAL, phase: "forbidden", error: fail(status) });
  };
  const first = async (notice = ""): Promise<void> => {
    const my = ++seq;
    const uid = context.userId(), gen = context.generation();
    set({ ...HISTORY_INITIAL, notice });
    const r = await fetchHistory(fetcher(), filter, null);
    if (!alive || my !== seq || context.userId() !== uid || context.generation() !== gen) return; // stale: dropped
    if (r.status === 401 || r.status === 403) return forbid(r.status);
    const p = r.status === 200 ? parseHistory(r.body, filter) : null;
    if (!p) return set({ ...HISTORY_INITIAL, phase: "error", error: fail(r.status), notice });
    onCounts(p.counts);
    set({ ...HISTORY_INITIAL, phase: "ready", items: p.items, next: p.page.next_cursor, notice });
  };
  return {
    load: () => first(),
    dispose() {
      alive = false;
      seq++;
    },
    async more(): Promise<void> {
      const s = get();
      if (s.phase !== "ready" || s.loadingMore || !s.next) return;
      const my = seq;
      const uid = context.userId(), gen = context.generation();
      const cursor = s.next;
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await fetchHistory(fetcher(), filter, cursor);
      if (!alive || my !== seq || context.userId() !== uid || context.generation() !== gen) return;
      if (r.status === 422) return first(HISTORY_COPY.cursor); // cursor refused: honest restart at page 1
      if (r.status === 401 || r.status === 403) return forbid(r.status);
      const p = r.status === 200 ? parseHistory(r.body, filter) : null;
      if (!p) return set({ ...get(), loadingMore: false, moreError: HISTORY_COPY.moreFailed });
      onCounts(p.counts);
      const seen = new Set(get().items.map((i) => i.id.toLowerCase()));
      const fresh = p.items.filter((i) => !seen.has(i.id.toLowerCase()) && (seen.add(i.id.toLowerCase()), true));
      set({ ...get(), items: [...get().items, ...fresh], next: p.page.next_cursor, loadingMore: false, moreError: "" });
    },
  };
}
