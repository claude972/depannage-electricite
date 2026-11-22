import { env } from "node:process";
import type Stripe from "stripe";
import { ApiError, adminClient, dbError } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { cardHoldConfigured } from "./payment-options";
import { paymentOrigin, stripePaymentMode } from "../payments/configuration";

type Booking = { actor_id: string; request_id: string; method: string; expected_max_cents: number; status: string; intervention_id: string | null; stripe_session_id: string | null; stripe_payment_intent_id: string | null; created_at: string };
const unavailable = () => new ApiError(503, "L’empreinte bancaire est momentanément indisponible. Aucun paiement n’est confirmé.");
const conflict = () => new ApiError(409, "Cette empreinte ne permet pas de confirmer la demande. Réessayez après annulation.");
const sessionId = /^cs_(?:test_|live_)?[A-Za-z0-9]{1,200}$/;
const intentId = /^pi_[A-Za-z0-9]{1,200}$/;
/** Existing sessions can be checked or released even when new authorizations are disabled. */
export function cardHoldContext(operation: "existing" | "create" = "existing") {
  const mode = stripePaymentMode(env);
  if (!mode || (operation === "create" && !cardHoldConfigured(env))) throw unavailable();
  return { stripe: stripeClient(), origin: paymentOrigin(env.NEXT_PUBLIC_APP_URL), live: mode === "live" };
}
type Context = ReturnType<typeof cardHoldContext>;
async function booking(actor: string, request: string) {
  const admin = adminClient();
  const r = await admin.from("phone_booking_requests").select("actor_id,request_id,method,expected_max_cents,status,intervention_id,stripe_session_id,stripe_payment_intent_id,created_at").eq("actor_id", actor).eq("request_id", request).maybeSingle();
  dbError(r.error);
  if (!r.data) throw new ApiError(404, "Cette réservation est introuvable.");
  const b = r.data as Booking;
  if (b.method !== "card_hold" || b.actor_id !== actor || b.request_id !== request || !Number.isSafeInteger(b.expected_max_cents) || b.expected_max_cents <= 0 || !["prepared", "checkout_open", "authorized", "confirmed", "cancelling", "cancelled"].includes(b.status) || !Number.isFinite(Date.parse(b.created_at)) || (b.stripe_session_id !== null && !sessionId.test(b.stripe_session_id)) || (b.stripe_payment_intent_id !== null && !intentId.test(b.stripe_payment_intent_id))) throw unavailable();
  return { admin, b };
}
function metadata(value: Stripe.Metadata | null, b: Booking) {
  return value?.booking_actor === b.actor_id && value?.booking_request === b.request_id && value?.booking_method === "card_hold";
}
function sessionProof(s: Stripe.Checkout.Session, b: Booking, context: Context) {
  if (!s || !sessionId.test(s.id) || (b.stripe_session_id !== null && s.id !== b.stripe_session_id) || s.mode !== "payment" || s.livemode !== context.live || s.client_reference_id !== b.request_id || !metadata(s.metadata, b) || s.currency !== "eur" || s.amount_total !== b.expected_max_cents || !["open", "complete", "expired"].includes(s.status ?? "")) throw unavailable();
  return s;
}
function piReference(s: Stripe.Checkout.Session) {
  if (s.payment_intent === null) return null;
  const id = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
  if (typeof id !== "string" || !intentId.test(id)) throw unavailable();
  return id;
}
async function intentProof(s: Stripe.Checkout.Session, b: Booking, context: Context) {
  const id = piReference(s);
  if (b.stripe_payment_intent_id !== null && b.stripe_payment_intent_id !== id) throw unavailable();
  if (!id) return null;
  // Always retrieve the current object server-side, never trust URL parameters or a browser payload.
  const pi = await context.stripe.paymentIntents.retrieve(id);
  if (pi.id !== id || pi.livemode !== context.live || !metadata(pi.metadata, b) || pi.capture_method !== "manual" || pi.currency !== "eur" || pi.amount !== b.expected_max_cents || pi.amount_received !== 0) throw unavailable();
  return pi;
}
async function record(admin: ReturnType<typeof adminClient>, b: Booking, session: Stripe.Checkout.Session, pi: Stripe.PaymentIntent | null, action: "session" | "authorize" | "release", state: string | null = null) {
  const r = await admin.rpc("record_phone_booking_provider", { p_actor: b.actor_id, p_request_id: b.request_id, p_session_id: session.id, p_intent_id: pi?.id ?? piReference(session), p_action: action, p_amount: action === "authorize" ? pi?.amount : null, p_currency: action === "authorize" ? pi?.currency : null, p_state: state });
  dbError(r.error);
}
async function ensureSession(b: Booking, context: Context) {
  if (b.stripe_session_id) return sessionProof(await context.stripe.checkout.sessions.retrieve(b.stripe_session_id), b, context);
  if (!context.origin) throw unavailable();
  // Stripe idempotency records may expire after 24h. Never create an ambiguous replacement then.
  if (Date.now() - Date.parse(b.created_at) > 23 * 3600000 || Date.parse(b.created_at) > Date.now() + 30000) throw unavailable();
  const tags = { booking_actor: b.actor_id, booking_request: b.request_id, booking_method: "card_hold" };
  const s = await context.stripe.checkout.sessions.create({ mode: "payment", allowed_payment_method_types: ["card"], client_reference_id: b.request_id, metadata: tags, payment_intent_data: { capture_method: "manual", metadata: tags }, line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: b.expected_max_cents, product_data: { name: "Empreinte bancaire — dépannage électrique" } } }], success_url: `${context.origin}/?booking_request_id=${b.request_id}&booking_return=success`, cancel_url: `${context.origin}/?booking_request_id=${b.request_id}&booking_return=cancel` }, { idempotencyKey: `booking-hold:${b.actor_id}:${b.request_id}` });
  return sessionProof(s, b, context);
}
export async function openCardHold(actor: string, request: string, context: Context) {
  const { admin, b } = await booking(actor, request);
  if (b.intervention_id !== null || ["cancelled", "cancelling"].includes(b.status)) throw conflict();
  const s = await ensureSession(b, context);
  const pi = await intentProof(s, b, context);
  await record(admin, b, s, pi, "session");
  if (s.status !== "open" || !s.url) throw conflict();
  const url = new URL(s.url);
  if (url.protocol !== "https:" || url.origin !== "https://checkout.stripe.com" || url.username || url.password) throw unavailable();
  return { status: "authorization_required", url: s.url };
}
export async function authorizeCardHold(actor: string, request: string, context: Context) {
  const { admin, b } = await booking(actor, request);
  if (["cancelled", "cancelling"].includes(b.status)) throw conflict();
  if (!b.stripe_session_id) throw unavailable();
  const s = sessionProof(await context.stripe.checkout.sessions.retrieve(b.stripe_session_id), b, context);
  const pi = await intentProof(s, b, context);
  if (s.status !== "complete" || !pi || pi.status !== "requires_capture" || pi.amount_capturable !== b.expected_max_cents) throw conflict();
  await record(admin, b, s, pi, "authorize", "requires_capture");
}
/** Called only after the user's begin-cancel RPC has durably blocked submit/finalize. */
export async function releaseCardHold(actor: string, request: string, context: Context) {
  const { admin, b } = await booking(actor, request);
  if (b.intervention_id !== null || b.status !== "cancelling") throw conflict();
  const s = await ensureSession(b, context);
  let pi = await intentProof(s, b, context);
  await record(admin, b, s, pi, "session");
  let released = s;
  if (s.status === "open") {
    released = sessionProof(await context.stripe.checkout.sessions.expire(s.id), b, context);
    if (released.status !== "expired") throw unavailable();
    pi = await intentProof(released, b, context);
  }
  if (pi && pi.status !== "canceled") {
    if (!["requires_capture", "requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status)) throw conflict();
    await context.stripe.paymentIntents.cancel(pi.id, {}, { idempotencyKey: `booking-release:${actor}:${request}` });
    pi = await intentProof(released, b, context);
    if (!pi || pi.status !== "canceled") throw unavailable();
  }
  if ((!pi && released.status !== "expired") || (pi && pi.status !== "canceled")) throw unavailable();
  await record(admin, b, released, pi, "release", pi ? "canceled" : "expired");
}
