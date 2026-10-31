import Stripe from "stripe";
import {
  adminClient,
  ApiError,
  apiError,
  dbError,
} from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { uuid } from "@/lib/supabase/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret)
      throw new ApiError(503, "Le webhook de paiement n’est pas configuré.");
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
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    )
      return Response.json({ received: true });
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid")
      return Response.json({ received: true });
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
    const { error } = await admin.rpc("confirm_stripe_payment", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_session_id: session.id,
      p_quote_id: quoteId,
      p_amount: session.amount_total,
      p_currency: session.currency,
    });
    // Failure leaves the event unprocessed; Stripe retries until the transaction commits.
    dbError(error);
    return Response.json({ received: true });
  } catch (error) {
    return apiError(error);
  }
}
