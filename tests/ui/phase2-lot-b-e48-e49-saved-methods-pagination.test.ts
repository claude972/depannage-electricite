// E48 / E49 (registre phase 2) — FIN-08 : pagination des cartes enregistrées.
// E48 : 403 sur la page suivante (confirmation e-mail retirée) ⇒ cartes masquées et boutons de
//       retrait purgés immédiatement, sans attendre un second refus.
// E49 : 503 sur la page suivante puis reprise 200 ⇒ la 21e carte apparaît et l’alerte disparaît.
// Panneau réel monté (StrictMode, Chromium), API simulée, aucune requête réseau ni fournisseur.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SavedPaymentMethodsPanel } from "./components/features/saved-payment-methods/saved-payment-methods-panel";
${PRELUDE}
const card = (n) => ({ id: "pm_test" + n, brand: "visa", last4: String(1000 + n).slice(-4), exp_month: 12, exp_year: 2030 });
const firstPage = { status: 200, body: { methods: Array.from({ length: 20 }, (_, i) => card(i + 1)), has_more: true } };
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } }; };
async function mount(more) {
  const calls = { list: 0, post: 0 };
  const api = { list: async (after) => { calls.list++; return after ? more.shift() : firstPage; }, post: async () => { calls.post++; return { status: 403, body: null }; } };
  const div = mountPoint();
  const s = mem();
  createRoot(div).render(h(StrictMode, null, h(SavedPaymentMethodsPanel, { context, api, store: () => s, newId: () => crypto.randomUUID(), search: "" })));
  await until(() => div.querySelector("[data-saved-methods-more]"));
  return { div, calls };
}
window.scenarios = {
  async e48() {
    const { div, calls } = await mount([{ status: 403, body: null }]);
    div.querySelector("[data-saved-methods-more]").click();
    await tick(200);
    return { rows: div.querySelectorAll("[data-saved-method]").length, removeButtons: div.querySelectorAll("[data-saved-method-remove]").length, forbidden: !!div.querySelector("[data-saved-methods-forbidden]"), posts: calls.post };
  },
  async e49() {
    const { div } = await mount([{ status: 503, body: null }, { status: 200, body: { methods: [card(21)], has_more: false } }]);
    div.querySelector("[data-saved-methods-more]").click();
    await tick(200);
    const failed = { alert: !!div.querySelector("[data-saved-methods-error]"), rows: div.querySelectorAll("[data-saved-method]").length };
    div.querySelector("[data-saved-methods-more]").click();
    await tick(200);
    return { failed, rows: div.querySelectorAll("[data-saved-method]").length, alert: !!div.querySelector("[data-saved-methods-error]") };
  },
};
`;

test("E48 · 403 sur la page suivante ⇒ cartes et retraits purgés, refus affiché, zéro POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e48");
    assert.equal(r.rows, 0, `aucune carte conservée (lignes : ${r.rows})`);
    assert.equal(r.removeButtons, 0, "aucun bouton de retrait actif");
    assert.equal(r.forbidden, true, "refus affiché");
    assert.equal(r.posts, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});

test("E49 · 503 puis reprise réussie ⇒ 21 cartes et alerte retirée", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e49");
    assert.equal(r.failed.alert, true, "échec signalé");
    assert.equal(r.failed.rows, 20);
    assert.equal(r.rows, 21);
    assert.equal(r.alert, false, "l’alerte d’échec disparaît après la reprise réussie");
    assert.deepEqual(errors, []);
  });
});
