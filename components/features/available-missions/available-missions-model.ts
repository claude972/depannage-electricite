// Available missions (artisan) — pure model (no React): API client, strict parse of
// GET /api/artisan/missions (contract of lib/features/artisan-missions/schema.ts, read-only: its
// offer schema is reused), and the list / point-read / accept controller.
//   GET /api/artisan/missions[?cursor=<opaque>|?id=<uuid>] → { items ≤50 (anonymized), eligible,
//   captured_at, page: { limit: 50, has_more, next_cursor }, projection: "anonymized",
//   order: "oldest_first", distance: "not_calculated" }
// No total count, no private field (address, contact, description) before acceptance.
// « Plus proches d’abord » (ROOT 12f62f2, same route): GET ?order=nearest[&cursor=…] → same reply with
//   order: "nearest_first", distance: "commune_centre_bands", items + distance_band_km (5–200, ×5, or
//   null = no unique commune centre, listed last) and radius_version (1..2147483647) at the ROOT of
//   every ranked reply (even a single page). Band = greatest(5, ceil(km / 5) × 5) between commune
//   centres (SQL available_missions_by_distance) ⇒ d = 5 means ≤ 5 km, d > 5 means ]d−5, d] km. The
//   ranked cursor carries radius_version; no active radius or another radius version ⇒ 422. The ?id
//   point read stays chronological (no band): the summary keeps the list-row band.
import { readRefused } from "../../app/refusal";
import { z } from "zod";
import { missionOfferSchema, rankedCursorSchema, rankedOfferSchema, type MissionOffer } from "../../../lib/features/artisan-missions/schema";

export type { MissionOffer };
export type MissionsOrder = "oldest_first" | "nearest_first";
/** An offer as listed: ranked pages add the band (null = unknown distance). */
export type ListedOffer = MissionOffer & { distance_band_km?: number | null };
export type MissionsResult = { status: number; body: unknown; retryAfter: number | null };
export type MissionsApi = { list(cursor: string | null, order?: MissionsOrder): Promise<MissionsResult>; point(id: string): Promise<MissionsResult> };
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
/** Chronological URLs unchanged; nearest adds order=nearest. The cursor is sent exactly as received. */
export function listUrl(cursor: string | null, order: MissionsOrder = "oldest_first"): string {
  const q: string[] = [];
  if (order === "nearest_first") q.push("order=nearest");
  if (cursor !== null) q.push(`cursor=${encodeURIComponent(cursor)}`);
  return q.length ? `${MISSIONS_PATH}?${q.join("&")}` : MISSIONS_PATH;
}
/** Same-origin GET only; the cursor is sent exactly as received (opaque base64url). */
export function createMissionsApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = MISSIONS_TIMEOUT_MS } = {}): MissionsApi {
  return {
    list: (cursor, order = "oldest_first") => timed(fetcher, listUrl(cursor, order), timeoutMs),
    point: (id) => timed(fetcher, `${MISSIONS_PATH}?id=${encodeURIComponent(id)}`, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const capacitySchema = z.object({ active: z.number().int().nonnegative(), limit: z.union([z.literal(3), z.literal(4)]), full: z.boolean() }).strict();
const pageSchema = z
  .object({
    items: z.array(missionOfferSchema).max(50),
    eligible: z.boolean(),
    captured_at: z.iso.datetime({ offset: true }),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(400).nullable() }).strict(),
    projection: z.literal("anonymized"),
    order: z.literal("oldest_first"),
    distance: z.literal("not_calculated"),
    capacity: capacitySchema.optional(),
  })
  .strict();
const rankedPageSchema = z
  .object({
    items: z.array(rankedOfferSchema).max(50),
    eligible: z.boolean(),
    captured_at: z.iso.datetime({ offset: true }),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(400).nullable() }).strict(),
    projection: z.literal("anonymized"),
    order: z.literal("nearest_first"),
    distance: z.literal("commune_centre_bands"),
    radius_version: z.number().int().min(1).max(2147483647),
    capacity: capacitySchema.optional(),
  })
  .strict();
