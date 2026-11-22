import { z } from 'zod';

export const quoteRates = [0, 2.1, 5.5, 8.5, 10, 20] as const;
const quoteLine = z.object({ label: z.string().max(160), quantity: z.string().max(4), price: z.string().max(9) });
export const quoteDraft = z.object({
  lines: z.array(quoteLine).min(1).max(30),
  rate: z.union(quoteRates.map(rate => z.literal(rate))).nullable(),
});
export type DraftLine = z.infer<typeof quoteLine>;
/** Mêmes arrondis que le serveur (`calculateQuote`, lib/domain.ts) : sous-total entier en centimes, TVA arrondie une fois sur le sous-total. */
export function quoteTotals(lines: readonly { quantity: number; unit_price_cents: number }[], rate: number | null) {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
  const tax = rate === null ? null : Math.round((subtotal * rate) / 100);
  return { subtotal, tax, total: tax === null ? null : subtotal + tax };
}

export const pendingPhoto = z.object({ fileId: z.uuid(), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) });
export type PendingPhoto = z.infer<typeof pendingPhoto>;
export const reportDraft = z.object({
  summary: z.string().max(8000),
  name: z.string().max(120),
  before: z.uuid().nullable(),
  after: z.uuid().nullable(),
  pendingBefore: pendingPhoto.nullable(),
  pendingAfter: pendingPhoto.nullable(),
  command: z.uuid().nullable(),
});
