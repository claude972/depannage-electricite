// E42 (registre phase 2) — ART-06 / SYS-03 / SYS-04 : lien explicite de conversation après relecture
// des droits. Le workspace relu n’inclut plus le dossier (réaffecté) : attendu (P1) une nouvelle
// lecture de l’historique du fil ouvert ; le refus (404) purge messages et saisie avant tout POST.
// Vrai MessageCenter monté (live, StrictMode, Chromium) ; le parent re-rend avec la liste relue.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageCenter } from "./components/app/forms";
${PRELUDE}
const ART = "a0000000-0000-4000-8000-000000000001";
const job = (n) => ({ id: "d0000000-0000-4000-8000-00000000000" + n, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: ART, site_id: null, category: "panel", description: "Tableau " + n, address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-0" + n + "T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" });
const J1 = job(1), J2 = job(2);
let reassigned = false;
window.gets = 0;
const fetchHistory = async (url) => {
  window.gets++;
  if (reassigned && String(url).includes(J1.id)) return new Response("{}", { status: 404 });
  const id = String(url).includes(J1.id) ? J1.id : J2.id;
  return new Response(JSON.stringify({ messages: [{ id: "m1" + id.slice(-1), intervention_id: id, author_id: ART, body: "Message ancien confidentiel", created_at: "2026-11-05T10:00:00Z" }], page: { has_more: false, next_cursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
};
window.scenarios = {
  async e42() {
    const div = mountPoint();
    let setList;
    function Host() { const [list, set] = useState([J1, J2]); setList = set; return h(MessageCenter, { interventions: list, messages: [], role: "artisan", profileId: ART, selectedId: J1.id, busy: false, onSubmit: async () => true, live: true, fetchHistory }); }
    createRoot(div).render(h(StrictMode, null, h(Host)));
    await until(() => /Message ancien confidentiel/.test(txt(div)));
    setInput(div.querySelector("#message-body"), "Brouillon");
    reassigned = true;
    const before = window.gets;
    setList([J2]); // workspace re-read: J1 no longer listed, explicit link kept
    await tick(400);
    return { reread: window.gets - before, message: /Message ancien confidentiel/.test(txt(div)), compose: !!div.querySelector("#message-body") };
  },
};
`;

test("E42 · dossier retiré du workspace relu ⇒ historique relu, 404 ⇒ messages et saisie purgés", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e42");
    assert.ok(r.reread >= 1, `nouvelle lecture de l’historique (GET : ${r.reread})`);
    assert.equal(r.message, false, "anciens messages purgés");
    assert.equal(r.compose, false, "saisie retirée");
    assert.deepEqual(errors, []);
  });
});