const netEstimateSchema = z.object({
  min_cents: z.number().int().nonnegative(),
  max_cents: z.number().int().nonnegative(),
}).strict().refine(estimate => estimate.min_cents <= estimate.max_cents);
const pointSchema = pageSchema.extend({ net_estimate: netEstimateSchema.nullish() });
type PointOffer = MissionOffer & { net_estimate?: z.infer<typeof netEstimateSchema> };
export type MissionsCapacity = z.infer<typeof capacitySchema>;
export type MissionsPageDTO = { items: ListedOffer[]; eligible: boolean; captured_at: string; page: { limit: 50; has_more: boolean; next_cursor: string | null }; radius_version?: number | null; capacity?: MissionsCapacity };
/** radius_version carried by a ranked cursor (base64url JSON, strict); null if absent/undecodable. */
export function cursorRadiusVersion(cursor: string | null): number | null {
  if (!cursor || !/^[A-Za-z0-9_-]{1,400}$/.test(cursor)) return null;
  try {
    // Plain base64url → ASCII (the cursor holds ids, timestamps and integers only); no atob/Buffer.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bits = 0, acc = 0, json = "";
    for (const ch of cursor) {
      acc = (acc << 6) | alphabet.indexOf(ch);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        const code = (acc >> bits) & 0xff;
        if (code > 0x7e) return null;
        json += String.fromCharCode(code);
      }
    }
    const c = rankedCursorSchema.safeParse(JSON.parse(json));
    return c.success ? c.data.radius_version : null;
  } catch {
    return null;
  }
}
/** Anything off-contract — including a page of the OTHER order — ⇒ null (an error, never an empty list). */
export function parseMissionsPage(body: unknown, order: MissionsOrder = "oldest_first"): MissionsPageDTO | null {
  const parsed = (order === "nearest_first" ? rankedPageSchema : pageSchema).safeParse(body);
  if (!parsed.success) return null;
  const p: MissionsPageDTO = { ...parsed.data };
  if (order === "nearest_first") {
    // Bands ascending, unknown (null) last — as the server orders them.
    const rank = (o: ListedOffer) => o.distance_band_km ?? 201;
    if (p.items.some((o, i) => i > 0 && rank(o) < rank(p.items[i - 1]))) return null;
    // Root radius_version is mandatory (schema); a cursor carrying another version is invalid.
    const carried = cursorRadiusVersion(p.page.next_cursor);
    if (p.page.next_cursor !== null && carried !== p.radius_version) return null;
  }
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (!p.eligible && (p.items.length || p.page.has_more)) return null;
  if (new Set(p.items.map((i) => i.id)).size !== p.items.length) return null;
  return p;
}
/** « 5–10 km » / « jusqu’à 5 km » / « distance inconnue » — approximation between commune centres. */
export function bandLabel(band: number | null | undefined): string {
  if (band === null || band === undefined) return "distance inconnue";
  return band <= 5 ? "jusqu’à 5 km" : `${band - 5}–${band} km`;
}
export const NEAREST_COPY = {
  oldest: "Chronologique",
  nearest: "Plus proches d’abord",
  label: "Ordre des offres",
  basis: "Distances approximatives entre centres de communes (tranches de 5 km) — ni GPS, ni durée de trajet. « Distance inconnue » : commune non identifiable, offre classée en dernier.",
  refused: "Le tri « Plus proches d’abord » n’est plus possible : le rayon de recherche a changé ou est désactivé. Rien n’a été basculé automatiquement.",
  stale: "Ces offres ont été classées avec un autre rayon que celui confirmé : elles ne sont pas affichées. Le réglage du rayon est relu, puis les offres sont rechargées.",
  back: "Revenir au chronologique",
} as const;
export function parsePoint(body: unknown, id: string): PointOffer | null {
  const point = pointSchema.safeParse(body);
  if (!point.success) return null;
  const { eligible, items, page, net_estimate } = point.data;
  const offer = items[0];
  if (!eligible || items.length !== 1 || offer.id.toLowerCase() !== id.toLowerCase() || page.has_more || page.next_cursor !== null) return null;
  if (!net_estimate) return offer;
  if (net_estimate.min_cents > offer.estimate_min_cents || net_estimate.max_cents > offer.estimate_max_cents) return null;
  return { ...offer, net_estimate };
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
  capacityFull: (active: number, limit: number) =>
    `Aucune nouvelle offre ne vous est proposée : vous avez ${active} mission${active > 1 ? "s" : ""} en cours pour une limite de ${limit} missions simultanées. Les offres réapparaîtront dès qu’une mission sera terminée${limit === 3 ? " ; vous pouvez aussi passer votre préférence à 4 missions dans votre profil" : ""}.`,
  gone: "Cette offre n’est plus disponible avec vos droits actuels.",
  moreFailed: "La suite des offres n’a pas pu être chargée. Réessayez.",
  anonymized: "Offres anonymisées : l’adresse, le contact et la description sont transmis après acceptation. Distance non calculée.",
  anonymizedNearest: "Offres anonymisées : l’adresse, le contact et la description sont transmis après acceptation.",
  acceptFailed: "L’acceptation n’a pas été confirmée. Vérifiez la liste : l’offre a pu être prise par un autre artisan.",
  declineFailed: "Le refus n’a pas été confirmé. Votre motif est conservé : réessayez ou vérifiez les offres disponibles.",
} as const;
export const shownCount = (n: number, hasMore: boolean) => `${n} offre${n > 1 ? "s" : ""} affichée${n > 1 ? "s" : ""}${hasMore ? " · il y en a d’autres" : ""}`;

