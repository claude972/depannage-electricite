/** Classification only; signature verification and SQL reference checks remain mandatory.
 * https://docs.stripe.com/api/events/types#event_types-checkout.session.expired
 */
/** A booking authorization is not a legacy quote Checkout. Call only AFTER signature validation.
 * Its current financial state is reconciled by the booking provider reader, never from this event. */
export function isBookingHoldSession(session: {
  object: string;
  mode: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}): boolean {
  const m = session.metadata;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return session.object === "checkout.session" && session.mode === "payment" && !!m &&
    m.booking_method === "card_hold" && !Object.hasOwn(m, "quote_id") &&
    uuid.test(m.booking_actor ?? "") && uuid.test(m.booking_request ?? "") &&
    session.client_reference_id === m.booking_request;
}

export function checkoutEventOutcome(
  eventType: string,
  session: { object: string; mode: string | null; payment_status: string; status: string | null },
): "paid" | "failed" | "ignore" {
  if (session.object !== "checkout.session" || session.mode !== "payment") return "ignore";
  if ((eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") && session.payment_status === "paid") return "paid";
  if (session.payment_status !== "unpaid") return "ignore";
  if (eventType === "checkout.session.expired" && session.status === "expired") return "failed";
  if (eventType === "checkout.session.async_payment_failed" && session.status === "complete") return "failed";
  return "ignore";
}
