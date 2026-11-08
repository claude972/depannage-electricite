// ART-07 — artisan quotes list, pure model (no React). STRICT MIRROR of the backend contract
// 76151e2 / 42708ad (lib/features/artisan-quotes/handler.ts, docs/ARTISAN_QUOTES_BACKEND.md):
//   GET /api/artisan/quotes?status=all|sent|accepted|rejected[&cursor=…]   (limit: server default 50)
//   → { items: [{ id, intervention_id, status, total_cents, created_at, accepted_at,
//                 intervention: { id, category, status } }],
//       page: { limit, has_more, next_cursor }, order: "newest_first" }
//   Cursor opaque (never built here). 401 / 403 / 422 / 503 + Retry-After 2.
//   total_cents = the quote's own total (not paid, not amendments).
import { z } from "zod";

export const QUOTES_PATH = "/api/artisan/quotes";
export const QUOTE_FILTERS = ["all", "sent", "accepted", "rejected"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];
export type Context = { generation(): number; userId(): string | null };
export type Result = { status: number; body: unknown; retryAfter: number | null };

export const timestamp = z.iso
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
export const CATEGORY = z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]);
export const INTERVENTION_STATUS = z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]);
export const QUOTE_STATUS = z.enum(["sent", "accepted", "rejected"]);
const itemSchema = z
  .object({
    id: z.uuid(),
    intervention_id: z.uuid(),
    status: QUOTE_STATUS,
    total_cents: z.number().int().positive().max(10000000),
    created_at: timestamp,
    accepted_at: timestamp.nullable(),
    intervention: z.object({ id: z.uuid(), category: CATEGORY, status: INTERVENTION_STATUS }).strict(),
  })
  .strict();
export type QuoteItem = z.infer<typeof itemSchema>;
const replySchema = z
  .object({
    items: z.array(itemSchema).max(50),
    page: z
      .object({
        limit: z.number().int().min(1).max(50),
        has_more: z.boolean(),
        next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,600}$/).nullable(),
      })
      .strict(),
    order: z.literal("newest_first"),
  })
  .strict();
export type QuotesPage = z.infer<typeof replySchema>;

/** Exact keys, status of the filter, unique ids, coherent dossier ids, has_more ⇔ next_cursor. */
export function parseQuotes(body: unknown, filter: QuoteFilter): QuotesPage | null {
  const r = replySchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (p.items.length > p.page.limit) return null;
  if (filter !== "all" && p.items.some((i) => i.status !== filter)) return null;
  if (p.items.some((i) => i.intervention.id.toLowerCase() !== i.intervention_id.toLowerCase())) return null;
  if (new Set(p.items.map((i) => i.id.toLowerCase())).size !== p.items.length) return null;
  return p;
}

