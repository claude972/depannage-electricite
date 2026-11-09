// E38 (registre phase 2) — ART-03 / ADM-02 / SYS-03 : rôle admin retiré, l’ancien écran d’examen
// d’un justificatif reste affiché. Le POST d’examen répond 403. Attendu : relecture immédiate ; le
// refus de lecture (404) purge la pièce, les motifs et le formulaire ; un seul POST.
// Panneau réel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CredentialReviewPanel } from "./components/features/credential-reviews/credential-review-panel";
${PRELUDE}
const CRED = "a0000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const page = { credential_id: CRED, kind: "liability", expires_on: "2027-06-30", can_review: true, current_version: 1, reviews: [{ version: 1, decision: "changes_requested", reason: "Motif confidentiel de la première décision", reviewed_at: "2026-11-07T10:00:00.000Z" }], next_before: null };
const context = { generation: () => 0, userId: () => USER };
const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => void m.delete(k) }; };
window.scenarios = {
  async e38() {
    let revoked = false;
    const calls = { get: 0, post: 0 };
    const api = {
      read: async () => { calls.get++; return revoked ? { status: 404, body: null, retryAfter: null } : { status: 200, body: page, retryAfter: null }; },
      review: async () => { calls.post++; return { status: 403, body: null, retryAfter: null }; },
    };
    const div = mountPoint();
    let n = 0;
    createRoot(div).render(h(StrictMode, null, h(CredentialReviewPanel, { credentialId: CRED, mode: "admin", api, context, store: mem(), newId: () => "c0000000-0000-4000-8000-00000000000" + ++n })));
    await until(() => div.querySelector("[data-cr-form]"));
    div.querySelector('[data-cr-form] input[type=radio]').click();
    setInput(div.querySelector("[data-cr-form] textarea"), "Pièce lisible et valide");
    revoked = true;
    const before = calls.get;
    div.querySelector("[data-cr-submit]").click();
    await tick(300);
    const s = div.querySelector("[data-cr-submit]");
    if (s && !s.disabled) { s.click(); await tick(300); }
    return { reread: calls.get - before, posts: calls.post, form: !!div.querySelector("[data-cr-form]"), reason: /Motif confidentiel/.test(txt(div)) };
  },
};
`;

test("E38 · 403 à l’examen ⇒ relecture, pièce, motifs et formulaire purgés, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e38");
    assert.ok(r.reread >= 1, `relecture après le refus (GET : ${r.reread})`);
    assert.equal(r.form, false, "formulaire d’examen retiré");
    assert.equal(r.reason, false, "motif historique purgé");
    assert.equal(r.posts, 1, "aucun second POST refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
