import { z } from 'zod';

export const paymentReturn = z.object({ dossier: z.uuid(), quote: z.uuid(), startedAt: z.number().int().nonnegative() }).strict();
export const paymentReturnKey = (actor: string) => 'checkout.v1.' + actor;
export function recentPaymentReturn(startedAt: number, now = Date.now()) {
  return startedAt <= now && now - startedAt < 15 * 60 * 1000;
}
export const stripeReadback = z.object({
  payment: z.object({ quote_id: z.uuid(), method: z.enum(['stripe', 'on_site_declared']), status: z.enum(['pending','paid','failed']) }).nullable(),
});
export function paymentReturnStatus(record: z.infer<typeof stripeReadback>, quote: string) {
  const row = record.payment;
  return row?.quote_id === quote && row.method === 'stripe' ? row.status : 'pending';
}
