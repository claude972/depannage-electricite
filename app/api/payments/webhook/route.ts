import {financialEventType,dispatchFinancialEvent} from "@/lib/features/stripe-reconciliation/webhook";
import Stripe from "stripe";
import { dispatchRefundEvent } from "@/lib/features/refund-execution/server";
import { env } from "node:process";
import {
  adminClient,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { checkoutEventOutcome, isBookingHoldSession } from "@/lib/payment-events";
import { uuid } from "@/lib/supabase/validation";
import { PAYMENT_HEADERS } from "@/lib/features/payments/checkout";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const connected = new URL(request.url).searchParams.get("source") === "connect";
    const secret = connected ? env.STRIPE_CONNECT_WEBHOOK_SECRET : env.STRIPE_WEBHOOK_SECRET;
    if (!secret || (connected && secret === env.STRIPE_WEBHOOK_SECRET))
      throw new ApiError(503, "Le webhook de paiement n’est pas configuré.");
    const stripe = stripeClient();
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new ApiError(400, "Signature de paiement absente.");
    if (Number(request.headers.get("content-length") || 0) > 1048576)
      throw new ApiError(413, "Événement trop volumineux.");
    const body = await request.text();
    if (body.length > 1048576)
      throw new ApiError(413, "Événement trop volumineux.");
    let event: Stripe.Event;
    // Raw body is essential: https://docs.stripe.com/webhooks/signature
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      throw new ApiError(400, "Signature de paiement invalide.");
    }
    const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
    const financial = financialEventType(event.type);
    const validContext = connected
      ? /^acct_[A-Za-z0-9]{1,200}$/.test(event.account ?? "")
        && (event.context == null || event.context === event.account)
        && financial
      : event.account == null && event.context == null;
    if (event.livemode !== live || !validContext)
      throw new ApiError(400, "Contexte du paiement invalide.");
    if (financial) {
      await dispatchFinancialEvent(event,body,adminClient(),live);
      return Response.json({received:true},{headers:PAYMENT_HEADERS});
    }
    if(["refund.created","refund.updated","refund.failed"].includes(event.type)){
      await dispatchRefundEvent(event,stripe,adminClient(),live);
      return Response.json({received:true},{headers:PAYMENT_HEADERS});
    }
    // Other event families are acknowledged as transport only; no finance mutation is claimed.
    const session = event.data.object as Stripe.Checkout.Session;
    // Signed booking-hold events have no quote_id and must not enter the legacy payment writer.
    // Acknowledging them never confirms a booking, capture, transfer or payment.
    if (isBookingHoldSession(session)) return Response.json({ received: true }, { headers: PAYMENT_HEADERS });
    const outcome = checkoutEventOutcome(event.type, session);
    if (outcome === "ignore") return Response.json({ received: true }, { headers: PAYMENT_HEADERS });
    const quoteId = session.metadata?.quote_id;
    if (
      !uuid.safeParse(quoteId).success ||
      session.client_reference_id !== quoteId ||
      session.currency !== "eur" ||
      !Number.isSafeInteger(session.amount_total) ||
      !session.amount_total ||
      session.amount_total < 1
    )
      throw new ApiError(
        400,
        "Les références du paiement ne correspondent pas.",
      );
    const admin = adminClient();
    const checkoutId = session.metadata?.platform_checkout_id;
    if (checkoutId !== undefined) {
      if (!uuid.safeParse(checkoutId).success) throw new ApiError(400, "La référence du paiement ne correspond pas.");
      const match = await admin.rpc("assert_platform_checkout_event", { p_id: checkoutId, p_quote: quoteId, p_session: session.id, p_amount: session.amount_total });
      dbError(match.error);
    }
    const { error } = await admin.rpc(outcome === "paid" ? "confirm_stripe_payment" : "record_stripe_payment_failure", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_session_id: session.id,
      p_quote_id: quoteId,
      p_amount: session.amount_total,
      p_currency: session.currency,
    });
    // Failure leaves the event unprocessed; Stripe retries until the transaction commits.
    dbError(error);
    return Response.json({ received: true }, { headers: PAYMENT_HEADERS });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Le paiement doit être vérifié. Réessayez." }, { status, headers: { ...PAYMENT_HEADERS, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
