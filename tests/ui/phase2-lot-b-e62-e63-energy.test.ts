// E62 / E63 (registre phase 2) — ENT-09 : relevés énergie d’un site.
// E63 : droit au site retiré pendant l’édition ⇒ le premier refus (404) relit la liste et purge la
//       ligne, la saisie et l’action ; aucun second POST refusé.
// E62 : réponse perdue d’une création puis « Réessayer » 200 ⇒ le formulaire quitte le mode
//       création ; une modification suivante envoie la version enregistrée (jamais expected_version
//       null avec le même identifiant).
// Panneau réel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteEnergyPanel } from "./components/features/energy/site-energy-panel";
${PRELUDE}
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-06T10:00:00.000Z";
const rec = (n, over = {}) => ({ id: "60000000-0000-4000-8000-" + String(n).padStart(12, "0"), site_id: SITE, meter_label: "Compteur " + n, period_start: "2026-10-01", period_end: "2026-10-31", consumption_wh: 12345, cost_cents: 2500, source_kind: "invoice", source_reference: "F-" + n, note: "", version: 1, created_by: USER, created_at: NOW, updated_by: USER, updated_at: NOW, archived_at: null, ...over });
const page = (records) => ({ status: 200, retryAfter: null, body: { records, page: { limit: 100, has_more: false, next_cursor: null }, totals: { consumption_wh: 12345 * records.length, cost_cents: 2500 * records.length, complete: true, cost_complete: true }, permissions: { can_write: true }, basis: "recorded_periods_fully_inside_range" } });
const context = { generation: () => 0, userId: () => USER };
const field = (div, label) => [...div.querySelectorAll("label")].find((l) => (l.textContent || "").startsWith(label))?.querySelector("input,textarea");
window.scenarios = {
  async e63() {
    let revoked = false;
    const calls = { list: 0, command: 0 };
    const api = {
      list: async () => { calls.list++; return revoked ? { status: 404, body: null, retryAfter: null } : page([rec(1)]); },
      command: async () => { calls.command++; return { status: 404, body: null, retryAfter: null }; },
    };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(SiteEnergyPanel, { siteId: SITE, api, context })));
    await until(() => btn(div, "Modifier"));
    btn(div, "Modifier").click();
    await until(() => div.querySelector("[data-energy-form]"));
    setInput(field(div, "Consommation"), "20");
    revoked = true;
    const listBefore = calls.list;
    div.querySelector("[data-energy-save]").click();
    await tick(250);
    const save = div.querySelector("[data-energy-save]");
    if (save && !save.disabled) { save.click(); await tick(250); }
    return { relisted: calls.list - listBefore, commands: calls.command, rows: div.querySelectorAll("[data-energy-id]").length, form: !!div.querySelector("[data-energy-form]") };
  },
  async e62() {
    const posts = [];
    let lose = true;
    const created = rec(7, { meter_label: "Compteur neuf" });
    const api = {
      list: async () => page(posts.length ? [created] : []),
      command: async (_s, body) => {
        posts.push(JSON.parse(JSON.stringify(body)));
        if (lose) { lose = false; return { status: 503, body: null, retryAfter: null }; }
        if (body.expected_version === null) return { status: 200, retryAfter: null, body: { record: created } };
        return body.expected_version === 1 ? { status: 200, retryAfter: null, body: { record: { ...created, version: 2, consumption_wh: 30000 } } } : { status: 409, body: null, retryAfter: null };
      },
    };
    const div = mountPoint();
    let n = 0;
    createRoot(div).render(h(StrictMode, null, h(SiteEnergyPanel, { siteId: SITE, api, context, newId: () => "60000000-0000-4000-8000-00000000000" + (7 + n++ * 0) })));
    await until(() => div.querySelector("[data-energy-add]"));
    div.querySelector("[data-energy-add]").click();
    await until(() => div.querySelector("[data-energy-form]"));
    setInput(field(div, "Compteur"), "Compteur neuf");
    setInput(field(div, "Début de période"), "2026-10-01");
    setInput(field(div, "Fin de période"), "2026-10-31");
    setInput(field(div, "Consommation"), "12.345");
    setInput(field(div, "Référence de la source"), "F-7");
    div.querySelector("[data-energy-save]").click();
    await until(() => div.querySelector("[data-energy-retry]"));
    div.querySelector("[data-energy-retry]").click();
    await tick(250);
    const modeAfterRetry = div.querySelector("[data-energy-form]")?.getAttribute("data-energy-form") ?? "closed";
    // Edit the saved period and save again from whatever the screen offers.
    if (modeAfterRetry === "closed") { btn(div, "Modifier").click(); await until(() => div.querySelector("[data-energy-form]")); }
    setInput(field(div, "Consommation"), "30");
    div.querySelector("[data-energy-save]").click();
    await tick(250);
    return { modeAfterRetry, last: posts[posts.length - 1], alert: txt(div.querySelector("[data-energy-form] [role=alert]")) };
  },
};
`;

test("E63 · 404 à l’enregistrement ⇒ relecture, ligne et formulaire purgés, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e63");
    assert.ok(r.relisted >= 1, `relecture après le refus (GET : ${r.relisted})`);
    assert.equal(r.rows, 0, "ancienne ligne retirée");
    assert.equal(r.form, false, "saisie et action retirées");
    assert.equal(r.commands, 1, "aucun second POST refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});

test("E62 · rejeu réussi ⇒ plus de formulaire de création ; la modification suivante porte la version 1", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e62");
    assert.notEqual(r.modeAfterRetry, "create", "le formulaire ne reste pas en création après le rejeu réussi");
    assert.equal(r.last.expected_version, 1, `modification suivante sur la version enregistrée (reçu ${JSON.stringify(r.last.expected_version)})`);
    assert.equal(r.alert, "", "aucun conflit 409");
    assert.deepEqual(errors, []);
  });
});
