// E41 (registre phase 2) — CLI-06 / ART-06 / SYS-04 : reprise d’un envoi de texte après perte de la
// réponse. Contrat A vérifié (phase3-bloquants-livres.md) : POST /api/messages
// { intervention_id, body, command_id } ; UUID généré une fois par intention et repris à chaque
// tentative ; rejeu exact ⇒ même message (id = command_id).
// Vrai ClientSpace (vue Messages, MessageCenter réel) monté en Chromium, session simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveClient } from "./client-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETUP = `
const J = "d0000000-0000-4000-8000-000000000001";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "messages"; window.param = J;
const job = { id: J, client_id: window.uid, artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Tableau électrique", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "planned" };
window.sends = []; window.replies = [false, true, true];
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], messages: [], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  mode: "live", uploads: [], capabilities: new Proxy({}, { get: () => "missing" }),
  loadOperations: async () => null,
  sendMessage: async (...args) => { window.sends.push(args); return window.replies.shift(); },
} };
`;

test("E41 · réponse perdue ⇒ renvoi du même texte avec la même clé ; message suivant ⇒ nouvelle clé", { skip }, async () => {
  const { server, url } = await serveLiveClient(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    const box = page.locator("#message-body");
    await box.waitFor();
    await box.fill("Bonjour, le disjoncteur saute encore ce matin.");
    await page.locator(".message-compose button[type=submit]").click();
    await page.waitForFunction("window.sends.length === 1");
    assert.equal(await box.inputValue(), "Bonjour, le disjoncteur saute encore ce matin.", "saisie conservée après l’échec");
    await page.locator(".message-compose button[type=submit]").click();
    await page.waitForFunction("window.sends.length === 2");
    await page.waitForFunction("document.querySelector('#message-body').value === ''");
    await box.fill("Merci, à demain.");
    await page.locator(".message-compose button[type=submit]").click();
    await page.waitForFunction("window.sends.length === 3");
    const sends = (await page.evaluate("window.sends")) as unknown[][];
    assert.match(String(sends[0][2]), UUID, `clé d’intention transmise (reçu ${JSON.stringify(sends[0][2])})`);
    assert.equal(sends[1][2], sends[0][2], "même clé au renvoi");
    assert.equal(sends[1][1], sends[0][1], "même texte");
    assert.notEqual(sends[2][2], sends[0][2], "nouveau message ⇒ nouvelle clé");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
