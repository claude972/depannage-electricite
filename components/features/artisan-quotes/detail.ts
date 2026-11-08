// ART-07 — exact point read of one artisan quote. STRICT MIRROR of the backend contract 42708ad
// (lib/features/artisan-quotes/detail.ts, docs/ARTISAN_QUOTES_BACKEND.md):
//   GET /api/artisan/quotes/[id]  (no query string)
//   → { quote: { id, intervention_id, artisan_id, lines: [{ label, quantity, unit_price_cents }],
//                subtotal_cents, tax_rate, tax_cents, total_cents, status, created_at, accepted_at },
//       intervention: { id, category, status } }
//   404 (absent, other author or other assignment — identical), 401, 403, 422, 503 + Retry-After 2.
//   The quote's own totals (no amendments, no payment status); the server checks them with
//   calculateQuote and so does the client: a reply whose totals do not add up is refused.
import { z } from "zod";
import { calculateQuote } from "../../../lib/domain";
import { isTaxRate } from "../../../lib/tax-rates";
import { CATEGORY, INTERVENTION_STATUS, QUOTE_STATUS, QUOTES_PATH } from "./model";

const date = z.iso.datetime({ offset: true });
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const lineSchema = z
  .object({
    label: z.string().min(1).max(160),
    quantity: z.number().int().min(1).max(1000),
    unit_price_cents: z.number().int().min(0).max(10000000),
  })
  .strict();
const detailSchema = z
  .object({
    quote: z
      .object({
        id: z.uuid(),
        intervention_id: z.uuid(),
        artisan_id: z.uuid(),
        lines: z.array(lineSchema).min(1).max(30),
        subtotal_cents: cents,
        tax_rate: z.number().refine(isTaxRate),
        tax_cents: cents,
        total_cents: cents,
        status: QUOTE_STATUS,
        created_at: date,
        accepted_at: date.nullable(),
      })
      .strict(),
    intervention: z.object({ id: z.uuid(), category: CATEGORY, status: INTERVENTION_STATUS }).strict(),
  })
  .strict();
export type QuoteDetail = z.infer<typeof detailSchema>;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The exact requested quote of the current artisan, with totals that add up; otherwise null. */
export function parseQuoteDetail(body: unknown, quoteId: string, userId: string): QuoteDetail | null {
  const r = detailSchema.safeParse(body);
  if (!r.success) return null;
  const { quote, intervention } = r.data;
  if (!same(quote.id, quoteId) || !same(quote.artisan_id, userId) || !same(intervention.id, quote.intervention_id)) return null;
  try {
    const t = calculateQuote(quote.lines, quote.tax_rate);
    if (t.subtotal_cents !== quote.subtotal_cents || t.tax_cents !== quote.tax_cents || t.total_cents !== quote.total_cents) return null;
  } catch {
    return null;
  }
  return r.data;
}

export const quoteDetailUrl = (quoteId: string) => `${QUOTES_PATH}/${encodeURIComponent(quoteId)}`;

export type DetailState =
  | { phase: "loading" }
  | { phase: "ready"; detail: QuoteDetail }
  /** 404 / 403 / 422: this exact quote cannot be read here. Never substituted. */
  | { phase: "inaccessible" }
  | { phase: "session" }
  | { phase: "error"; retryAt: number };

export const DETAIL_COPY = {
  loading: "Lecture du devis…",
  inaccessible: "Ce devis est inaccessible depuis votre compte : il n’existe plus, ou le dossier n’est plus attribué à votre compte. Aucun autre devis n’est affiché à sa place.",
  session: "Votre session a expiré. Reconnectez-vous pour ouvrir ce devis.",
  error: "Le devis n’a pas pu être vérifié. Réessayez.",
} as const;
