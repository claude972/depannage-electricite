import { z } from "zod";
import type Stripe from "stripe";
import type { Db } from "../charge-proof/handlers";

// Provider reads only. The SQL transaction owns the immutable binding, audit and
// exactly-once ledger write. No browser-supplied provider reference reaches it.
export type CheckoutLinkStripe = Pick<Stripe, "checkout" | "paymentIntents" | "charges" | "transfers" | "applicationFees">;
export type CheckoutSelector = { checkoutId: string } | { paymentId: string } | { chargeId: string };
const sid = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,240}$`));
const money = z.number().int().nonnegative().max(2147483647);
const contextSchema = z.object({
  checkout_id: z.uuid(), payment_id: z.uuid().nullable(), quote_id: z.uuid(), intervention_id: z.uuid(),
  session_id: sid("cs").nullable(), amount_cents: money.positive(), fee_cents: money.nullable(),
  account_id: sid("acct"), currency: z.literal("eur"), checkout_status: z.string(),
  payment_status: z.string().nullable(), payment_session_id: sid("cs").nullable(),
  payment_total_cents: money.nullable(), payment_method: z.string().nullable(), link_state: z.string().nullable(),
}).strict();
const resultSchema = z.object({
  payment_id: z.uuid(), state: z.enum(["awaiting_provider", "linked", "needs_review"]),
  review_reason: z.string().nullable(), commission: z.enum(["none", "existing", "recorded"]),
  rematched: z.array(sid("evt")),
}).strict();
export class CheckoutLinkError extends Error {
  constructor() { super("Le rapprochement Checkout doit être revérifié."); }
}
function requireProof(ok: unknown): asserts ok { if (!ok) throw new CheckoutLinkError(); }
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}
async function rpc(db: Db, name: string, args: Record<string, unknown>) {
  const r = await db.rpc(name, args);
  requireProof(!r.error);
  return r.data;
}
function providerObject(value: unknown, object: string, id: string, live: boolean): Record<string, any> {
  requireProof(value && typeof value === "object");
  const v = value as Record<string, any>;
  requireProof(v.object === object && v.id === id && v.livemode === live);
  return v;
}
function checkedId(value: unknown, prefix: string): string {
  const id = idOf(value);
  requireProof(sid(prefix).safeParse(id).success);
  return id!;
}

/** Re-read the exact Checkout chain. Unknown/non-Checkout charges are acknowledged without mutation. */
export async function reconcileCheckoutLink(
  db: Db, stripe: CheckoutLinkStripe, live: boolean, selector: CheckoutSelector,
  actor?: string, beforeRecord?: () => Promise<void>,
) {
  let args: Record<string, unknown>;
  let expectedCharge: string | null = null;
  if ("chargeId" in selector) {
    expectedCharge = checkedId(selector.chargeId, "ch");
    const bound = await rpc(db, "stripe_checkout_link_context", { p_charge: expectedCharge });
    if (bound !== null) args = { p_charge: expectedCharge };
    else {
      const charge = providerObject(await stripe.charges.retrieve(expectedCharge), "charge", expectedCharge, live);
      const checkoutId = charge.metadata?.platform_checkout_id;
      if (!z.uuid().safeParse(checkoutId).success) return null;
      // Metadata is only a lookup hint. The full paid local session and provider chain below must agree.
      args = { p_checkout: checkoutId };
    }
  } else if ("checkoutId" in selector) {
    requireProof(z.uuid().safeParse(selector.checkoutId).success);
    args = { p_checkout: selector.checkoutId };
  } else {
    requireProof(z.uuid().safeParse(selector.paymentId).success);
    args = { p_payment: selector.paymentId };
  }
  const raw = await rpc(db, "stripe_checkout_link_context", args);
  if (raw === null) return null;
  const c = contextSchema.parse(raw);
  requireProof(c.checkout_status === "paid" && c.payment_status === "paid" && c.payment_method === "stripe"
    && c.payment_id && c.session_id && c.payment_session_id === c.session_id
    && c.amount_cents === c.payment_total_cents && c.fee_cents !== null && c.fee_cents <= c.amount_cents);
  if ("paymentId" in selector) requireProof(c.payment_id === selector.paymentId);
  if ("checkoutId" in selector) requireProof(c.checkout_id === selector.checkoutId);
  const session = providerObject(await stripe.checkout.sessions.retrieve(c.session_id), "checkout.session", c.session_id, live);
  requireProof(session.mode === "payment" && session.status === "complete" && session.payment_status === "paid"
    && session.currency === "eur" && session.amount_total === c.amount_cents
    && session.client_reference_id === c.quote_id && session.metadata?.quote_id === c.quote_id
    && session.metadata?.platform_checkout_id === c.checkout_id);
  const intentId = checkedId(session.payment_intent, "pi");
  const intent = providerObject(await stripe.paymentIntents.retrieve(intentId), "payment_intent", intentId, live);
  requireProof(intent.status === "succeeded" && intent.currency === "eur" && intent.amount === c.amount_cents
    && intent.amount_received === c.amount_cents && (intent.application_fee_amount ?? 0) === c.fee_cents
    && idOf(intent.transfer_data?.destination) === c.account_id
    && intent.metadata?.quote_id === c.quote_id && intent.metadata?.platform_checkout_id === c.checkout_id);
  const chargeId = checkedId(intent.latest_charge, "ch");
  if (expectedCharge !== null) requireProof(chargeId === expectedCharge);
  const charge = providerObject(await stripe.charges.retrieve(chargeId), "charge", chargeId, live);
  requireProof(idOf(charge.payment_intent) === intentId && charge.paid === true && charge.captured === true
    && charge.status === "succeeded" && charge.currency === "eur" && charge.amount === c.amount_cents
    && charge.amount_captured === c.amount_cents && charge.amount_refunded === 0 && charge.refunded === false
    && (charge.application_fee_amount ?? 0) === c.fee_cents
    && idOf(charge.transfer_data?.destination) === c.account_id);

  const transferId = charge.transfer == null ? null : checkedId(charge.transfer, "tr");
  const feeId = charge.application_fee == null ? null : checkedId(charge.application_fee, "fee");
  if (feeId !== null) requireProof(c.fee_cents > 0);
  // Both objects depend on the Charge, but their network reads are independent.
  const [transferValue, feeValue] = await Promise.all([
    transferId === null ? null : stripe.transfers.retrieve(transferId),
    feeId === null ? null : stripe.applicationFees.retrieve(feeId),
  ]);
  let transfer: Record<string, unknown> | null = null;
  let connectedCharge: string | null = null;
  if (transferId !== null) {
    const id = transferId;
    const t = providerObject(transferValue, "transfer", id, live);
    requireProof(t.amount === c.amount_cents && t.currency === "eur" && idOf(t.destination) === c.account_id
      && idOf(t.source_transaction) === chargeId && typeof t.reversed === "boolean"
      && money.safeParse(t.amount_reversed).success && t.amount_reversed <= t.amount);
    connectedCharge = idOf(t.destination_payment);
    requireProof(typeof connectedCharge === "string" && /^(ch|py)_[A-Za-z0-9_]{1,240}$/.test(connectedCharge));
    transfer = { id, amount: t.amount, currency: t.currency, destination: c.account_id, source_charge: chargeId,
      reversed: t.reversed, amount_reversed: t.amount_reversed, livemode: live };
  }
  let fee: Record<string, unknown> | null = null;
  if (feeId !== null) {
    const id = feeId;
    const f = providerObject(feeValue, "application_fee", id, live);
    const connected = idOf(f.charge);
    requireProof(f.amount === c.fee_cents && f.currency === "eur" && idOf(f.account) === c.account_id
      && idOf(f.originating_transaction) === chargeId && typeof connected === "string"
      && /^(ch|py)_[A-Za-z0-9_]{1,240}$/.test(connected) && (connectedCharge === null || connected === connectedCharge)
      && money.safeParse(f.amount_refunded).success && f.amount_refunded <= f.amount
      && typeof f.refunded === "boolean" && f.refunded === (f.amount_refunded === f.amount));
    fee = { id, amount: f.amount, currency: f.currency, account: c.account_id, connected_charge: connected,
      originating_charge: chargeId, amount_refunded: f.amount_refunded, livemode: live };
  }
  // Operator recovery revalidates identity/scopes after network reads, before the privileged transaction.
  if (beforeRecord) await beforeRecord();
  const result = resultSchema.parse(await rpc(db, "record_stripe_checkout_link", {
    p_checkout: c.checkout_id, p_live: live, p_actor: actor ?? null,
    p_refs: { session_id: c.session_id, payment_intent_id: intentId, charge_id: chargeId, destination: c.account_id,
      amount_cents: c.amount_cents, fee_cents: c.fee_cents, currency: "eur", transfer, fee },
  }));
  requireProof(result.payment_id === c.payment_id);
  // Persisting the incomplete link is useful for later financial events, but NOT transport success:
  // even a replayed Checkout webhook must retry until its provider objects are available.
  requireProof(result.state !== "awaiting_provider");
  return result;
}

/** Used by operator review with a signed observation already stored by ingestion. */
export async function reconcileObservedCheckoutEvent(
  event: { family: string; type: string; livemode: boolean; source_account: string | null; object: { id: string } },
  db: Db, stripe: CheckoutLinkStripe, live: boolean, actor?: string, beforeRecord?: () => Promise<void>,
) {
  requireProof(event.livemode === live);
  if (event.source_account !== null || !["transfer", "fee"].includes(event.family)) return null;
  let chargeId: string | null;
  if (event.family === "transfer") {
    const id = checkedId(event.object.id, "tr");
    const t = providerObject(await stripe.transfers.retrieve(id), "transfer", id, live);
    chargeId = idOf(t.source_transaction);
  } else {
    // Fee refunds are distinct objects; the original application_fee.refunded event is also delivered.
    if (event.type === "application_fee.refund.updated") return null;
    const id = checkedId(event.object.id, "fee");
    const f = providerObject(await stripe.applicationFees.retrieve(id), "application_fee", id, live);
    chargeId = idOf(f.originating_transaction);
  }
  if (chargeId === null) return null; // unrelated charge/transfer without a platform source
  return reconcileCheckoutLink(db, stripe, live, { chargeId: checkedId(chargeId, "ch") }, actor, beforeRecord);
}

export async function reconcileFinancialCheckoutEvent(
  event: Stripe.Event, db: Db, stripe: CheckoutLinkStripe, live: boolean,
) {
  const family = event.type.startsWith("transfer.") ? "transfer" : event.type.startsWith("application_fee.") ? "fee" : "other";
  return reconcileObservedCheckoutEvent({ family, type: event.type, livemode: event.livemode,
    source_account: event.account ?? event.context ?? null, object: { id: (event.data.object as { id: string }).id } }, db, stripe, live);
}