// ---- State + controller ---------------------------------------------------------------------------
export type PointState = { id: string; phase: "loading" | "ready" | "gone" | "error"; offer: PointOffer | null };
export type MissionsState = {
  phase: "loading" | "ready" | "error";
  eligible: boolean;
  items: ListedOffer[];
  /** Nearest only: the server refused the ranked feed (422 — radius changed or inactive). */
  nearestRefused: boolean;
  /** Nearest only: radius_version carried by the loaded pages' cursor (never mixed). */
  radiusVersion: number | null;
  /** captured_at of every loaded page, in order (each page is its own snapshot). */
  captured: string[];
  page: MissionsPageDTO["page"] | null;
  error: string;
  loadingMore: boolean;
  moreError: string;
  point: PointState | null;
  accepting: string | null;
  acceptError: string;
  /** First page only, when it is empty: the simultaneous-missions limit as read by the server. */
  capacity?: MissionsCapacity | null;
};
export const MISSIONS_INITIAL: MissionsState = { phase: "loading", eligible: false, items: [], nearestRefused: false, radiusVersion: null, captured: [], page: null, error: "", loadingMore: false, moreError: "", point: null, accepting: null, acceptError: "", capacity: null };

const failure = (status: number) => (status === 401 ? MISSIONS_COPY.session : status === 403 ? MISSIONS_COPY.forbidden : MISSIONS_COPY.loadFailed);
export function applyFirst(s: MissionsState, r: MissionsResult, order: MissionsOrder = "oldest_first"): MissionsState {
  if (order === "nearest_first" && r.status === 422) return { ...s, phase: "error", items: [], captured: [], page: null, nearestRefused: true, radiusVersion: null, error: NEAREST_COPY.refused };
  const p = r.status === 200 ? parseMissionsPage(r.body, order) : null;
  if (!p) return { ...s, phase: "error", items: [], captured: [], page: null, nearestRefused: false, radiusVersion: null, error: failure(r.status) };
  return { ...s, phase: "ready", eligible: p.eligible, items: p.items, captured: [p.captured_at], page: p.page, nearestRefused: false, radiusVersion: p.radius_version ?? null, error: "", moreError: "", capacity: p.capacity ?? null };
}
/** Next page: appended with dedup by id; a 422 (cursor refused) is handled by the controller. */
export function applyMore(s: MissionsState, r: MissionsResult, order: MissionsOrder = "oldest_first"): MissionsState {
  const p = r.status === 200 ? parseMissionsPage(r.body, order) : null;
  if (!p || !p.eligible) return { ...s, loadingMore: false, moreError: r.status === 401 ? MISSIONS_COPY.session : MISSIONS_COPY.moreFailed };
  const seen = new Set(s.items.map((i) => i.id));
  const fresh = p.items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true));
  return { ...s, items: [...s.items, ...fresh], captured: [...s.captured, p.captured_at], page: p.page, loadingMore: false, moreError: "" };
}

/** Was a ranked page appended across a radius version change? (never mix ⇒ restart) */
export const mixesRadius = (s: MissionsState, r: MissionsResult): boolean => {
  const p = r.status === 200 ? parseMissionsPage(r.body, "nearest_first") : null;
  return Boolean(p && p.radius_version !== null && s.radiusVersion !== null && p.radius_version !== s.radiusVersion);
};

