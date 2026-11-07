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

// ---- Shared store: one GET per page load, shared by every display --------------------------------
let state: PricesState = { phase: "loading", data: null };
let inflight: Promise<void> | null = null;
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
export function loadPrices(fetcher: typeof fetch = (...a) => fetch(...a), force = false): Promise<void> {
  if (!force && (state.phase === "ready" || inflight)) return inflight ?? Promise.resolve();
  if (force) emit({ phase: "loading", data: null });
  inflight = (async () => {
    try {
      const r = await fetcher(PRICES_PATH, { method: "GET", credentials: "same-origin", cache: "no-store" });
      const d = r.status === 200 ? parsePrices(await r.json().catch(() => null)) : null;
      emit(d ? { phase: "ready", data: d } : { phase: "error", data: null });
    } catch {
      emit({ phase: "error", data: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
/** Tests / server rendering only: set the store directly (e.g. a primed reply). */
export function setPricesState(s: PricesState) {
  inflight = null;
  emit(s);
}
