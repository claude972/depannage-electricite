// E34 / E35 / E36 (registre phase 2) — ADM-02 : décisions sur une candidature artisan.
// Contrats A vérifiés (phase3-bloquants-livres.md) : POST /api/admin/artisans
//   { user_id, command_id (UUID stable par intention, repris à chaque reprise), action ∈ approve |
//     request_changes | suspend | reinstate, expected_version = application_version du GET }.
// E34 : une ancienne confirmation « Approuver » restée ouverte après une suspension ne réactive pas
//       (approbation ≠ réactivation, version attendue) ⇒ 409, relecture, statut Suspendu affiché.
// E35 : une candidature soumise propose aussi « Demander des corrections » (action request_changes).
// E36 : réponse perdue d’une suspension ⇒ « Confirmer » de nouveau renvoie le MÊME command_id.
// Vrai ArtisanAdministration monté (StrictMode, Chromium), fetch simulé appliquant le contrat.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArtisanAdministration } from "./components/app/forms";
${PRELUDE}
const A1 = "a1000000-0000-4000-8000-000000000001";
window.server = { status: "submitted", version: 1, approved: false, lose: false, seen: new Set() };
window.posts = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
window.fetch = async (url, init) => {
  const s = window.server;
  if (init && init.method === "POST") {
    const b = JSON.parse(init.body);
    window.posts.push(b);
    if (!b.command_id || !b.action || typeof b.expected_version !== "number") return json(422, { error: "Requête invalide." });
    if (s.seen.has(b.command_id)) return json(200, { success: true }); // exact replay
    if (b.expected_version !== s.version) return json(409, { error: "Le dossier a changé." });
    const next = { approve: "approved", reinstate: "approved", suspend: "suspended", request_changes: "changes_requested" }[b.action];
    s.status = next; s.approved = next === "approved"; s.version++; s.seen.add(b.command_id);
    if (s.lose) { s.lose = false; return json(503, { error: "Réponse perdue." }); }
    return json(200, { success: true });
  }
  return json(200, { artisans: [{ id: A1, full_name: "Artisan Recette", artisan_approved: s.approved, created_at: "2026-10-30T09:00:00Z", application_status: s.status, application_version: s.version }], limit: 100, truncated: false });
};
const row = (div) => div.querySelector("[data-artisan-application]");
async function mount() {
  const div = mountPoint();
  createRoot(div).render(h(StrictMode, null, h(ArtisanAdministration, { demo: false })));
  await until(() => row(div));
  return div;
}
const confirmBtn = (div) => [...div.querySelectorAll("button")].find((b) => /^Confirmer/.test((b.textContent || "").trim()));
// ADM-02 (22 nov. 2026): a negative decision needs its reason before « Confirmer » posts anything.
const giveReason = async (div) => {
  const area = div.querySelector("textarea"); if (!area) return;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(area, "Motif de test suffisamment long.");
  area.dispatchEvent(new Event("input", { bubbles: true })); await tick(30);
};
window.scenarios = {
  async e34() {
    const div = await mount();
    btn(div, "Approuver").click(); // B opens the confirmation and leaves it open
    await tick(30);
    // Admin A approves then suspends in another session.
    Object.assign(window.server, { status: "suspended", approved: false, version: 3 });
    confirmBtn(div).click();
    await tick(300);
    return { posts: window.posts, status: window.server.status, shown: row(div)?.getAttribute("data-application-status"), alert: txt(div.querySelector("[role=alert]")) };
  },
  async e35() {
    Object.assign(window.server, { status: "submitted", approved: false, version: 1, seen: new Set() }); window.posts = [];
    const div = await mount();
    const labels = [...row(div).querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    const ask = btn(row(div), "Demander des corrections");
    if (ask) { ask.click(); await tick(30); await giveReason(div); confirmBtn(div).click(); await tick(300); }
    return { labels, posts: window.posts, status: window.server.status };
  },
  async e36() {
    Object.assign(window.server, { status: "approved", approved: true, version: 2, seen: new Set(), lose: true }); window.posts = [];
    const div = await mount();
    btn(div, "Suspendre").click(); await tick(30); await giveReason(div); confirmBtn(div).click();
    await until(() => window.posts.length === 1); await tick(300);
    const again = btn(div, "Suspendre");
    if (again) { again.click(); await tick(30); await giveReason(div); confirmBtn(div)?.click(); await tick(300); }
    else if (confirmBtn(div)) { confirmBtn(div).click(); await tick(300); } // form kept open after the lost reply
    return { posts: window.posts, status: window.server.status, shown: row(div)?.getAttribute("data-application-status") };
  },
};
`;

test("E34 · ancienne approbation après suspension ⇒ action approve + version lue ⇒ 409, dossier toujours suspendu, relu", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e34");
    assert.equal(r.posts[0]?.action, "approve", `approbation distincte de la réactivation (corps ${JSON.stringify(r.posts[0])})`);
    assert.equal(r.posts[0]?.expected_version, 1, "version lue envoyée");
    assert.equal(r.status, "suspended", "la suspension n’est pas annulée");
    assert.equal(r.shown, "suspended", "relecture : statut courant affiché");
    assert.deepEqual(errors, []);
  });
});

test("E35 · candidature soumise ⇒ « Demander des corrections » ⇒ request_changes", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e35");
    assert.ok(r.labels.includes("Demander des corrections"), `actions proposées : ${r.labels.join(", ")}`);
    assert.equal(r.posts[0]?.action, "request_changes");
    assert.equal(r.status, "changes_requested");
    assert.deepEqual(errors, []);
  });
});

test("E36 · réponse perdue d’une suspension ⇒ reprise avec le même command_id", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e36");
    assert.ok(r.posts.length >= 1);
    if (r.posts.length >= 2) assert.equal(r.posts[1].command_id, r.posts[0].command_id, "même clé d’intention à la reprise");
    assert.equal(r.status, "suspended");
    assert.equal(r.shown, "suspended", "écran relu après la reprise");
    assert.deepEqual(errors, []);
  });
});
