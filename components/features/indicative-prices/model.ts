// PUB-02 / ADM-08 indicative prices — pure model + shared store, no React. STRICT MIRROR of
// lib/features/indicative-prices/handler.ts (publicView), read-only:
//   GET /api/public/indicative-prices (no query) → { version, currency: "eur",
//     ranges: { outage, panel, socket, lighting, diagnostic: { min_cents, max_cents } },
//     indicative: true, publication_available: false, source: "existing_baseline" (v1) | "operator_version" }
// Display only: always « indicatif », never « garanti ». Loading / error ⇒ honest fallback wording,
// never an invented price. Bookings and dossiers keep THEIR reserved estimate: never re-priced here.
import { z } from "zod";

export const PRICES_PATH = "/api/public/indicative-prices";
export const PRICE_CATEGORIES = ["outage", "panel", "socket", "lighting", "diagnostic"] as const;
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];
const amount = z.number().int().min(1).max(2147483647);
const range = z.object({ min_cents: amount, max_cents: amount }).strict().refine((x) => x.max_cents >= x.min_cents);
export const rangesSchema = z.object({ outage: range, panel: range, socket: range, lighting: range, diagnostic: range }).strict();
// 8a2f9b6: the public read follows the ACTIVE version (1 = existing_baseline, > 1 = operator_version).
export const publicViewSchema = z
  .object({
    version: z.number().int().min(1).max(2147483647),
    currency: z.literal("eur"),
    ranges: rangesSchema,
    indicative: z.literal(true),
    publication_available: z.literal(false),
    source: z.enum(["existing_baseline", "operator_version"]),
  })
  .strict()
  .refine((x) => (x.version === 1) === (x.source === "existing_baseline"));
const view = publicViewSchema;
export type PricesView = z.infer<typeof view>;
export type PriceRange = PricesView["ranges"][PriceCategory];
export const parsePrices = (body: unknown): PricesView | null => {
  const r = view.safeParse(body);
  return r.success ? r.data : null;
};

export type PricesState = { phase: "loading" | "ready" | "error"; data: PricesView | null };
const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
export const rangeText = (r: PriceRange) => `${euros(r.min_cents)} – ${euros(r.max_cents)}`;
export const COPY = {
  label: "Estimation indicative",
  loading: "lecture en cours",
  failed: "indisponible pour le moment ; le devis détaillé de l’artisan fait foi",
  adminTitle: "Barème public (fourchettes indicatives)",
  closed: "Publication fermée : la version active est lue seule ; aucune nouvelle version ne peut être publiée depuis cette interface.",
  adminFailed: "Le barème public n’a pas pu être lu. Réessayez.",
} as const;
/** The text shown for one category: the server range once read, otherwise the honest fallback. */
export function displayFor(state: PricesState, category: PriceCategory): string {
  if (state.phase === "ready" && state.data) return rangeText(state.data.ranges[category]);
  return state.phase === "error" ? COPY.failed : COPY.loading;
}

// ---- Shared store: one read at a time per page, sequenced (only the LATEST read may publish) -------
export const PRICES_TTL_MS = 5 * 60_000;
let state: PricesState = { phase: "loading", data: null };
let readAt = 0;
let seq = 0;
let inflight: { seq: number; promise: Promise<void> } | null = null;
const listeners = new Set<(s: PricesState) => void>();
const emit = (s: PricesState) => {
  state = s;
  for (const l of listeners) l(s);
};
export const getPricesState = () => state;
export function subscribePrices(l: (s: PricesState) => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
/**
 * Reads the public prices. Without `force`: reuses a fresh ready state (TTL) or the read in flight.
 * With `force` (review step before a request, after a confirmed publication): a NEW read; any older
 * reply still in flight is dropped (never overwrites a newer version), and the current values stay
 * shown until the new read lands.
 */
export function loadPrices(fetcher: typeof fetch = (...a) => fetch(...a), force = false, now = Date.now()): Promise<void> {
  if (!force) {
    if (state.phase === "ready" && now - readAt < PRICES_TTL_MS) return Promise.resolve();
    if (inflight) return inflight.promise;
  }
  const my = ++seq;
  // The work starts in a microtask: `inflight` is always assigned BEFORE any completion (even a
  // fetcher that throws synchronously), and cleared only by its own completion.
  const promise = Promise.resolve().then(async () => {
    let next: PricesState;
    try {
      const r = await fetcher(PRICES_PATH, { method: "GET", credentials: "same-origin", cache: "no-store" });
      const d = r.status === 200 ? parsePrices(await r.json().catch(() => null)) : null;
      next = d ? { phase: "ready", data: d } : { phase: "error", data: null };
    } catch {
      next = { phase: "error", data: null };
    }
    if (inflight?.seq === my) inflight = null;
    if (my !== seq) return; // a newer read was started: this (older) reply is dropped
    if (next.phase === "ready") readAt = Date.now();
    emit(next);
  });
  inflight = { seq: my, promise };
  return promise;
}
/** Tests / server rendering only: set the store directly (e.g. a primed reply). */
export function setPricesState(s: PricesState) {
  seq++;
  inflight = null;
  readAt = s.phase === "ready" ? Date.now() : 0;
  emit(s);
}

// ---- Live review before creating a request (9ff9009 + 8a2f9b6) ------------------------------------
// reviewed_estimate_version: optional while the active version is 1, REQUIRED and exact when > 1.
// `shown` = what the review step displayed; `fresh` = the forced re-read right before the POST.
export type ReviewDecision = { kind: "send"; version: number } | { kind: "omit" } | { kind: "block"; message: string };
export const REVIEW_COPY = {
  unverified: "estimation non vérifiée",
  changed: "L’estimation indicative a été mise à jour : vérifiez la nouvelle fourchette affichée puis confirmez à nouveau. Rien n’a été envoyé.",
  blocked: "L’estimation indicative n’a pas pu être vérifiée : rien n’a été envoyé. Réessayez dans un instant.",
  conflict: "L’estimation indicative a changé pendant l’envoi : rien n’a été enregistré. Vérifiez la nouvelle fourchette affichée puis confirmez à nouveau.",
} as const;
export function reviewDecision(shown: PricesState, fresh: PricesState): ReviewDecision {
  const sv = shown.phase === "ready" && shown.data ? shown.data.version : null;
  if (fresh.phase === "ready" && fresh.data) {
    const v = fresh.data.version;
    // The user must have seen this exact version, except V1 (the field may even be omitted there).
    return v === 1 || sv === v ? { kind: "send", version: v } : { kind: "block", message: REVIEW_COPY.changed };
  }
  // Unverified read: never fabricate a version. Last seen > 1 ⇒ the server would refuse: block.
  return sv !== null && sv > 1 ? { kind: "block", message: REVIEW_COPY.blocked } : { kind: "omit" };
}
