// Astra review of ddc34c7: with an ACTIVE advanced policy, an old simple approval still « pending »
// blocked acceptance even when the server said approved_current, and a quote under the advanced
// threshold stayed blocked. Real decision function + the dossier wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptanceDecision, type WorkflowStatus } from "../../components/features/advanced-approvals/model";

const status = (o: { enabled: boolean | null; required: boolean; approved: boolean }) =>
  ({
    required: o.required,
    approved_current: o.approved,
    policy: o.enabled === null ? null : { version: 1, enabled: o.enabled, threshold_cents: 100000, steps: [{ role: "owner", member_id: null }] },
  }) as unknown as WorkflowStatus;

test("active advanced policy is authoritative over an old pending simple approval", () => {
  // Advanced approved_current ⇒ NOT blocked, even with the old simple approval pending (the bug).
  assert.deepEqual(acceptanceDecision(true, status({ enabled: true, required: true, approved: true }), true), { blocked: false, reason: null });
  // Under the advanced threshold (required false) ⇒ NOT blocked, even with a pending simple approval.
  assert.deepEqual(acceptanceDecision(true, status({ enabled: true, required: false, approved: false }), true), { blocked: false, reason: null });
  // Advanced required and not approved ⇒ blocked by the advanced chain.
  assert.deepEqual(acceptanceDecision(false, status({ enabled: true, required: true, approved: false }), true), { blocked: true, reason: "advanced" });
});

test("no active advanced policy ⇒ the simple rule applies unchanged", () => {
  for (const enabled of [null, false] as const) {
    assert.deepEqual(acceptanceDecision(true, status({ enabled, required: false, approved: false }), true), { blocked: true, reason: "simple" });
    assert.deepEqual(acceptanceDecision(false, status({ enabled, required: false, approved: false }), true), { blocked: false, reason: null });
  }
});

test("live and advanced state loading (undefined) or unreadable (null) ⇒ prudent block; demo ⇒ simple rule", () => {
  assert.deepEqual(acceptanceDecision(false, undefined, true), { blocked: true, reason: "unknown" });
  assert.deepEqual(acceptanceDecision(false, null, true), { blocked: true, reason: "unknown" });
  assert.deepEqual(acceptanceDecision(false, undefined, false), { blocked: false, reason: null });
  assert.deepEqual(acceptanceDecision(true, undefined, false), { blocked: true, reason: "simple" });
});

test("dossier WITHOUT a site: no site policy can apply ⇒ simple rule (the route's 404 never closes it); WITH a site a 404/403/error stays closed", () => {
  assert.deepEqual(acceptanceDecision(false, null, true, false), { blocked: false, reason: null });
  assert.deepEqual(acceptanceDecision(false, undefined, true, false), { blocked: false, reason: null });
  assert.deepEqual(acceptanceDecision(true, null, true, false), { blocked: true, reason: "simple" });
  assert.deepEqual(acceptanceDecision(false, null, true, true), { blocked: true, reason: "unknown" }, "404 of a dossier with a site stays closed");
  // Only a validated 200 with policy null/disabled confirms the simple rule for a dossier with a site.
  assert.deepEqual(acceptanceDecision(false, status({ enabled: null, required: false, approved: false }), true, true), { blocked: false, reason: null });
});

test("wiring: the dossier uses acceptanceDecision for blocking and its reason for the message", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /const acceptance = acceptanceDecision\(Boolean\(approval && approval\.status !== "approved"\), advanced, !demo && Boolean\(displayed\), Boolean\(intervention\.site_id\)\);\s+const blocking = acceptance\.blocked;/);
  // Reset per quote_id: the state is kept with its quote and reused only for that exact quote.
  assert.match(src, /const advanced: WorkflowStatus \| null \| undefined = displayed && advancedRead\?\.quoteId === displayed\.id \? advancedRead\.status : undefined;/);
  assert.match(src, /onStatus=\{\(st\) => setAdvancedRead\(\{ quoteId: displayed\.id, status: st \}\)\}/);
  assert.match(src, /\{displayed && intervention\.site_id && \(\s+<QuoteApprovalPanel/, "no advanced read for a site-less dossier");
  assert.match(src, /acceptance\.reason === "unknown"\s+\? "L’état de l’approbation interne de ce devis n’a pas encore pu être lu/);
  assert.doesNotMatch(src, /Boolean\(approval && approval\.status !== "approved"\) \|\| advancedBlocked/, "old OR rule gone");
});
