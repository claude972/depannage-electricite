// E17 (registre phase 2) — CLI-05 : une réponse de suivi ancienne (partage actif) arrive après une
// réponse plus récente (partage arrêté) : elle ne doit jamais réafficher la position ni « Suivi actif ».
// Vraie TrackingCard montée (StrictMode, Chromium), client simulé, sondage accéléré (15 s ⇒ 100 ms).
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TrackingCard } from "./components/features/tracking/tracking-card";
${PRELUDE}
const realSetInterval = window.setInterval.bind(window);
window.setInterval = (fn, ms, ...a) => realSetInterval(fn, ms === 15000 ? 100 : ms, ...a);
const J = "d0000000-0000-4000-8000-000000000001", ART = "a0000000-0000-4000-8000-000000000001";
const snap = (shared) => {
  const now = new Date().toISOString();
  return { server_time: now, permissions: { can_share: false, can_confirm_destination: false }, tracking: { intervention_id: J, artisan_id: ART, travel_stage: "en_route", session_id: shared ? "b0000000-0000-4000-8000-000000000001" : null, control_version: shared ? 3 : 4, shared, consent_at: shared ? now : null, last_seq: shared ? 5 : 0, destination_version: 0, position_state: shared ? "fresh" : "stopped", position: shared ? { latitude: 14.6, longitude: -61.07, accuracy_m: 20, sampled_at: now, received_at: now } : null, destination: null } };
};
let calls = 0, held = null, mode = "late";
const gates = [];
const client = {
  load: async () => {
    calls++;
    if (mode === "slow") { await tick(160); return snap(true); } // every GET slower than the 100 ms poll
    if (mode === "blocked") {
      if (calls <= 2) return snap(true);
      if (calls === 3) return new Promise((r) => gates.push(() => r(snap(false)))); // the « stopped » reply
      return new Promise(() => {}); // every newer GET stays pending
    }
    if (calls <= 2) return snap(true); // StrictMode double mount: sharing active
    if (calls === 3) return new Promise((r) => { held = () => r(snap(true)); }); // OLD reply retained
    return snap(false); // newer replies: sharing stopped
  },
  command: async () => null, route: async () => null, geocode: async () => null,
};
const props = () => ({ state: "available", unavailableMessage: "", scope: { userId: "c0000000-0000-4000-8000-000000000001", role: "client", authority: { canWrite: true } }, client, interventionId: J });
window.scenarios = {
  async slow() {
    mode = "slow";
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(TrackingCard, props())));
    const shown = await until(() => /Suivi actif/.test(txt(div)), 2000);
    return { shown, calls };
  },
  async blocked() {
    mode = "blocked";
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(TrackingCard, props())));
    await until(() => /Suivi actif/.test(txt(div)));
    await until(() => calls >= 4 && gates.length === 1, 2000); // stop reply pending AND a newer GET pending
    gates[0]();
    await tick(50);
    return { active: /Suivi actif/.test(txt(div)) };
  },
  async e17() {
    mode = "late";
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(TrackingCard, props())));
    await until(() => /Suivi actif/.test(txt(div)));
    await until(() => calls >= 4 && !/Suivi actif/.test(txt(div)), 3000);
    const stoppedShown = !/Suivi actif/.test(txt(div));
    held(); // the old « active » reply finally arrives
    await tick(20);
    return { stoppedShown, after: /Suivi actif/.test(txt(div)) };
  },
};
`;

test("E17 · réponse ancienne après l’arrêt ⇒ jamais « Suivi actif » réaffiché", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e17");
    assert.equal(r.stoppedShown, true, "l’arrêt est affiché");
    assert.equal(r.after, false, "la réponse ancienne n’est pas appliquée");
    assert.deepEqual(errors, []);
  });
});

test("E17 · latence systématique supérieure au sondage ⇒ les réponses s’appliquent quand même", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("slow");
    assert.equal(r.shown, true, `une réponse finit par être affichée (lectures : ${r.calls})`);
    assert.deepEqual(errors, []);
  });
});

test("E17 · arrêt reçu pendant une lecture plus récente bloquée ⇒ l’arrêt s’applique", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("blocked");
    assert.equal(r.active, false, "« Suivi actif » retiré dès la réponse d’arrêt");
    assert.deepEqual(errors, []);
  });
});
