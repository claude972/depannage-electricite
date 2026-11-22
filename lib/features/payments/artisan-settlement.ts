import { z } from "zod";

/** ART-11: what the assigned artisan may read about a settled job — the amount settled, the
 * commission frozen by the server on the financial snapshot (never recomputed from a rate in the
 * browser) and his net share. `transfer` only states what the server recorded:
 *  - "with_payment": Checkout with automatic transfer (destination charge) — the net share is
 *    transferred by the provider as part of the payment; no separate transfer reference is exposed;
 *  - "confirmed": card-hold settlement whose transfer to the artisan's settlement account was
 *    verified at the provider before the dossier was marked paid.
 * Nothing here says anything about a payout to a bank account: the platform does not confirm it. */
export type ArtisanSettlement = {
  channel: "checkout" | "card_hold";
  amount_cents: number;
  fee_bps: number;
  fee_cents: number;
  net_cents: number;
  transfer: "with_payment" | "confirmed";
};
const cents = z.number().int().min(0).max(2147483647);
const bps = z.number().int().min(0).max(9999);
const checkoutRow = z.object({ amount_cents: cents.positive(), fee_bps: bps, fee_cents: cents, status: z.literal("paid") });
const guestRow = z.object({ amount_cents: cents.positive(), fee_bps: bps, fee_cents: cents, transfer_cents: cents.positive(), status: z.literal("paid"), transfer_id: z.string().regex(/^tr_[A-Za-z0-9]{1,200}$/) });

/** Pure qualification: a row that does not match the confirmed payment to the cent yields nothing
 * (the panel then shows the gross amount only, as before) — never an approximate commission. */
export function artisanSettlementFrom(
  payment: { status: string; total_cents: number; method?: string } | null,
  checkout: unknown,
  guest: unknown,
): ArtisanSettlement | null {
  if (!payment || payment.status !== "paid" || (payment.method ?? "stripe") !== "stripe") return null;
  const c = checkoutRow.safeParse(checkout);
  if (c.success) {
    const { amount_cents, fee_bps, fee_cents } = c.data;
    if (amount_cents !== payment.total_cents || fee_cents >= amount_cents || fee_cents !== Math.round((amount_cents * fee_bps) / 10000)) return null;
    return { channel: "checkout", amount_cents, fee_bps, fee_cents, net_cents: amount_cents - fee_cents, transfer: "with_payment" };
  }
  const g = guestRow.safeParse(guest);
  if (g.success) {
    const { amount_cents, fee_bps, fee_cents, transfer_cents } = g.data;
    if (amount_cents !== payment.total_cents || fee_cents + transfer_cents !== amount_cents) return null;
    return { channel: "card_hold", amount_cents, fee_bps, fee_cents, net_cents: transfer_cents, transfer: "confirmed" };
  }
  return null;
}

type Reader = { from(table: string): any };
/** Service read of the frozen snapshot, only after the route has established that `artisanId` is the
 * signed-in author of the quote. Both tables are closed to the browser roles; a failed read yields
 * null (optional field), never an error on the payment status itself. */
export async function readArtisanSettlement(
  admin: Reader,
  quoteId: string,
  artisanId: string,
  payment: { status: string; total_cents: number; method?: string } | null,
): Promise<ArtisanSettlement | null> {
  if (!payment || payment.status !== "paid" || (payment.method ?? "stripe") !== "stripe") return null;
  try {
    const [checkout, guest] = await Promise.all([
      admin.from("platform_checkouts").select("amount_cents,fee_bps,fee_cents,status").eq("quote_id", quoteId).eq("artisan_id", artisanId).eq("status", "paid").maybeSingle(),
      admin.from("guest_settlements").select("amount_cents,fee_bps,fee_cents,transfer_cents,status,transfer_id").eq("quote_id", quoteId).eq("artisan_id", artisanId).eq("status", "paid").maybeSingle(),
    ]);
    return artisanSettlementFrom(payment, checkout.error ? null : checkout.data, guest.error ? null : guest.data);
  } catch {
    return null;
  }
}
