// E03 (registre phase 2) — ADM-06.2 : reprise après une version obsolète. Une modération reçoit 409 ;
// attendu (P1, 409) : relecture de l’avis dans le même écran, motif conservé, conflit signalé ; la
// confirmation suivante porte la version relue (jamais la version périmée).
// Vrai PlatformModerationView monté (StrictMode, Chromium), client simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlatformModerationView } from "./components/features/platform-operations/platform-moderation-view";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
const caps = { support: false, support_reply: false, support_status: false, operators: false, audit: false, finance: false, reviews_moderation: true, refund_execution: false, invoice_rendering: false };
const access = { super_admin: false, scopes: ["reviews_moderation"], super_admin_count: null, capabilities: caps, config: { commission: { setting_bps: null, setting_version: null, checkout_bps: null, aligned: null }, payment_provider: { configured: false, mode: null, live_enabled: false }, invoice_issuer: { configured: false } } };
let version = 1;
const review = () => ({ id: "70000000-0000-4000-8000-000000000001", intervention_id: "d0000000-0000-4000-8000-000000000001", author_id: "c0000000-0000-4000-8000-000000000001", artisan_id: "a0000000-0000-4000-8000-000000000001", rating: 2, body: "Avis de recette", created_at: "2026-11-05T10:00:00+00:00", moderation: { state: "visible", version, note: "", updated_at: "2026-11-06T10:00:00+00:00" }, contestations: [] });
window.posts = [];
const scope = { userId: "f0000000-0000-4000-8000-000000000002", role: "client", authority: { canWrite: true } };
window.scenarios = {
  async e03() {
    const client = {
      load: { me: async () => access, reviews: async () => ({ reviews: [review()], page: { limit: 25, total: 1, has_more: false, next_cursor: null } }) },
      command: { moderateReview: async (_id, body) => { window.posts.push(body); if (body.expected_version !== version) throw new ApiRequestError(409, "Version périmée."); return { ok: true }; } },
    };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(PlatformModerationView, { state: "available", unavailableMessage: "", scope, client })));
    await until(() => btn(div, "Masquer"));
    btn(div, "Masquer").click(); await tick(20);
    version = 2; // another operator moderated meanwhile
    setInput(div.querySelector("textarea"), "Propos injurieux envers l’artisan");
    btn(div, "Confirmer").click();
    await tick(300);
    const kept = div.querySelector("textarea")?.value ?? null;
    const alert = txt(div.querySelector("[role=alert]"));
    btn(div, "Confirmer")?.click();
    await tick(300);
    return { posts: window.posts, kept, alert };
  },
};
`;

test("E03 · 409 ⇒ relecture, motif conservé, conflit signalé, renvoi avec la version relue", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e03");
    assert.equal(r.kept, "Propos injurieux envers l’artisan", "motif conservé");
    assert.match(r.alert, /modifié|périmée|entre-temps/i, "conflit signalé");
    assert.equal(r.posts.length, 2);
    assert.equal(r.posts[1].expected_version, 2, `renvoi sur la version relue (reçu ${r.posts[1]?.expected_version})`);
    assert.deepEqual(errors, []);
  });
});