export function createMissionsController({ api, context = DEFAULT_MISSIONS_CONTEXT, get, set, order = "oldest_first", radiusVersion = null, onRadiusStale }: { api: () => MissionsApi; context?: MissionsContext; get: () => MissionsState; set: (s: MissionsState) => void; order?: MissionsOrder; /** Nearest: the radius version the host CONFIRMED (GET). */ radiusVersion?: number | null; /** Nearest: a reply ranked with another radius version ⇒ the host re-reads the preference (GET). */ onRadiusStale?: () => void }) {
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
    set({ ...get(), phase: "loading", items: [], captured: [], page: null, error: "", loadingMore: false, moreError: "", point: null, nearestRefused: false, radiusVersion: null });
    const r = await call(() => api().list(null, order));
    if (!same(gen, uid) || my !== seq) return false;
    loadedFor = `${uid ?? ""}|${gen}`;
    const next = applyFirst(get(), r, order);
    // Ranked pages of a radius version other than the confirmed one are never shown: re-read the
    // preference (host), which reloads the offers once a new version is confirmed.
    if (order === "nearest_first" && next.phase === "ready" && next.radiusVersion !== radiusVersion) {
      set({ ...next, phase: "error", items: [], captured: [], page: null, nearestRefused: true, error: NEAREST_COPY.stale });
      onRadiusStale?.();
      return true;
    }
    set(next);
    return true;
  };
  async function respond(id: string, send: (id: string) => Promise<boolean>, confirmed: (id: string) => void, failureMessage: string) {
    if (!attached || accepting) return false;
    accepting = true;
    seq++; // An older page must not put a resolved offer back in the list.
    pointSeq++;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), accepting: id, loadingMore: false, acceptError: "" });
    let ok = false;
    try {
      ok = await send(id);
    } catch {
      ok = false;
    } finally {
      accepting = false;
    }
    if (!same(gen, uid)) return false;
    const current = get();
    if (!ok) {
      set({ ...current, accepting: null, acceptError: failureMessage });
      // P1 (E14): a refused answer re-reads this offer before any new attempt; the point read is
      // this panel's adapter — a refused read (404/403/401) removes the offer and its actions.
      const my = ++pointSeq;
      const r = await call(() => api().point(id));
      if (!same(gen, uid) || my !== pointSeq) return false;
      if (readRefused(r.status)) {
        const s = get();
        set({ ...s, items: s.items.filter((i) => i.id !== id), point: { id, phase: "gone", offer: null } });
      }
      return false;
    }
    set({ ...current, accepting: null, point: null, items: current.items.filter(offer => offer.id !== id) });
    confirmed(id);
    return true;
  }
  return {
    /** Page 1 (or reload): pages, cursor and selection are dropped. */
    load: first,
    async more(): Promise<boolean> {
      const s = get();
      if (accepting || s.phase !== "ready" || s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return false;
      // The cursor belongs to the identity that loaded page 1: another identity restarts at page 1.
      if (loadedFor !== identity()) return first();
      const my = seq; // a reload (++seq) voids this page
      const cursor = s.page.next_cursor;
      const gen = context.generation(), uid = context.userId();
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await call(() => api().list(cursor, order));
      if (!same(gen, uid) || my !== seq) return false;
      if (r.status === 422) return first(); // cursor refused: restart from page 1
      // A ranked page from another radius version is never appended: restart from page 1.
      if (order === "nearest_first" && mixesRadius(get(), r)) return first();
      set(applyMore(get(), r, order));
      return true;
    },
    /** Anonymized summary of one offer (?id=), never the private dossier. 404 ⇒ removed locally. */
    async open(id: string): Promise<boolean> {
      if (accepting || !UUID.test(id)) return false;
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
      if (accepting) return false;
      pointSeq++;
      const offer = items.find((o) => o.id === id) ?? null;
      set({ ...get(), point: { id, phase: offer ? "ready" : "gone", offer }, acceptError: "" });
      return offer !== null;
    },
    close() {
      if (accepting) return;
      pointSeq++;
      set({ ...get(), point: null, acceptError: "" });
    },
    accept(id: string, onAccept: (id: string) => Promise<boolean>, onOpenAccepted: (id: string) => void) {
      return respond(id, onAccept, onOpenAccepted, MISSIONS_COPY.acceptFailed);
    },
    decline(id: string, reason: string, onDecline: (id: string, reason: string) => Promise<boolean>, onDeclined: (id: string) => void) {
      const point = get().point;
      const motive = reason.trim();
      if (point?.id !== id || point.phase !== "ready" || !point.offer || motive.length < 5 || motive.length > 1000)
        return Promise.resolve(false);
      return respond(id, offerId => onDecline(offerId, motive), onDeclined, MISSIONS_COPY.declineFailed);
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
