import assert from "node:assert/strict";
import test from "node:test";
import { kindsForRole, notificationLabel, preferenceLabel } from "../lib/features/notifications/kinds";

// ENT-12 — migration 20261122150000 stores the artisan's notice under approval_decided with
// payload.subject = "quote_not_approved".
test("an internal refusal of the quote is labelled for the artisan and can be muted by them", () => {
  assert.equal(notificationLabel({ kind: "approval_decided", payload: { subject: "quote_not_approved", reference: "INT-ABC123" } }), "Devis non approuvé par le client");
  // The organisation's own decision notice keeps its label; the subject alone never relabels another kind.
  assert.equal(notificationLabel({ kind: "approval_decided", payload: { decision: "rejected" } }), "Décision d’approbation interne");
  assert.equal(notificationLabel({ kind: "quote_rejected", payload: { subject: "quote_not_approved" } }), "Devis refusé");
  assert.ok(kindsForRole("artisan").includes("approval_decided"), "the artisan can mute the kind they now receive");
  assert.ok(!kindsForRole("client").includes("approval_decided"));
  assert.match(preferenceLabel("approval_decided"), /non approuvé par le client/);
});
