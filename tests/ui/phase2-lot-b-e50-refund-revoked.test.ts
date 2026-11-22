// E50 (registre phase 2) — FIN-04 / SYS-03 : le droit finance_write est retiré pendant que la
// confirmation d’émission est ouverte. Le POST répond 403. Attendu : la réponse 403 déclenche une
// relecture des droits et de la ressource avant tout nouveau POST ; si la relecture rend la demande
// en lecture seule, l’action d’émission disparaît. Panneau réel monté (StrictMode), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RefundExecutionPanel } from "./components/features/refund-execution/refund-execution-panel";
${PRELUDE}
const REQ = "70000000-0000-4000-8000-000000000001";
const request = { id: REQ, payment_id: "40000000-0000-4000-8000-000000000001", amount_cents: 12345, currency: "eur", status: "approved", version: 3 };
const read = (o = {}) => ({ status: 200, retryAfter: null, body: { request_status: "approved", execution_status: null, execution_id: null, eligible: true, available: true, reason: "approval_required", ...o } });
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
const store = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true) }; };
window.scenarios = {
  async revoked() {
    // Server truth after the revocation: read-only, and every POST is refused 403.
    let revoked = false;
    const calls = { get: 0, post: 0 };
    const api = {
      read: async () => { calls.get++; return revoked ? read({ available: false, reason: "read_only" }) : read(); },
      execute: async () => { calls.post++; return { status: 403, body: null, retryAfter: null }; },
    };
    const div = mountPoint();
    const s = store(); let n = 0;
    createRoot(div).render(h(StrictMode, null, h(RefundExecutionPanel, { request, capability: true, api, context, store: s, newId: () => "c0000000-0000-4000-8000-00000000000" + ++n })));
    await until(() => div.querySelector("[data-rx-open]"));
    div.querySelector("[data-rx-open]").click();
    await until(() => div.querySelector("[data-rx-execute]"));
    revoked = true;
    const getsBefore = calls.get;
    div.querySelector("[data-rx-execute]").click();
    await tick(300);
    const getsAfterRefusal = calls.get - getsBefore;
    // Second attempt from the same document.
    const open = div.querySelector("[data-rx-open]");
    if (open && !open.disabled) { open.click(); await tick(50); const ex = div.querySelector("[data-rx-execute]"); if (ex && !ex.disabled) ex.click(); await tick(200); }
    return { posts: calls.post, getsAfterRefusal, openVisible: !!div.querySelector("[data-rx-open]"), readOnly: !!div.querySelector('[data-rx-reason="read_only"]') };
  },
};
`;

test("E50 · 403 à l’émission ⇒ relecture, action retirée, aucun second POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("revoked");
    assert.ok(r.getsAfterRefusal >= 1, `relecture après le 403 (GET émis : ${r.getsAfterRefusal})`);
    assert.equal(r.openVisible, false, "le bouton « Émettre » disparaît après la relecture en lecture seule");
    assert.equal(r.readOnly, true, "le motif lecture seule est affiché");
    assert.equal(r.posts, 1, "un seul POST, jamais de second envoi refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
