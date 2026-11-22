import { z } from "zod";

/** FIN-06 — payouts from the artisan's own Stripe settlement account to their bank account, as the
 * payment provider reports them at read time. Aggregated by the provider: a payout is never
 * attributed to a dossier, and « paid » is the provider's status, not a bank receipt. Only amounts,
 * dates and status leave the server: no bank account, no destination, no description. */
export const PAYOUT_STATUSES = ["paid", "pending", "in_transit", "canceled", "failed"] as const;
export const payoutRow = z.object({
  id: z.string().regex(/^po_[A-Za-z0-9_]{1,240}$/),
  amount_cents: z.number().int().min(-2147483647).max(2147483647),
  currency: z.literal("eur"),
  status: z.enum(PAYOUT_STATUSES),
  created_at: z.string().refine((v) => Number.isFinite(Date.parse(v))),
  arrival_date: z.string().refine((v) => Number.isFinite(Date.parse(v))).nullable(),
  automatic: z.boolean(),
}).strict();
export const payoutsReport = z.object({
  state: z.enum(["available", "no_account", "provider_unavailable"]),
  livemode: z.boolean().nullable(),
  payouts: z.array(payoutRow).max(20),
  has_more: z.boolean(),
  read_at: z.string(),
}).strict();
export type PayoutRow = z.infer<typeof payoutRow>;
export type PayoutsReport = z.infer<typeof payoutsReport>;

const iso = (epochSeconds: unknown): string | null =>
  typeof epochSeconds === "number" && Number.isSafeInteger(epochSeconds) && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null;

/** Strict projection of one provider payout; anything unexpected (currency, status, id) drops the row. */
export function projectPayout(p: unknown): PayoutRow | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const parsed = payoutRow.safeParse({ id: o.id, amount_cents: o.amount, currency: o.currency, status: o.status, created_at: iso(o.created), arrival_date: iso(o.arrival_date), automatic: o.automatic === true });
  return parsed.success ? parsed.data : null;
}

export const PAYOUT_STATUS_LABEL: Record<PayoutRow["status"], string> = {
  paid: "Versé selon Stripe",
  pending: "En préparation",
  in_transit: "En cours d’acheminement vers votre banque",
  canceled: "Annulé",
  failed: "Échoué — vérifiez vos coordonnées bancaires dans Stripe",
};
