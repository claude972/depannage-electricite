import test from "node:test";
import assert from "node:assert/strict";
import { checkoutEventOutcome } from "../lib/payment-events";
const session = { object: "checkout.session", mode: "payment", payment_status: "unpaid", status: "open" };
test("only paid Checkout payment events count as successful settlement", () => {
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
    assert.equal(checkoutEventOutcome(type, session), "ignore");
    assert.equal(checkoutEventOutcome(type, { ...session, status: "complete", payment_status: "paid" }), "paid");
  }
});
test("failure requires its documented terminal state and never classifies a paid session as failed", () => {
  assert.equal(checkoutEventOutcome("checkout.session.expired", { ...session, status: "expired" }), "failed");
  assert.equal(checkoutEventOutcome("checkout.session.async_payment_failed", { ...session, status: "complete" }), "failed");
  assert.equal(checkoutEventOutcome("checkout.session.expired", session), "ignore");
  for (const type of ["checkout.session.expired", "checkout.session.async_payment_failed"]) assert.equal(checkoutEventOutcome(type, { ...session, status: "expired", payment_status: "paid" }), "ignore");
});
test("unrelated resources, subscription sessions and non-checkout events cannot mutate payment state", () => {
  for (const input of [{ ...session, object: "charge" }, { ...session, mode: "subscription" }, { ...session, mode: "setup" }]) assert.equal(checkoutEventOutcome("checkout.session.completed", { ...input, payment_status: "paid" }), "ignore");
  assert.equal(checkoutEventOutcome("charge.failed", session), "ignore");
});
