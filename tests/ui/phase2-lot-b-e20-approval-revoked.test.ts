// E20 (registre phase 2) — ENT-12 : droits de site retirés pendant l’approbation. La décision du
// membre désigné reçoit 404. Attendu (P1) : relecture des droits et de la ressource ; la lecture
// refusée (404) purge l’historique (commentaires) et les actions ; aucun second POST.
// Vrai QuoteApprovalPanel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QuoteApprovalPanel } from "./components/features/advanced-approvals/approvals";
${PRELUDE}
const U = (p, n) => p + "0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const USER = U("1", 7), SITE = U("5", 1), QUOTE = U("3", 1);
const AT = "2026-11-07T10:00:00.000Z";
const policy = { version: 2, enabled: true, threshold_cents: 50000, steps: [{ role: "manager" }, { user_id: USER }, { role: "owner" }] };
const status = { quote_id: QUOTE, site_id: SITE, required: true, approved_current: false, policy, workflow: { version: 4, policy_version: 2, state: "pending", current_step: 2, steps: policy.steps, snapshot_matches: true }, permissions: { can_submit: false, can_decide: true, can_respond: false }, events: [{ version: 1, actor_id: U("1", 1), action: "submit", note: "Commentaire historique confidentiel", created_at: AT }], next_after: null };
const ctx = { generation: () => 0, userId: () => USER };
const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } }; };
window.scenarios = {
  async e20() {
    let revoked = false;
    const calls = { read: 0, act: 0 };
    const api = {
      workflow: async () => { calls.read++; return revoked ? { status: 404, body: null } : { status: 200, body: status }; },
      act: async () => { calls.act++; return { status: 404, body: null }; },
      policy: async () => ({ status: 404, body: null }), setPolicy: async () => ({ status: 404, body: null }),
    };
    const div = mountPoint();
    const s = mem(); let n = 0;
    createRoot(div).render(h(StrictMode, null, h(QuoteApprovalPanel, { quoteId: QUOTE, context: ctx, api, store: () => s, newId: () => U("c", ++n) })));
    await until(() => div.querySelector('[data-ap-action="approve"]'));
    revoked = true;
    const before = calls.read;
    div.querySelector('[data-ap-action="approve"]').click(); await tick(30);
    div.querySelector("[data-ap-execute]").click();
    await tick(400);
    const again = div.querySelector('[data-ap-action="approve"]');
    if (again && !again.disabled) { again.click(); await tick(30); div.querySelector("[data-ap-execute]")?.click(); await tick(300); }
    return { reread: calls.read - before, acts: calls.act, actions: !!div.querySelector("[data-ap-actions]"), history: /Commentaire historique confidentiel/.test(div.innerHTML) };
  },
};
`;

test("E20 · 404 à la décision ⇒ relecture, historique et actions purgés, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e20");
    assert.ok(r.reread >= 1, `relecture après le refus (GET : ${r.reread})`);
    assert.equal(r.actions, false, "actions de décision retirées");
    assert.equal(r.history, false, "commentaire historique purgé");
    assert.equal(r.acts, 1, "aucun second POST");
    assert.deepEqual(errors, []);
  });
});
