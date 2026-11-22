import { z } from "zod";

/** FIN-04: refunds of a settled payment that the payment provider CONFIRMED (request « settled »,
 * written only by the signed provider event). A requested or approved refund is never reported:
 * it is not money returned. Read with the service role only after the route has established that
 * the caller may read the quote; amounts only — no reason, no operator, no provider reference. */
export type ConfirmedRefunds = { count: number; cents: number; last_settled_at: string | null };

const row = z.object({ amount_cents: z.number().int().positive().max(2147483647), settled_at: z.string().nullable() });

/** Pure summary. Anything malformed, or a total above the payment, yields null (nothing shown). */
export function confirmedRefundsFrom(rows: unknown, paymentTotalCents: number): ConfirmedRefunds | null {
  const parsed = z.array(row).max(200).safeParse(rows);
  if (!parsed.success || parsed.data.length === 0) return null;
  let cents = 0, last: string | null = null;
  for (const r of parsed.data) {
    cents += r.amount_cents;
    if (r.settled_at && Number.isFinite(Date.parse(r.settled_at)) && (!last || Date.parse(r.settled_at) > Date.parse(last))) last = r.settled_at;
  }
  if (!Number.isSafeInteger(cents) || cents > paymentTotalCents) return null;
  return { count: parsed.data.length, cents, last_settled_at: last };
}

type Reader = { from(table: string): any };
export async function readConfirmedRefunds(admin: Reader, quoteId: string, paymentTotalCents: number): Promise<ConfirmedRefunds | null> {
  try {
    const payment = await admin.from("payments").select("id").eq("quote_id", quoteId).eq("status", "paid").maybeSingle();
    if (payment.error || !payment.data?.id) return null;
    const refunds = await admin.from("platform_refund_requests").select("amount_cents,settled_at").eq("payment_id", payment.data.id).eq("status", "settled").limit(200);
    return refunds.error ? null : confirmedRefundsFrom(refunds.data, paymentTotalCents);
  } catch {
    return null;
  }
}
