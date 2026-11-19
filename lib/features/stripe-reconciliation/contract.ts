import { z } from "zod";
export const eventId = z.string().regex(/^evt_[A-Za-z0-9_]{1,240}$/),
  uuid = z.uuid().transform((v) => v.toLowerCase()),
  version = z.number().int().min(1).max(2147483647);
export const eventTypes = {
  transfer: ["transfer.created", "transfer.updated", "transfer.reversed"],
  payout: [
    "payout.created",
    "payout.updated",
    "payout.paid",
    "payout.failed",
    "payout.canceled",
    "payout.reconciliation_completed",
  ],
  fee: [
    "application_fee.created",
    "application_fee.refunded",
    "application_fee.refund.updated",
  ],
  dispute: [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.funds_reinstated",
  ],
} as const;
export const account = z.string().regex(/^acct_[A-Za-z0-9]{1,200}$/),
  charge = z.string().regex(/^ch_[A-Za-z0-9_]{1,240}$/),
  money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const feeConnectedReference = z.string().regex(/^(?:ch|py)_[A-Za-z0-9_]{1,240}$/);
export const observationEvent = z
  .object({
    id: eventId,
    type: z.string(),
    family: z.enum(["transfer", "payout", "fee", "dispute"]),
    livemode: z.boolean(),
    source_account: account.nullable(),
    created: z.iso.datetime({ offset: true }),
    object: z
      .object({
        id: z.string().regex(/^[a-z]+_[A-Za-z0-9_]{1,240}$/),
        amount: money,
        currency: z.string().regex(/^[a-z]{3}$/),
        source_charge: feeConnectedReference.nullable(),
        destination: account.nullable(),
        amount_reversed: money.nullable(),
        reversed: z.boolean().nullable(),
        status: z.string().max(80).nullable(),
      })
      .strict(),
  })
  .strict()
  .refine((e) => (eventTypes[e.family] as readonly string[]).includes(e.type))
  .refine((e) => e.family === "fee" || e.object.source_charge === null || charge.safeParse(e.object.source_charge).success);
export const reasons = [
  "unexpected_source_account",
  "unlinked_transfer",
  "transfer_proof_mismatch",
  "transfer_reversal",
  "linked_transfer_observation",
  "aggregate_payout_unallocated",
  "fee_reference_not_bound",
  "dispute_reference_not_bound",
  // Platform Checkout payments (server link from provider re-reads, migration 20261119120000).
  "linked_checkout_transfer",
  "linked_checkout_fee",
  "fee_proof_mismatch",
  "fee_refund_review",
  "checkout_link_review",
] as const;
const checkoutReasons: readonly string[] = ["linked_checkout_transfer", "linked_checkout_fee", "fee_refund_review", "checkout_link_review"];
// payment_id is present only when a Checkout link proves the association; historic results
// (guest settlement or unlinked) keep their previous shape without the key.
export const result = z
  .object({
    state: z.enum(["matched", "needs_review"]),
    reason: z.enum(reasons),
    settlement_id: uuid.nullable(),
    intervention_id: uuid.nullable(),
    quote_id: uuid.nullable(),
    payment_id: uuid.nullable().optional(),
  })
  .strict()
  .refine((r) => {
    const payment = r.payment_id ?? null;
    const linked = (r.intervention_id === null) === (r.quote_id === null);
    const owner = r.settlement_id !== null || payment !== null;
    if (!linked || (r.settlement_id !== null && payment !== null) || owner !== (r.intervention_id !== null)) return false;
    if (payment !== null && !checkoutReasons.includes(r.reason) && r.reason !== "transfer_reversal") return false;
    if (r.state === "matched")
      return (r.settlement_id !== null && r.reason === "linked_transfer_observation")
        || (payment !== null && (r.reason === "linked_checkout_transfer" || r.reason === "linked_checkout_fee"));
    return !(["linked_transfer_observation", "linked_checkout_transfer", "linked_checkout_fee"] as string[]).includes(r.reason);
  });
export const record = z
  .object({
    event: observationEvent,
    result,
    version,
    received_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const page = z
  .object({ records: z.array(record).max(50), next_after: eventId.nullable() })
  .strict();
export const detail = z
  .object({
    record,
    history: z
      .array(
        z
          .object({
            actor_id: uuid,
            note: z.string().max(2000),
            created_at: z.iso.datetime({ offset: true }),
            version,
            outcome: result,
          })
          .strict(),
      )
      .max(50),
    history_limited: z.boolean(),
    // Server re-associations after a Checkout link (webhook, operator relink or review).
    automatic_history: z
      .array(z.object({ created_at: z.iso.datetime({ offset: true }), version, previous: result, outcome: result }).strict())
      .min(1)
      .max(50)
      .optional(),
    automatic_history_limited: z.boolean().optional(),
  })
  .strict()
  .refine((d) => (d.automatic_history === undefined) === (d.automatic_history_limited === undefined));
export const reviewCommand = z
  .object({
    command_id: uuid,
    expected_version: version.max(2147483646),
    note: z.string().trim().min(1).max(2000),
  })
  .strict();
export const receipt = z
  .object({ event_id: eventId, version, result, replayed: z.boolean() })
  .strict();
export type FinancialObservation = z.infer<typeof record>;