export const quotesUrl = (filter: QuoteFilter, cursor: string | null) =>
  `${QUOTES_PATH}?status=${filter}${cursor !== null ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

/** Retry-After in seconds (integer form only, bounded); null when absent or unreadable. */
export function retryAfterSeconds(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()), 300);
}

/** GET with a deadline; status 0 = network failure, -1 = timeout. Never throws. */
export async function getJson(fetcher: typeof fetch, url: string, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null, retryAfter: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      const retryAfter = retryAfterSeconds(r.headers?.get?.("Retry-After"));
      return { status: r.status, body: await r.json().catch(() => null), retryAfter };
    } catch {
      return { status: 0, body: null, retryAfter: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const QUOTES_COPY = {
  loading: "Chargement des devis…",
  loadFailed: "Les devis n’ont pas pu être vérifiés. Réessayez.",
  cursor: "La liste a changé ou n’est plus valable : elle repart de la première page.",
  session: "Votre session a expiré. Reconnectez-vous pour voir vos devis.",
  forbidden: "La liste des devis est réservée aux comptes artisans.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée. Réessayez.",
  empty: "Aucun devis dans cet état.",
  emptyAll: "Aucun devis pour le moment. Un devis se crée depuis une mission acceptée.",
} as const;
export const FILTER_LABEL: Record<QuoteFilter, string> = { all: "Tous", sent: "Envoyés", accepted: "Acceptés", rejected: "Refusés" };
export const QUOTE_STATUS_LABEL: Record<QuoteItem["status"], { label: string; tone: "blue" | "green" | "red" }> = {
  sent: { label: "Envoyé, en attente du client", tone: "blue" },
  accepted: { label: "Accepté", tone: "green" },
  rejected: { label: "Refusé par le client", tone: "red" },
};

export type QuotesState = {
  /** Identity + filter the state belongs to (render fence). */
  key: string;
  phase: "loading" | "ready" | "error" | "forbidden";
  items: QuoteItem[];
  next: string | null;
  loadingMore: boolean;
  error: string;
  moreError: string;
  /** Honest note after a refused cursor (422): the list restarted from page 1. */
  notice: string;
  /** Epoch ms before which « Réessayer » stays disabled (Retry-After). */
  retryAt: number;
};
export const quotesInitial = (key: string): QuotesState => ({ key, phase: "loading", items: [], next: null, loadingMore: false, error: "", moreError: "", notice: "", retryAt: 0 });
export const fenceKey = (ctx: Context, filter: QuoteFilter): string | null => {
  const uid = ctx.userId();
  return uid ? `${uid}|${ctx.generation()}|${filter}` : null;
};

/** One controller per (identity, filter); every reply is bound to identity + filter + sequence. */
export function createQuotes({ fetcher, filter, context, get, set, now = () => Date.now() }: { fetcher: () => typeof fetch; filter: QuoteFilter; context: Context; get: () => QuotesState; set: (s: QuotesState) => void; now?: () => number }) {
  let seq = 0;
  let alive = true;
  const key = fenceKey(context, filter) ?? "";
  const still = (my: number) => alive && my === seq && fenceKey(context, filter) === key;
  const fail = (status: number) => (status === 401 ? QUOTES_COPY.session : status === 403 ? QUOTES_COPY.forbidden : QUOTES_COPY.loadFailed);
  const wait = (r: Result) => (r.retryAfter ? now() + r.retryAfter * 1000 : 0);
  const first = async (notice = ""): Promise<void> => {
    const my = ++seq;
    set({ ...quotesInitial(key), notice });
    const r = await getJson(fetcher(), quotesUrl(filter, null));
    if (!still(my)) return; // stale: dropped
    if (r.status === 401 || r.status === 403) return set({ ...quotesInitial(key), phase: "forbidden", error: fail(r.status) });
    const p = r.status === 200 ? parseQuotes(r.body, filter) : null;
    if (!p) return set({ ...quotesInitial(key), phase: "error", error: fail(r.status), notice, retryAt: wait(r) });
    set({ ...quotesInitial(key), phase: "ready", items: p.items, next: p.page.next_cursor, notice });
  };
  return {
    key,
    load: () => first(),
    dispose() {
      alive = false;
      seq++;
    },
    async more(): Promise<void> {
      const s = get();
      if (s.key !== key || s.phase !== "ready" || s.loadingMore || !s.next || now() < s.retryAt) return;
      const my = seq;
      const cursor = s.next;
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await getJson(fetcher(), quotesUrl(filter, cursor));
      if (!still(my)) return;
      if (r.status === 422) return first(QUOTES_COPY.cursor); // cursor refused: honest restart at page 1
      if (r.status === 401 || r.status === 403) return set({ ...quotesInitial(key), phase: "forbidden", error: fail(r.status) });
      const p = r.status === 200 ? parseQuotes(r.body, filter) : null;
      if (!p) return set({ ...get(), loadingMore: false, moreError: QUOTES_COPY.moreFailed, retryAt: wait(r) });
      const seen = new Set(get().items.map((i) => i.id.toLowerCase()));
      const fresh = p.items.filter((i) => !seen.has(i.id.toLowerCase()) && (seen.add(i.id.toLowerCase()), true));
      set({ ...get(), items: [...get().items, ...fresh], next: p.page.next_cursor, loadingMore: false, moreError: "", retryAt: 0 });
    },
  };
}
