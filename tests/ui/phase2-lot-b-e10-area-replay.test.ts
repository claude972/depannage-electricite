// E10 (registre phase 2) — ENT-08 : formulaire de zone après reprise d’une création. La réponse de
// la création est perdue (503), « Réessayer » rejoue la même commande (200, sans doublon).
// Attendu (P3) : le formulaire quitte la création et devient l’édition de la zone enregistrée ; une
// modification suivante porte expected_version 1 (jamais null avec le même identifiant ⇒ 409).
// Vrai SiteAreasPanel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteAreasPanel } from "./components/features/site-areas/site-areas-panel";
${PRELUDE}
const SITE = "50000000-0000-4000-8000-000000000001", USER = "10000000-0000-4000-8000-000000000009", NOW = "2026-11-06T10:00:00.000Z";
const ZID = "70000000-0000-4000-8000-000000000001";
let row = null;
const page = () => ({ status: 200, retryAfter: null, body: { records: row ? [row] : [], page: { limit: 100, total: row ? 1 : 0, remaining: row ? 1 : 0, has_more: false, next_cursor: null, complete: true }, limits: { max_depth: 4, max_active: 1000 }, permissions: { can_write: true } } });
window.posts = [];
let lose = true;
const api = {
  list: async () => page(),
  command: async (_s, c) => {
    window.posts.push(JSON.parse(JSON.stringify(c)));
    const current = row ? row.version : 0;
    if ((c.expected_version ?? 0) !== current && !(row && c.expected_version === null && window.posts.filter((p) => p.command_id === c.command_id).length > 1)) return { status: 409, body: null, retryAfter: null };
    if (!row || c.expected_version !== null) row = { id: c.id, site_id: SITE, parent_id: null, label: c.values.label, kind: c.values.kind, reference: c.values.reference, note: c.values.note, depth: 1, version: current + (row && c.expected_version === null ? 0 : 1), created_by: USER, created_at: NOW, updated_by: USER, updated_at: NOW, archived_at: null };
    if (lose) { lose = false; return { status: 503, body: null, retryAfter: null }; }
    return { status: 200, retryAfter: null, body: { record: row } };
  },
};
const field = (div, label) => [...div.querySelectorAll("label")].find((l) => (l.textContent || "").startsWith(label))?.querySelector("input,textarea,select");
window.scenarios = {
  async e10() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(SiteAreasPanel, { siteId: SITE, api, context: { generation: () => 1, userId: () => USER }, newId: () => (window.posts.length ? crypto.randomUUID() : ZID) })));
    await until(() => div.querySelector("[data-areas-add]"));
    div.querySelector("[data-areas-add]").click();
    await until(() => field(div, "Nom"));
    setInput(field(div, "Nom"), "Étage 1");
    div.querySelector("form button[type=submit]").click();
    await until(() => div.querySelector("[data-areas-retry]"));
    div.querySelector("[data-areas-retry]").click();
    await tick(300);
    const formOpen = !!div.querySelector("form");
    if (!formOpen) { const m = btn(div, "Modifier"); m?.click(); await until(() => field(div, "Nom")); }
    setInput(field(div, "Nom"), "Étage 1 bis");
    div.querySelector("form button[type=submit]").click();
    await tick(300);
    return { posts: window.posts, alert: txt(div.querySelector("form [role=alert]")) };
  },
};
`;

test("E10 · rejeu réussi ⇒ édition de la zone ; modification suivante en version 1, sans 409", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e10");
    const last = r.posts[r.posts.length - 1];
    assert.equal(last.expected_version, 1, `modification suivante sur la version enregistrée (reçu ${JSON.stringify(last.expected_version)})`);
    assert.equal(r.alert, "", "aucun conflit");
    assert.deepEqual(errors, []);
  });
});
