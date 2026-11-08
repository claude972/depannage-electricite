// E64 (registre phase 2) — ENT-05 / SYS-03 : l’ancien gestionnaire perd l’accès à la copropriété
// pendant l’édition d’une assemblée. Le POST répond 403. Attendu : relecture des droits et de la
// ressource ; le refus de lecture (404) purge la liste, le lieu saisi et l’action ; un seul POST.
// Panneau réel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CoOwnershipPanel } from "./components/features/co-ownership/co-ownership-panel";
${PRELUDE}
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-06T10:00:00.000Z";
const meeting = { id: "61000000-0000-4000-8000-000000000001", site_id: SITE, version: 2, created_by: USER, updated_by: USER, created_at: NOW, updated_at: NOW, archived_at: null, kind: "meeting", values: { title: "AG annuelle", starts_at: "2026-12-01T18:00:00.000Z", ends_at: null, location: "Salle commune", agenda: "Budget", minutes: "", decisions: [], status: "scheduled" } };
const page = (kind, records) => ({ status: 200, retryAfter: null, body: { records, page: { limit: 50, total: records.length, remaining: records.length, has_more: false, next_cursor: null, complete: true }, permissions: { can_write: true }, basis: "human_documentary_records", capabilities: { sends_notices: false, collects_funds: false, legal_validation: false } } });
const context = { generation: () => 0, userId: () => USER };
const field = (div, label) => [...div.querySelectorAll("label")].find((l) => (l.textContent || "").startsWith(label))?.querySelector("input,textarea,select");
window.scenarios = {
  async e64() {
    let revoked = false;
    const calls = { list: 0, command: 0 };
    const api = {
      list: async (_s, kind) => { calls.list++; return revoked ? { status: 404, body: null, retryAfter: null } : page(kind, kind === "meeting" ? [meeting] : []); },
      command: async () => { calls.command++; return { status: 403, body: null, retryAfter: null }; },
    };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(CoOwnershipPanel, { siteId: SITE, api, context, tab: "meeting" })));
    await until(() => btn(div, "Modifier"));
    btn(div, "Modifier").click();
    await until(() => div.querySelector('[data-co-form="meeting"]'));
    setInput(field(div, "Lieu"), "Nouvelle salle");
    revoked = true;
    const before = calls.list;
    div.querySelector("[data-co-save]").click();
    await tick(250);
    const save = div.querySelector("[data-co-save]");
    if (save && !save.disabled) { save.click(); await tick(250); }
    return { relisted: calls.list - before, commands: calls.command, rows: div.querySelectorAll("[data-co-id]").length, form: !!div.querySelector("[data-co-form]"), location: /Nouvelle salle|Salle commune/.test(txt(div) + [...div.querySelectorAll("input")].map((i) => i.value).join(" ")) };
  },
};
`;

test("E64 · 403 à l’enregistrement ⇒ relecture, assemblée et saisie purgées, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e64");
    assert.ok(r.relisted >= 1, `relecture après le refus (GET : ${r.relisted})`);
    assert.equal(r.rows, 0, "assemblée retirée");
    assert.equal(r.form, false, "formulaire retiré");
    assert.equal(r.location, false, "lieu saisi et ancien lieu purgés");
    assert.equal(r.commands, 1, "aucun second POST refusé");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
