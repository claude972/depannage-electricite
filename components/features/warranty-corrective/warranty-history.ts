// ADM-10 / PUB-06 — warranty history, pure model (no React). STRICT MIRROR of the Astra contract
// b8301be (docs/WARRANTY_HISTORY_BACKEND.md) and handler cd68874 (lib/features/warranty-history):
//   GET /api/warranty[?intervention_id=UUID][&cursor=opaque]
//     → { cases, enabled, next_cursor: string|null, has_active: boolean|null }
//   100 cases max per page, created_at DESC then UUID DESC. Without filter has_active = null (no
//   global claim); with filter, an exact boolean proved independently of the current page.
//   Case = id, intervention_id, client_id, description, status, resolution, created_at, updated_at,
//   terms_version. 404 = dossier absent or not accessible (even without cases); 422 = params/cursor;
//   503 + Retry-After 2. Cursor bound to the account and filter: opaque, never built here.
import { z } from "zod";

export type Context = { generation(): number; userId(): string | null };
export type Result = { status: number; body: unknown; retryAfter: number | null };
// Same timestamp shape as the handler (cd68874): offset required, at most microseconds.
const ts = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
/** Opaque base64url cursor as issued by the handler (≤ 600 chars). */
export const CURSOR = /^[A-Za-z0-9_-]{1,600}$/;
export const ACTIVE_STATUSES = ["submitted", "reviewing"] as const;
const caseSchema = z
  .object({
    id: z.uuid(),
    intervention_id: z.uuid(),
    client_id: z.uuid(),
    description: z.string().min(10).max(4000),
    status: z.enum(["submitted", "reviewing", "resolved", "declined"]),
    resolution: z.string().max(4000),
    created_at: ts,
    updated_at: ts,
    terms_version: z.number().int().positive().nullable(),
  })
  .strict();
export type HistoryCase = z.infer<typeof caseSchema>;
const pageSchema = z
  .object({
    cases: z.array(caseSchema).max(100),
    enabled: z.boolean(),
    next_cursor: z.string().regex(CURSOR).nullable(),
    has_active: z.boolean().nullable(),
  })
  .strict();
export type HistoryPage = z.infer<typeof pageSchema>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isActive = (c: HistoryCase) => (ACTIVE_STATUSES as readonly string[]).includes(c.status);

/**
 * Strict page check: with a dossier filter every case is of THAT dossier and has_active is a boolean
 * consistent with the page (an active case listed ⇒ true); without filter has_active is null.
 */
export function parseHistory(body: unknown, interventionId: string | null): HistoryPage | null {
  const r = pageSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (new Set(p.cases.map((c) => c.id.toLowerCase())).size !== p.cases.length) return null;
  if (interventionId === null) return p.has_active === null ? p : null;
  if (p.has_active === null) return null;
  if (p.cases.some((c) => !same(c.intervention_id, interventionId))) return null;
  if (p.has_active === false && p.cases.some(isActive)) return null;
  return p;
}

export function historyUrl(interventionId: string | null, cursor: string | null): string {
  const q = new URLSearchParams();
  if (interventionId) q.set("intervention_id", interventionId);
  if (cursor) q.set("cursor", cursor);
  const s = q.toString();
  return `/api/warranty${s ? `?${s}` : ""}`;
}

