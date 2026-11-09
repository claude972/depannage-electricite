// E40 (registre phase 2) — CLI-06 / ART-06 / SYS-03 : contact conservé après réaffectation. Replier
// puis rouvrir « Contact et rendez-vous » doit relire les opérations (P1) : l’ancien artisan, dont la
// lecture est désormais refusée, ne revoit ni le téléphone ni le créneau.
// Vrai MessageCenter (bloc ConversationContact) monté (live, StrictMode, Chromium).
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MessageCenter } from "./components/app/forms";
${PRELUDE}
const J = "d0000000-0000-4000-8000-000000000001", ART = "a0000000-0000-4000-8000-000000000001", CLI = "c0000000-0000-4000-8000-000000000001";
const job = { id: J, client_id: CLI, artisan_id: ART, site_id: null, category: "panel", description: "Tableau", address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" };
const fetchHistory = async () => new Response(JSON.stringify({ messages: [], page: { has_more: false, next_cursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
window.scenarios = {
  async e40() {
    let reassigned = false, loads = 0;
    const loadOperations = async () => { loads++; return reassigned ? null : { participants: [{ id: CLI, full_name: "Client Recette", role: "client", phone: "0696 00 00 00" }], appointment: { intervention_id: J, starts_at: "2026-11-10T09:00:00Z", ends_at: "2026-11-10T11:00:00Z", note: "" }, report: null, history: [], history_limit: 50, travel_stage: "planned" }; };
    const context = { generation: () => 1, userId: () => ART };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(MessageCenter, { interventions: [job], messages: [], role: "artisan", profileId: ART, selectedId: J, busy: false, onSubmit: async () => true, live: true, fetchHistory, context, loadOperations })));
    const toggle = () => div.querySelector("[data-conversation-contact-toggle]");
    await until(() => toggle());
    toggle().click();
    await until(() => /0696/.test(txt(div)));
    toggle().click(); // fold
    await tick(50);
    reassigned = true; // the dossier is reassigned elsewhere
    const before = loads;
    toggle().click(); // reopen
    await tick(300);
    return { open: toggle().getAttribute("aria-expanded"), state: div.querySelector("[data-conversation-contact]")?.getAttribute("data-conversation-contact"), reread: loads - before, phone: /0696/.test(txt(div)), call: !!div.querySelector("[data-conversation-contact-call]") };
  },
};
`;

test("E40 · réouverture du contact ⇒ relecture ; lecture refusée ⇒ téléphone et créneau absents", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e40");
    assert.ok(r.reread >= 1, `relecture à la réouverture (lectures : ${r.reread}, ${r.open}, ${r.state})`);
    assert.equal(r.phone, false, "téléphone non réaffiché");
    assert.equal(r.call, false);
    assert.deepEqual(errors, []);
  });
});
