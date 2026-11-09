// E44 / E45 (registre phase 2) — FIN-05 : pagination des factures.
// E44 : après la perte du droit au site, « Afficher plus » reçoit 404 ⇒ la liste protégée (pièces,
//       montants, liens PDF) est purgée et le refus est affiché.
// E45 : un 503 sur la page suivante ⇒ explication visible et reprise explicite ; la reprise réussie
//       retire l’alerte et ajoute la page.
// Panneau réel monté (StrictMode, Chromium), API simulée, aucune requête réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CustomerInvoicesPanel } from "./components/features/customer-invoices/customer-invoices-panel";
import { invoiceLinks, normalizeFilters } from "./components/features/customer-invoices/invoices-model";
${PRELUDE}
const ID = (n) => "90000000-0000-4000-8000-" + String(n).padStart(12, "0");
const SHA = "a".repeat(64);
const FILTERS = { basis: "service", site_id: "50000000-0000-4000-8000-000000000001" };
const summary = (n) => ({ id: ID(n), kind: "invoice", basis: "service", number: "F-2026-" + n, issuer_name: "Atelier Test", recipient_name: "Client Test", intervention_id: "20000000-0000-4000-8000-000000000001", quote_id: "30000000-0000-4000-8000-000000000001", related_invoice_id: null, total_cents: 24000, tax_cents: 4000, currency: "eur", issued_at: "2026-11-05T10:00:00.000Z", document_state: "issued", version: { basis: "immutable_register_snapshot", sha256: SHA }, links: invoiceLinks(ID(n)) });
const page = (rows, p) => ({ invoices: rows, page: { limit: 25, ...p }, filters: normalizeFilters(FILTERS), captured_at: "2026-11-07T10:00:00.000Z" });
const first = () => ({ status: 200, retryAfter: null, body: page(Array.from({ length: 25 }, (_, i) => summary(i + 1)), { total: 26, remaining: 26, has_more: true, next_cursor: "cur-1", complete: false }) });
const second = () => ({ status: 200, retryAfter: null, body: page([summary(26)], { total: 26, remaining: 1, has_more: false, next_cursor: null, complete: false }) });
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
async function mount(more) {
  const calls = [];
  const api = { list: async (_f, _l, cursor) => { calls.push(cursor); return cursor ? more.shift() : first(); }, detail: async () => ({ status: 404, body: null, retryAfter: null }) };
  const div = mountPoint();
  createRoot(div).render(h(StrictMode, null, h(CustomerInvoicesPanel, { filters: FILTERS, api, context })));
  await until(() => div.querySelector("[data-invoices-more]"));
  return { div, calls };
}
window.scenarios = {
  async e44() {
    const { div } = await mount([{ status: 404, body: null, retryAfter: null }]);
    div.querySelector("[data-invoices-more]").click();
    await tick(200);
    return { rows: div.querySelectorAll("[data-invoice-id]").length, pdf: div.querySelectorAll("[data-invoice-pdf]").length, alert: txt(div.querySelector('[role="alert"]')), amounts: /240,00/.test(txt(div)) };
  },
  async e45() {
    const { div } = await mount([{ status: 503, body: null, retryAfter: null }, second()]);
    div.querySelector("[data-invoices-more]").click();
    await tick(200);
    const afterFailure = { alert: txt(div.querySelector('[role="alert"]')), rows: div.querySelectorAll("[data-invoice-id]").length };
    div.querySelector("[data-invoices-more]").click();
    await tick(200);
    return { afterFailure, afterRetry: { alert: txt(div.querySelector('[role="alert"]')), rows: div.querySelectorAll("[data-invoice-id]").length } };
  },
};
`;

test("E44 · 404 sur « Afficher plus » ⇒ liste, montants et PDF purgés, refus affiché", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e44");
    assert.equal(r.rows, 0, `aucune pièce conservée (lignes : ${r.rows})`);
    assert.equal(r.pdf, 0, "aucun lien PDF conservé");
    assert.equal(r.amounts, false, "aucun montant conservé");
    assert.match(r.alert, /introuvable|accès|Reconnectez/i, "refus affiché");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});

test("E45 · 503 sur la page suivante ⇒ explication visible, reprise ⇒ alerte retirée et 26 pièces", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e45");
    assert.ok(r.afterFailure.alert.length > 0, "une explication est visible après le 503");
    assert.equal(r.afterFailure.rows, 25, "les pièces déjà autorisées restent (échec transitoire)");
    assert.equal(r.afterRetry.rows, 26);
    assert.equal(r.afterRetry.alert, "", "l’alerte disparaît après la reprise réussie");
    assert.deepEqual(errors, []);
  });
});