export function retryAfterSeconds(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()), 300);
}
/** GET with a deadline; status 0 = network failure, -1 = timeout. Never throws. */
export async function getHistory(fetcher: typeof fetch, url: string, timeoutMs = 15_000): Promise<Result> {
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
      return { status: r.status, body: await r.json().catch(() => null), retryAfter: retryAfterSeconds(r.headers?.get?.("Retry-After")) };
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

export const HISTORY_COPY = {
  loading: "Chargement du suivi…",
  failed: "Le suivi n’a pas pu être vérifié. Réessayez.",
  session: "Votre session a expiré. Reconnectez-vous pour voir le suivi.",
  forbidden: "Ce suivi n’est pas accessible avec votre compte.",
  notFound: "Ce dossier est inaccessible depuis votre compte : aucun suivi n’est affiché.",
  cursor: "La liste a changé ou n’est plus valable : elle repart de la première page.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée. Réessayez.",
  empty: "Aucune demande de suivi enregistrée.",
  disabled: "Le dépôt des demandes n’est pas activé par l’exploitant pour le moment.",
  active: "Une demande de suivi est déjà en cours pour ce dossier.",
} as const;
export const refusal = (status: number): string | null =>
  status === 401 ? HISTORY_COPY.session : status === 403 ? HISTORY_COPY.forbidden : status === 404 ? HISTORY_COPY.notFound : null;

export type HistoryState = {
  /** identity | dossier | reload: shown only under this exact key. */
  key: string;
  phase: "loading" | "ready" | "error" | "refused";
  cases: HistoryCase[];
  enabled: boolean | null;
  hasActive: boolean | null;
  next: string | null;
  loadingMore: boolean;
  error: string;
  moreError: string;
  notice: string;
  retryAt: number;
};
export const historyInitial = (key: string): HistoryState => ({ key, phase: "loading", cases: [], enabled: null, hasActive: null, next: null, loadingMore: false, error: "", moreError: "", notice: "", retryAt: 0 });
export const identityKey = (ctx: Context, interventionId: string | null): string | null => {
  const uid = ctx.userId();
  return uid ? `${uid}|${ctx.generation()}|${interventionId?.toLowerCase() ?? "*"}` : null;
};

/**
 * The REAL claim form is offered only on server proof for THIS dossier: a ready page, requests
 * enabled, and has_active exactly false. Never while loading, on error, refused or without filter.
 */
export const claimAllowed = (s: HistoryState, interventionId: string | null | undefined) =>
  Boolean(interventionId) && s.phase === "ready" && s.enabled === true && s.hasActive === false;

/** One controller per (identity, dossier, reload); replies bound to that key + sequence. */
export function createHistory({ fetcher, interventionId, context, key, get, set, now = () => Date.now() }: { fetcher: () => typeof fetch; interventionId: string | null; context: Context; key: string; get: () => HistoryState; set: (s: HistoryState) => void; now?: () => number }) {
  let seq = 0;
  let alive = true;
  const base = identityKey(context, interventionId);
  const still = (my: number) => alive && my === seq && identityKey(context, interventionId) === base;
  const wait = (r: Result) => (r.retryAfter ? now() + r.retryAfter * 1000 : 0);
  const first = async (notice = ""): Promise<void> => {
    const my = ++seq;
    set({ ...historyInitial(key), notice });
    const r = await getHistory(fetcher(), historyUrl(interventionId, null));
    if (!still(my)) return;
    const refused = refusal(r.status);
    if (refused) return set({ ...historyInitial(key), phase: "refused", error: refused });
    const p = r.status === 200 ? parseHistory(r.body, interventionId) : null;
    if (!p) return set({ ...historyInitial(key), phase: "error", error: HISTORY_COPY.failed, notice, retryAt: wait(r) });
    set({ ...historyInitial(key), phase: "ready", cases: p.cases, enabled: p.enabled, hasActive: p.has_active, next: p.next_cursor, notice });
  };
  return {
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
      const r = await getHistory(fetcher(), historyUrl(interventionId, cursor));
      if (!still(my)) return;
      if (r.status === 422) return first(HISTORY_COPY.cursor);
      const refused = refusal(r.status);
      if (refused) return set({ ...historyInitial(key), phase: "refused", error: refused });
      const p = r.status === 200 ? parseHistory(r.body, interventionId) : null;
      if (!p) return set({ ...get(), loadingMore: false, moreError: HISTORY_COPY.moreFailed, retryAt: wait(r) });
      const seen = new Set(get().cases.map((c) => c.id.toLowerCase()));
      const fresh = p.cases.filter((c) => !seen.has(c.id.toLowerCase()) && (seen.add(c.id.toLowerCase()), true));
      // enabled / has_active are re-proved by every page: the latest proof wins.
      set({ ...get(), cases: [...get().cases, ...fresh], enabled: p.enabled, hasActive: p.has_active, next: p.next_cursor, loadingMore: false, moreError: "", retryAt: 0 });
    },
  };
}
