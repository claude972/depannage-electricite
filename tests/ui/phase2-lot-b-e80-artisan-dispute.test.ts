// E80 (registre phase 2) — ART-11.2 : litige absent du suivi artisan.
// Contrat annoncé par A (Codex, SHA backend à venir) : GET /api/payments/status?quote_id=… ajoute
// `artisan_dispute` optionnel = none | open | under_review | resolved | closed, seulement pour
// l’artisan affecté auteur du devis accepté ; indépendant de payment.status ; aucun détail finance.
// Vrai ArtisanSpace monté (live, Chromium 390) ; session.loadPaymentStatus simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveArtisan } from "./artisan-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const SETUP = (dispute: string | null) => `
const J = "d0000000-0000-4000-8000-000000000001", Q = "e1000000-0000-4000-8000-000000000001";
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "mission"; window.param = J;
const job = { id: J, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: window.uid, site_id: null, category: "panel", description: "Tableau 1", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "paid", estimate_min_cents: 5000, estimate_max_cents: 9000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" };
const quote = { id: Q, intervention_id: J, artisan_id: window.uid, status: "accepted", total_cents: 6510, subtotal_cents: 5425, tax_cents: 1085, tax_rate: 20, created_at: "2026-11-02T10:00:00Z", accepted_at: "2026-11-02T12:00:00Z", lines: [] };
const payment = { id: "40000000-0000-4000-8000-000000000001", method: "stripe", quote_id: Q, total_cents: 6510, currency: "eur", status: "paid", paid_at: "2026-11-03T10:00:00Z", created_at: "2026-11-03T09:00:00Z" };
window.statusCalls = [];
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], quotes: [quote], payments: [payment], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" || k === "payments" ? "available" : "missing") }),
  uploads: [], refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadOperations: async () => ({ participants: [], appointment: null, report: null, history: [], history_limit: 50, travel_stage: "on_site" }),
  loadPaymentStatus: async (id) => { window.statusCalls.push(id); return { payment, attempts: [payment], attempts_limit: 50, history_limited: false${dispute === null ? "" : `, artisan_dispute: ${JSON.stringify(dispute)}`} }; },
} };
`;

async function render(dispute: string | null) {
  const { server, url } = await serveLiveArtisan(SETUP(dispute));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    try { await page.locator("#dossier-payment").waitFor({ timeout: 8000 }); } catch (e) { console.log("BODY:", JSON.stringify(((await page.evaluate("document.body.innerText")) as string).slice(0, 800)), errors); throw e; }
    await page.waitForTimeout(300);
    const text = (await page.locator("section[aria-labelledby='dossier-payment']").innerText()).replace(/\s+/g, " ");
    return { text, calls: (await page.evaluate("window.statusCalls")) as string[], errors };
  } finally {
    await browser.close();
    server.close();
  }
}

test("E80 · litige en revue ⇒ affiché dans le règlement artisan, sans changer « Réglé »", { skip }, async () => {
  const r = await render("under_review");
  assert.ok(r.calls.length >= 1 && r.calls.every((c) => c === "e1000000-0000-4000-8000-000000000001"), `lecture du statut du devis accepté uniquement (${JSON.stringify(r.calls)})`);
  assert.match(r.text, /Litige en cours d’examen/, `état du litige affiché (texte : ${r.text})`);
  assert.match(r.text, /Réglé/, "statut du paiement inchangé");
  assert.doesNotMatch(r.text, /dp_|du_|motif|frais/i, "aucun détail finance");
  assert.deepEqual(r.errors, []);
});

test("E80 · sans litige ou champ absent (backend antérieur) ⇒ aucune mention", { skip }, async () => {
  for (const d of ["none", null]) {
    const r = await render(d);
    assert.doesNotMatch(r.text, /Litige/, String(d));
    assert.deepEqual(r.errors, []);
  }
});
