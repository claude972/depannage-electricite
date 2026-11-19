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

/** Only closes the checkout sheet. A return URL never establishes a paid status. */
export function matchesPaymentReturn(url: string, dossier: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'depannageelectrique:' && parsed.hostname === 'dossier'
      && parsed.pathname === '/' + dossier && !parsed.username && !parsed.password && !parsed.port
      && parsed.searchParams.getAll('retourPaiement').length === 1
      && parsed.searchParams.get('retourPaiement') === '1';
  } catch { return false; }
}
export async function withPaymentBrowserReturn(
  dossier: string,
  open: () => Promise<unknown>,
  subscribe: (onUrl: (url: string) => void) => { remove(): void },
  dismiss: () => Promise<unknown>,
) {
  let closing = false;
  const listener = subscribe(url => {
    if (closing || !matchesPaymentReturn(url, dossier)) return;
    closing = true;
    // The native close control remains available if iOS cannot dismiss the sheet.
    void dismiss().catch(() => { closing = false; });
  });
  try { return await open(); } finally { listener.remove(); }
}
