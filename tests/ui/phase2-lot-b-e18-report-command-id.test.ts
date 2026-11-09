// E18 (registre phase 2) — ART-09 : reprise après perte de la réponse d’enregistrement du compte rendu.
// Contrat A vérifié (phase3-bloquants-livres.md) : save_report exige command_id UUID par intention ;
// même clé et même saisie jusqu’au succès confirmé ; un nouveau rapport après réussite ⇒ nouvelle clé.
// Vrai ArtisanSpace monté (live, StrictMode, Chromium 390), session simulée.
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETUP = `
const D = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "mission"; window.param = D(1);
const job = { id: D(1), client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: window.uid, site_id: null, category: "panel", description: "Tableau 1", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "in_progress", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" };
window.ops = []; window.replies = [false, true, true];
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  uploads: [], refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadOperations: async () => ({ participants: [], appointment: null, report: null, history: [], history_limit: 50, travel_stage: "on_site" }),
  // First reply lost (the server wrote it), then confirmed.
  operate: async (id, body) => { window.ops.push(JSON.parse(JSON.stringify(body))); return window.replies.shift(); },
} };
`;

test("E18 · réponse perdue ⇒ renvoi inchangé avec le même command_id ; nouveau rapport ⇒ nouvelle clé", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    const open = async () => { await page.getByRole("button", { name: /compte rendu/ }).first().click(); await page.locator("[data-report-form]").waitFor(); };
    await open();
    await page.getByLabel("Résumé des travaux réalisés").fill("Remplacement du disjoncteur différentiel 30 mA.");
    await page.getByLabel("Nom déclaré").fill("Jean Martin");
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 1");
    await page.locator('[data-report-form="idle"]').waitFor();
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 2");
    await page.locator("[data-report-form]").waitFor({ state: "detached" });
    const ops = (await page.evaluate("window.ops")) as Array<Record<string, unknown>>;
    assert.match(String(ops[0].command_id), UUID, `clé d’intention envoyée (reçu ${JSON.stringify(ops[0].command_id)})`);
    assert.equal(ops[1].command_id, ops[0].command_id, "même clé au renvoi après réponse perdue");
    assert.deepEqual({ ...ops[1] }, { ...ops[0] }, "même saisie");
    // A new intentional report after the confirmed one ⇒ new key.
    await open();
    await page.getByLabel("Résumé des travaux réalisés").fill("Deuxième passage : contrôle des prises du séjour.");
    await page.getByLabel("Nom déclaré").fill("Jean Martin");
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 3");
    const all = (await page.evaluate("window.ops")) as Array<Record<string, unknown>>;
    assert.match(String(all[2].command_id), UUID);
    assert.notEqual(all[2].command_id, all[0].command_id, "nouvelle intention ⇒ nouvelle clé");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
