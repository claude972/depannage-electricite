// E39 (registre phase 2) — CLI-06 / ART-06 / SYS-03 : données du fil après expiration signalée par
// l’API. « Charger les messages plus anciens » répond 401 ; attendu (P1 401) : purge des messages et
// du formulaire de saisie dans le même document, message de reconnexion, aucune nouvelle requête.
// Vrai MessageCenter monté (live, StrictMode, Chromium), lecture d’historique simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MessageCenter } from "./components/app/forms";
${PRELUDE}
const J = "d0000000-0000-4000-8000-000000000001";
const job = { id: J, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Tableau", address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" };
const msg = (n) => ({ id: "m" + n, intervention_id: J, author_id: "a0000000-0000-4000-8000-000000000001", body: "Message privé " + n, created_at: new Date(Date.parse("2026-11-05T10:00:00Z") - n * 60000).toISOString() });
window.calls = 0;
const fetchHistory = async (url) => {
  window.calls++;
  if (String(url).includes("cursor=")) return new Response(JSON.stringify({ error: "x" }), { status: 401 });
  return new Response(JSON.stringify({ messages: Array.from({ length: 5 }, (_, i) => msg(i + 1)), page: { has_more: true, next_cursor: "C1" } }), { status: 200, headers: { "content-type": "application/json" } });
};
window.scenarios = {
  async e39() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(MessageCenter, { interventions: [job], messages: [], role: "client", profileId: "c0000000-0000-4000-8000-000000000001", selectedId: J, busy: false, onSubmit: async () => true, live: true, fetchHistory })));
    await until(() => div.querySelector("[data-message-older]"));
    div.querySelector("[data-message-older]").click();
    await until(() => div.querySelector("[data-message-history=signed_out]"));
    await tick(200);
    return { rows: div.querySelectorAll("[data-message-id]").length, compose: !!div.querySelector("#message-body"), alert: txt(div.querySelector("[data-message-history=signed_out]")) };
  },
};
`;

test("E39 · 401 sur l’historique ⇒ messages et saisie purgés, reconnexion demandée", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e39");
    assert.equal(r.rows, 0, `messages purgés (affichés : ${r.rows})`);
    assert.equal(r.compose, false, "formulaire de saisie retiré");
    assert.match(r.alert, /Reconnectez-vous/);
    assert.deepEqual(errors, []);
  });
});
