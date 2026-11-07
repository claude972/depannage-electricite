import type Stripe from "stripe";
import { ApiError } from "@/lib/supabase/server";
export type Attempt = {
  id: string;
  intervention_id: string;
  actor_id: string;
  snapshot_id: string;
  snapshot: Record<string, any>;
  old_ledger_id: string | null;
  old_intent: string;
  old_session: string;
  old_max: number;
  account_id: string;
  fee_bps: number;
  fee_cents: number;
  return_origin: string;
  session_id: string | null;
  intent_id: string | null;
  old_released: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};
export const unavailable = () =>
  new ApiError(
    503,
    "Les autorisations bancaires doivent être vérifiées. Reprenez la même demande.",
  );
export const conflict = () =>
  new ApiError(
    409,
    "Aucune seconde capture n’est autorisée. Vérifiez la reprise de l’empreinte.",
  );
export function reference(v: any): string | null {
  return typeof v === "string" ? v : typeof v?.id === "string" ? v.id : null;
}
export function tags(a: Attempt) {
  return {
    booking_actor: a.actor_id,
    booking_request: String(a.snapshot.request_id),
    booking_method: "card_hold",
    hold_reauthorization_id: a.id,
  };
}
function metadata(v: any, a: Attempt, isNew: boolean) {
  return (
    v?.booking_actor === a.actor_id &&
    v?.booking_request === a.snapshot.request_id &&
    v?.booking_method === "card_hold" &&
    (!isNew || v?.hold_reauthorization_id === a.id)
  );
}
export function checkSession(s: any, a: Attempt, live: boolean) {
  if (
    !s ||
    s.object !== "checkout.session" ||
    !/^cs_[A-Za-z0-9_]{1,240}$/.test(s.id) ||
    (a.session_id !== null && s.id !== a.session_id) ||
    (a.intent_id !== null && reference(s.payment_intent) !== a.intent_id) ||
    s.mode !== "payment" ||
    s.livemode !== live ||
    s.client_reference_id !== a.snapshot.request_id ||
    !metadata(s.metadata, a, true) ||
    s.currency !== "eur" ||
    s.amount_total !== a.snapshot.amount_cents ||
    !["open", "complete", "expired"].includes(s.status)
  )
    throw unavailable();
  return s;
}
export async function intentProof(
  stripe: Stripe,
  a: Attempt,
  live: boolean,
  isNew: boolean,
) {
  const id = isNew ? a.intent_id : a.old_intent;
  if (!id || !/^pi_[A-Za-z0-9]{1,200}$/.test(id)) throw unavailable();
  const pi = await stripe.paymentIntents.retrieve(id),
    max = isNew ? a.snapshot.amount_cents : a.old_max;
  if (
    pi.id !== id ||
    pi.livemode !== live ||
    pi.capture_method !== "manual" ||
    pi.currency !== "eur" ||
    pi.amount !== max ||
    !metadata(pi.metadata, a, isNew) ||
    pi.transfer_data != null ||
    pi.application_fee_amount != null ||
    pi.on_behalf_of != null ||
    !Number.isSafeInteger(pi.amount_received) ||
    !Number.isSafeInteger(pi.amount_capturable)
  )
    throw unavailable();
  const chargeId = reference(pi.latest_charge);
  if (!chargeId || !/^ch_[A-Za-z0-9]{1,200}$/.test(chargeId))
    throw unavailable();
  const charge = await stripe.charges.retrieve(chargeId);
  if (
    charge.id !== chargeId ||
    reference(charge.payment_intent) !== id ||
    charge.livemode !== live ||
    charge.currency !== "eur" ||
    charge.amount !== max ||
    !metadata(charge.metadata, a, isNew) ||
    !Number.isSafeInteger(charge.amount_captured) ||
    !Number.isSafeInteger(charge.amount_refunded) ||
    typeof charge.captured !== "boolean" ||
    typeof charge.refunded !== "boolean" ||
    typeof charge.disputed !== "boolean" ||
    charge.amount_refunded !== 0 ||
    charge.refunded ||
    charge.disputed
  )
    throw unavailable();
  return { pi, charge };
}
export async function newAuthorized(stripe: Stripe, a: Attempt, live: boolean) {
  const p = await intentProof(stripe, a, live, true),
    until = p.charge.payment_method_details?.card?.capture_before;
  if (
    p.pi.status !== "requires_capture" ||
    p.pi.amount_received !== 0 ||
    p.pi.amount_capturable !== a.snapshot.amount_cents ||
    p.charge.amount_captured !== 0 ||
    p.charge.captured ||
    p.charge.status !== "succeeded" ||
    !p.charge.paid ||
    !Number.isSafeInteger(until) ||
    (until ?? 0) <= Date.now() / 1000 + 60
  )
    throw conflict();
  return p;
}
/** Exhaustive within a declared bound. A partial provider list NEVER proves zero transfers. */
export async function noTransfers(stripe: Stripe, charge: string) {
  let after: string | undefined;
  let count = 0;
  for (let n = 0; n < 5; n++) {
    const list = await stripe.transfers.list({
      limit: 100,
      ...(after ? { starting_after: after } : {}),
    });
    if (
      list.object !== "list" ||
      !Array.isArray(list.data) ||
      list.data.length > 100 ||
      typeof list.has_more !== "boolean"
    )
      throw unavailable();
    for (const t of list.data) {
      if (typeof t.id !== "string" || !/^tr_[A-Za-z0-9]{1,200}$/.test(t.id))
        throw unavailable();
      if (reference(t.source_transaction) === charge) count++;
    }
    if (!list.has_more) {
      if (count !== 0) throw conflict();
      return;
    }
    after = list.data.at(-1)?.id;
    if (!after) throw unavailable();
  }
  throw unavailable();
}
export async function zeroProof(
  stripe: Stripe,
  a: Attempt,
  live: boolean,
  isNew: boolean,
) {
  const { pi, charge } = await intentProof(stripe, a, live, isNew);
  if (
    pi.status !== "canceled" ||
    pi.amount_received !== 0 ||
    pi.amount_capturable !== 0 ||
    charge.amount_captured !== 0 ||
    charge.captured
  )
    throw conflict();
  await noTransfers(stripe, charge.id);
  return {
    intent_id: pi.id,
    status: pi.status,
    amount: pi.amount,
    amount_received: pi.amount_received,
    amount_capturable: pi.amount_capturable,
    charge_id: charge.id,
    amount_captured: charge.amount_captured,
    transfer_count: 0,
    complete: true,
  };
}
export function fresh(a: Attempt) {
  const age = Date.now() - Date.parse(a.created_at);
  return Number.isFinite(age) && age >= -30000 && age < 23 * 3600000;
}
export function checkoutUrl(s: any) {
  try {
    const u = new URL(s.url);
    if (
      u.protocol === "https:" &&
      u.hostname === "checkout.stripe.com" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (!u.port || u.port === "443")
    )
      return u.href;
  } catch {}
  throw unavailable();
}

/** Recover a lost creation response without creating another Checkout after the key window. */
export async function recoverSession(
  stripe: Stripe,
  a: Attempt,
  live: boolean,
) {
  let after: string | undefined;
  const found: any[] = [];
  const created = Math.floor(Date.parse(a.created_at) / 1000);
  if (!Number.isSafeInteger(created)) throw unavailable();
  for (let page = 0; page < 5; page++) {
    const list = await stripe.checkout.sessions.list({
      created: { gte: created - 60, lte: created + 24 * 3600 },
      limit: 100,
      ...(after ? { starting_after: after } : {}),
    });
    if (
      list.object !== "list" ||
      !Array.isArray(list.data) ||
      typeof list.has_more !== "boolean" ||
      list.data.length > 100
    )
      throw unavailable();
    for (const s of list.data) {
      if (s.metadata?.hold_reauthorization_id === a.id)
        found.push(checkSession(s, a, live));
    }
    if (found.length > 1) throw conflict();
    if (!list.has_more) return found[0] ?? null;
    after = list.data.at(-1)?.id;
    if (!after) throw unavailable();
  }
  throw unavailable();
}
