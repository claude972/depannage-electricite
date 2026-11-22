// E57 (registre phase 2) — ENT-03 : fiche de site ouverte hors cache (chargeur direct). Renommage,
// réponse du premier POST perdue, « Réessayer » ⇒ 200. Attendu (P3) : la confirmation
// « Paramètres enregistrés. » reste affichée après la relecture parente (pas de démontage du panneau).
// Vrais SiteDirectLoader + SiteSettingsPanel montés (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteDirectLoader } from "./components/features/site-lifecycle/site-direct";
import { SiteSettingsPanel } from "./components/features/site-lifecycle/site-lifecycle-panels";
${PRELUDE}
const SITE = "50000000-0000-4000-8000-000000000101", ORG = "51000000-0000-4000-8000-000000000001", AT = "2026-11-01T10:00:00.000Z";
let site = { id: SITE, organization_id: ORG, name: "Site 101", address: "12 rue des Flamboyants, Fort-de-France", access_notes: "Badge au gardien", opening_hours: [{ day: 1, opens: "08:00", closes: "12:00" }], type: "syndic", budget_cents: 500000, settings_version: 1, archived_at: null, created_at: AT };
let lose = true;
const api = {
  settings: async () => { await tick(30); return { status: 200, retryAfter: null, body: { site, can_write: true } }; },
  command: async (_s, c) => {
    if (c.expected_version === site.settings_version) site = { ...site, ...c.values, settings_version: site.settings_version + 1 };
    if (lose) { lose = false; return { status: 503, body: null, retryAfter: null }; }
    return { status: 200, retryAfter: null, body: { site } };
  },
  sites: async () => ({ status: 404, body: null, retryAfter: null }),
};
const context = { generation: () => 1, userId: () => "10000000-0000-4000-8000-000000000001" };
const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: (k) => void m.delete(k) }; };
window.scenarios = {
  async e57() {
    const div = mountPoint();
    const store = mem();
    createRoot(div).render(h(StrictMode, null, h(SiteDirectLoader, { siteId: SITE, organizationId: ORG, api, context, render: (_site, state, reload) => h(SiteSettingsPanel, { siteId: SITE, context, demo: false, initial: state, api, store, onChanged: () => reload() }) })));
    if (!(await until(() => div.querySelector("[data-sl-form]")))) return { notice: "NO FORM: " + txt(div).slice(0, 400), name: null };
    setInput(div.querySelector("[data-sl-form] input"), "Site 101 renommé");
    div.querySelector("[data-sl-save]").click();
    await until(() => div.querySelector("[data-sl-retry]"));
    div.querySelector("[data-sl-retry]").click();
    await tick(500);
    return { notice: txt(div.querySelector("[data-sl-notice]")), name: div.querySelector("[data-sl-form] input")?.value ?? null };
  },
};
`;

test("E57 · rejeu réussi ⇒ confirmation persistante après la relecture parente", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e57");
    assert.match(r.notice, /Paramètres enregistrés/, `confirmation visible (notice : « ${r.notice} »)`);
    assert.deepEqual(errors, []);
  });
});
