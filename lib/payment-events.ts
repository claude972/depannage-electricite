/** Classification only; signature verification and SQL reference checks remain mandatory.
 * https://docs.stripe.com/api/events/types#event_types-checkout.session.expired
 */
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
