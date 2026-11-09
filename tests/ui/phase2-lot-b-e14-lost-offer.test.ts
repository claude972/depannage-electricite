// E14 (registre phase 2) — CLI-03 / ART-05 : offre perdue mais encore actionnable. Le perdant reçoit
// un refus à l’acceptation ; attendu (P1) : relecture ponctuelle de l’offre avant tout nouvel envoi ;
// 404 ⇒ offre retirée, plus de bouton d’acceptation, aucun second POST.
// Vrai AvailableMissionsPanel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AvailableMissionsPanel } from "./components/features/available-missions/available-missions-panel";
${PRELUDE}
const id = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const offer = (n) => ({ id: id(n), category: "socket", city: "Fort-de-France", postal_code: "972**", urgency: "urgent", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 18000, created_at: "2026-11-06T12:00:00+00:00" });
const pageBody = { items: [offer(1)], eligible: true, captured_at: "2026-11-06T12:30:00+00:00", page: { limit: 50, has_more: false, next_cursor: null }, projection: "anonymized", order: "oldest_first", distance: "not_calculated" };
const context = { generation: () => 1, userId: () => "a0000000-0000-4000-8000-000000000002" };
window.scenarios = {
  async e14() {
    let taken = false;
    const calls = { point: 0, accept: 0 };
    const api = {
      list: async () => ({ status: 200, body: pageBody, retryAfter: null }),
      point: async () => { calls.point++; return taken ? { status: 404, body: null, retryAfter: null } : { status: 200, body: pageBody, retryAfter: null }; },
    };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(AvailableMissionsPanel, { api, context, onAccept: async () => { calls.accept++; return false; }, onOpenAccepted: () => {} })));
    await until(() => div.querySelector("[data-available-offer]"));
    div.querySelector("[data-available-offer]").click();
    await until(() => div.querySelector("[data-available-accept]"));
    taken = true; // the other artisan won
    const pointsBefore = calls.point;
    div.querySelector("[data-available-accept]").click();
    await tick(300);
    const again = div.querySelector("[data-available-accept]");
    if (again && !again.disabled) { again.click(); await tick(300); }
    return { reread: calls.point - pointsBefore, accepts: calls.accept, acceptVisible: !!div.querySelector("[data-available-accept]"), rows: div.querySelectorAll("[data-available-offer]").length };
  },
};
`;

test("E14 · refus d’acceptation ⇒ relecture de l’offre, 404 ⇒ retirée, aucun second POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e14");
    assert.ok(r.reread >= 1, `relecture ponctuelle après le refus (GET : ${r.reread})`);
    assert.equal(r.acceptVisible, false, "plus de bouton d’acceptation");
    assert.equal(r.rows, 0, "offre retirée de la liste");
    assert.equal(r.accepts, 1, "aucun second POST refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
