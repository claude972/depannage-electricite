// Available missions (artisan) — pure model (no React): API client, strict parse of
// GET /api/artisan/missions (contract of lib/features/artisan-missions/schema.ts, read-only: its
// offer schema is reused), and the list / point-read / accept controller.
//   GET /api/artisan/missions[?cursor=<opaque>|?id=<uuid>] → { items ≤50 (anonymized), eligible,
//   captured_at, page: { limit: 50, has_more, next_cursor }, projection: "anonymized",
//   order: "oldest_first", distance: "not_calculated" }
// No total count, no distance, no private field (address, contact, description) before acceptance.
import { z } from "zod";
import { missionOfferSchema, type MissionOffer } from "../../../lib/features/artisan-missions/schema";

export type { MissionOffer };
export type MissionsResult = { status: number; body: unknown; retryAfter: number | null };
export type MissionsApi = { list(cursor: string | null): Promise<MissionsResult>; point(id: string): Promise<MissionsResult> };
export type MissionsContext = { generation(): number; userId(): string | null };
export const DEFAULT_MISSIONS_CONTEXT: MissionsContext = { generation: () => 0, userId: () => null };
export const MISSIONS_PATH = "/api/artisan/missions";
export const MISSIONS_TIMEOUT_MS = 15_000;
export const MISSIONS_TIMEOUT = -1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function timed(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<MissionsResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: MissionsResult = { status: MISSIONS_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<MissionsResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<MissionsResult> => {
    try {
      const response = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch (error) {
      if (controller?.signal.aborted) return timedOut;
      throw error;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
/** Same-origin GET only; the cursor is sent exactly as received (opaque base64url). */
export function createMissionsApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = MISSIONS_TIMEOUT_MS } = {}): MissionsApi {
  return {
    list: (cursor) => timed(fetcher, cursor === null ? MISSIONS_PATH : `${MISSIONS_PATH}?cursor=${encodeURIComponent(cursor)}`, timeoutMs),
    point: (id) => timed(fetcher, `${MISSIONS_PATH}?id=${encodeURIComponent(id)}`, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const pageSchema = z
  .object({
    items: z.array(missionOfferSchema).max(50),
    eligible: z.boolean(),
    captured_at: z.iso.datetime({ offset: true }),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(400).nullable() }).strict(),
    projection: z.literal("anonymized"),
    order: z.literal("oldest_first"),
    distance: z.literal("not_calculated"),
  })
  .strict();
export type MissionsPageDTO = z.infer<typeof pageSchema>;
/** Anything off-contract ⇒ null (an error, never an empty list). */
export function parseMissionsPage(body: unknown): MissionsPageDTO | null {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (!p.eligible && (p.items.length || p.page.has_more)) return null;
  if (new Set(p.items.map((i) => i.id)).size !== p.items.length) return null;
  return p;
}
export function parsePoint(body: unknown, id: string): MissionOffer | null {
  const p = parseMissionsPage(body);
  if (!p || !p.eligible || p.items.length !== 1 || p.items[0].id.toLowerCase() !== id.toLowerCase()) return null;
  return p.items[0];
}

// ---- Wording --------------------------------------------------------------------------------------
export const MISSIONS_COPY = {
  loading: "Chargement des offres…",
  loadFailed: "Les offres n’ont pas pu être vérifiées. Réessayez.",
  session: "Votre session a expiré. Reconnectez-vous.",
  forbidden: "Les offres sont réservées aux comptes artisans.",
  ineligible:
    "Aucune offre ne vous est proposée pour le moment : votre compte n’est pas disponible pour de nouvelles missions (disponibilité en pause, compte suspendu ou candidature non approuvée).",
  empty: "Aucune offre ne correspond à vos zones et à vos compétences pour le moment.",
  gone: "Cette offre n’est plus disponible avec vos droits actuels.",
  moreFailed: "La suite des offres n’a pas pu être chargée. Réessayez.",
  anonymized: "Offres anonymisées : l’adresse, le contact et la description sont transmis après acceptation. Distance non calculée.",
  acceptFailed: "L’acceptation n’a pas été confirmée. Vérifiez la liste : l’offre a pu être prise par un autre artisan.",
} as const;
export const shownCount = (n: number, hasMore: boolean) => `${n} offre${n > 1 ? "s" : ""} affichée${n > 1 ? "s" : ""}${hasMore ? " · il y en a d’autres" : ""}`;

// ---- State + controller ---------------------------------------------------------------------------
export type PointState = { id: string; phase: "loading" | "ready" | "gone" | "error"; offer: MissionOffer | null };
export type MissionsState = {
  phase: "loading" | "ready" | "error";
  eligible: boolean;
  items: MissionOffer[];
  /** captured_at of every loaded page, in order (each page is its own snapshot). */
  captured: string[];
  page: MissionsPageDTO["page"] | null;
  error: string;
  loadingMore: boolean;
  moreError: string;
  point: PointState | null;
  accepting: string | null;
  acceptError: string;
};
export const MISSIONS_INITIAL: MissionsState = { phase: "loading", eligible: false, items: [], captured: [], page: null, error: "", loadingMore: false, moreError: "", point: null, accepting: null, acceptError: "" };

const failure = (status: number) => (status === 401 ? MISSIONS_COPY.session : status === 403 ? MISSIONS_COPY.forbidden : MISSIONS_COPY.loadFailed);
export function applyFirst(s: MissionsState, r: MissionsResult): MissionsState {
  const p = r.status === 200 ? parseMissionsPage(r.body) : null;
  if (!p) return { ...s, phase: "error", items: [], captured: [], page: null, error: failure(r.status) };
  return { ...s, phase: "ready", eligible: p.eligible, items: p.items, captured: [p.captured_at], page: p.page, error: "", moreError: "" };
}
/** Next page: appended with dedup by id; a 422 (cursor refused) is handled by the controller. */
export function applyMore(s: MissionsState, r: MissionsResult): MissionsState {
  const p = r.status === 200 ? parseMissionsPage(r.body) : null;
  if (!p || !p.eligible) return { ...s, loadingMore: false, moreError: r.status === 401 ? MISSIONS_COPY.session : MISSIONS_COPY.moreFailed };
  const seen = new Set(s.items.map((i) => i.id));
  const fresh = p.items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true));
  return { ...s, items: [...s.items, ...fresh], captured: [...s.captured, p.captured_at], page: p.page, loadingMore: false, moreError: "" };
}

export function createMissionsController({ api, context = DEFAULT_MISSIONS_CONTEXT, get, set }: { api: () => MissionsApi; context?: MissionsContext; get: () => MissionsState; set: (s: MissionsState) => void }) {
  let seq = 0;
  let pointSeq = 0;
  let accepting = false;
  let attached = true;
  /** Identity the loaded pages (and their cursor) belong to. */
  let loadedFor: string | null = null;
  const identity = () => `${context.userId() ?? ""}|${context.generation()}`;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const call = async (f: () => Promise<MissionsResult>): Promise<MissionsResult> => {
    try {
      return await f();
    } catch {
      return { status: 0, body: null, retryAfter: null };
    }
  };
  const first = async (): Promise<boolean> => {
    const my = ++seq;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), phase: "loading", items: [], captured: [], page: null, error: "", loadingMore: false, moreError: "" });
    const r = await call(() => api().list(null));
    if (!same(gen, uid) || my !== seq) return false;
    loadedFor = `${uid ?? ""}|${gen}`;
    set(applyFirst(get(), r));
    return true;
  };
  return {
    /** Page 1 (or reload): pages, cursor and selection are dropped. */
    load: first,
    async more(): Promise<boolean> {
      const s = get();
      if (s.phase !== "ready" || s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return false;
      // The cursor belongs to the identity that loaded page 1: another identity restarts at page 1.
      if (loadedFor !== identity()) return first();
      const my = seq; // a reload (++seq) voids this page
      const cursor = s.page.next_cursor;
      const gen = context.generation(), uid = context.userId();
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await call(() => api().list(cursor));
      if (!same(gen, uid) || my !== seq) return false;
      if (r.status === 422) return first(); // cursor refused: restart from page 1
      set(applyMore(get(), r));
      return true;
    },
    /** Anonymized summary of one offer (?id=), never the private dossier. 404 ⇒ removed locally. */
    async open(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      const my = ++pointSeq;
      const gen = context.generation(), uid = context.userId();
      set({ ...get(), point: { id, phase: "loading", offer: null }, acceptError: "" });
      const r = await call(() => api().point(id));
      if (!same(gen, uid) || my !== pointSeq) return false;
      if (r.status === 404) {
        const s = get();
        set({ ...s, items: s.items.filter((i) => i.id !== id), point: { id, phase: "gone", offer: null } });
        return true;
      }
      const offer = r.status === 200 ? parsePoint(r.body, id) : null;
      set({ ...get(), point: { id, phase: offer ? "ready" : "error", offer } });
      return true;
    },
    /** DEMO ONLY: summary from the local demo offers (ids « demo-* »), never a GET and never the
     *  live parser; the live open() keeps its strict UUID + parsePoint path unchanged. */
    openDemo(id: string, items: MissionOffer[]): boolean {
      pointSeq++;
      const offer = items.find((o) => o.id === id) ?? null;
      set({ ...get(), point: { id, phase: offer ? "ready" : "gone", offer }, acceptError: "" });
      return offer !== null;
    },
    close() {
      pointSeq++;
      set({ ...get(), point: null, acceptError: "" });
    },
    /** Existing locked accept action (single flight); success ⇒ onOpenAccepted (private dossier). */
    async accept(id: string, onAccept: (id: string) => Promise<boolean>, onOpenAccepted: (id: string) => void): Promise<boolean> {
      if (accepting) return false;
      accepting = true;
      const gen = context.generation(), uid = context.userId();
      set({ ...get(), accepting: id, acceptError: "" });
      let ok = false;
      try {
        ok = await onAccept(id);
      } catch {
        ok = false;
      } finally {
        accepting = false;
      }
      if (!same(gen, uid)) return false;
      if (ok) {
        const s = get();
        set({ ...s, accepting: null, point: null, items: s.items.filter((i) => i.id !== id) });
        onOpenAccepted(id);
        return true;
      }
      // No optimistic removal: the list says what the server still offers.
      set({ ...get(), accepting: null, acceptError: MISSIONS_COPY.acceptFailed });
      return false;
    },
    get accepting() {
      return accepting;
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      seq++;
      pointSeq++;
    },
  };
}
