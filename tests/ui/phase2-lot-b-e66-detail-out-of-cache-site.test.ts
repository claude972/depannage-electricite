// E66 (registre phase 2) — ENT-06 : après création d’un ticket sur le 101e site (sites tronqués dans
// le workspace), la fiche s’ouvre sur le bon identifiant mais affichait « Dossier absent des
// interventions chargées » sans aucun GET avant « Ouvrir quand même ». Attendu : la lecture
// ponctuelle du détail part automatiquement quand la liste des sites est tronquée (ou quand le
// workspace connaît le dossier sans l’afficher) ; le détail exact est montré ; un tiers reçoit 404.
// Vrai hook useDetailPresence dans une vraie racine React (Chromium), lecture simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { useDetailPresence } from "./components/role/use-detail-presence";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
const id = "10000000-0000-4000-8000-000000000101", stamp = "2026-11-08T10:00:00.000Z";
const envelope = { intervention: { id, client_id: "10000000-0000-4000-8000-000000000002", artisan_id: null, site_id: "50000000-0000-4000-8000-000000000101", category: "panel", description: "Ticket urgent site 101", address: "2 rue test", postal_code: "97200", city: "Test", urgency: "urgent", estimate_min_cents: 1, estimate_max_cents: 2, status: "requested", created_at: stamp, updated_at: stamp, completed_at: null, paid_at: null, travel_stage: "planned" }, site: { status: "none" }, organization: { status: "none" }, quotes: { status: "ok", items: [], limited: false }, messages: { status: "ok", items: [], limited: false }, documents: { status: "ok", items: [], limited: false }, appointments: { status: "ok", items: [], limited: false }, payments: { status: "ok", items: [], limited: false, incomplete: false }, generated_at: stamp };
window.calls = 0;
function mount(ctx, data, fetcher) {
  const div = mountPoint();
  function App() {
    const p = useDetailPresence({ mode: "live", refreshContext: ctx, ensureFresh: async () => ({ kind: "loaded" }), data }, "enterprise-detail", id, false, fetcher);
    window.last = { decision: p.decision, detail: p.detail && p.detail.intervention.description, openAnyway: Boolean(p.openAnyway) };
    return h("pre", null, JSON.stringify(window.last));
  }
  createRoot(div).render(h(App));
}
window.scenarios = {
  async sites() {
    window.calls = 0;
    mount("g1|manager|o1|", { limits: { interventions: { limited: false }, sites: { limited: true, limit: 100 } }, interventions: [] }, async () => { window.calls++; return envelope; });
    await tick(400);
    return { calls: window.calls, last: window.last };
  },
  async third() {
    window.calls = 0;
    mount("g2|manager|o2|", { limits: { interventions: { limited: false }, sites: { limited: true, limit: 100 } }, interventions: [] }, async () => { window.calls++; throw new ApiRequestError(404, "introuvable"); });
    await tick(400);
    return { calls: window.calls, last: window.last };
  },
};
`;

test("E66 · sites tronqués ⇒ lecture ponctuelle automatique du détail exact ; tiers ⇒ 404 introuvable", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("sites") as { calls: number; last: { decision: string; detail?: string } };
    assert.ok(r.calls >= 1, `GET automatique (lectures : ${r.calls})`);
    assert.equal(r.last.decision, "detail");
    assert.equal(r.last.detail, "Ticket urgent site 101");
    const t = await run("third") as { calls: number; last: { decision: string } };
    assert.ok(t.calls >= 1);
    assert.equal(t.last.decision, "not_found", "tiers : introuvable prouvé");
    assert.deepEqual(errors, []);
  });
});
