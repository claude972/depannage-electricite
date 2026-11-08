// ART — report editor during submission: real ArtisanSpace in live (fake Session, StrictMode,
// Chromium 390). POST held ⇒ every field and control locked and a second submit sends nothing;
// failure ⇒ text kept exactly + unlocked; success ⇒ closes once; dossier switch while the reply is
// held ⇒ the late reply never closes nor touches the new dossier's editor.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveArtisan } from "./artisan-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const SETUP = `
const D = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.D = D;
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "mission"; window.param = D(1);
const i = (n) => ({ id: D(n), client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: window.uid, site_id: null, category: "panel", description: "Tableau " + n, address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "in_progress", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" });
window.ops = []; window.hold = false; window.gates = []; window.result = true;
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [i(1), i(2)], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  // Leaves outside this lot (tracking, documents…): inert clients answering « unavailable ».
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadOperations: async () => ({ participants: [], appointment: null, report: null, history: [], history_limit: 50, travel_stage: "on_site" }),
  operate: async (id, body) => { window.ops.push({ id, body }); if (window.hold) await new Promise((r) => window.gates.push(r)); return window.result; },
} };
`;

test("Chromium 390 : POST retenu ⇒ tout verrouillé, 2e envoi ⇒ aucun POST ; échec ⇒ saisie gardée + déverrouillée ; succès ⇒ fermeture unique ; changement de dossier ⇒ éditeur neuf intact", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    const open = async () => {
      await page.getByRole("button", { name: "Rédiger le compte rendu" }).click();
      await page.locator("[data-report-form]").waitFor();
    };
    const summary = () => page.getByLabel("Résumé des travaux réalisés");
    const signature = () => page.getByLabel("Nom déclaré");
    await open();
    await summary().fill("Remplacement du disjoncteur différentiel 30 mA.");
    await page.getByRole("button", { name: "Ajouter un point de contrôle" }).click();
    await page.getByLabel("Contrôle 3", { exact: true }).fill("Test du différentiel");
    await signature().fill("Jean Martin");
    // Hold the POST ⇒ every field and control disabled; a second submit ⇒ no POST.
    await page.evaluate("window.hold = true; window.result = false");
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 1");
    await page.locator('[data-report-form="saving"]').waitFor();
    const enabled = await page.evaluate("[...document.querySelectorAll('[data-report-form] input, [data-report-form] textarea, [data-report-form] select, [data-report-form] button')].filter((e) => !e.matches(':disabled')).length");
    assert.equal(enabled, 0, "every field and control locked");
    await page.evaluate("document.querySelector('[data-report-form]').requestSubmit()");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate("window.ops.length"), 1, "second submit ⇒ no POST");
    // Failure ⇒ A kept exactly, unlocked.
    await page.evaluate("window.gates.shift()()");
    await page.locator('[data-report-form="idle"]').waitFor();
    assert.equal(await summary().inputValue(), "Remplacement du disjoncteur différentiel 30 mA.");
    assert.equal(await page.getByLabel("Contrôle 3", { exact: true }).inputValue(), "Test du différentiel");
    assert.equal(await signature().inputValue(), "Jean Martin");
    assert.equal(await summary().isDisabled(), false, "unlocked for a retry");
    // Retry with the same input ⇒ success ⇒ closes once.
    await page.evaluate("window.result = true");
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 2");
    assert.deepEqual(((await page.evaluate("window.ops")) as Array<{ body: unknown }>)[1].body, ((await page.evaluate("window.ops")) as Array<{ body: unknown }>)[0].body, "same input resent");
    await page.evaluate("window.gates.shift()()");
    await page.locator("[data-report-form]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate("window.ops.length"), 2);
    // Dossier switch while the reply is held ⇒ the new dossier's editor is untouched.
    await open();
    await summary().fill("Compte rendu du dossier un en cours d’envoi.");
    await signature().fill("Jean Martin");
    await page.getByRole("button", { name: "Enregistrer le compte rendu" }).click();
    await page.waitForFunction("window.ops.length === 3");
    await page.evaluate("window.param = window.D(2); window.rerender()");
    await page.getByText("Tableau 2").first().waitFor();
    if ((await page.locator("[data-report-form]").count()) === 0) await open();
    await summary().fill("Brouillon du dossier deux.");
    await page.evaluate("window.gates.shift()()"); // late success of dossier 1
    await page.waitForTimeout(250);
    assert.equal(await page.locator("[data-report-form]").count(), 1, "new editor not closed");
    assert.equal(await summary().inputValue(), "Brouillon du dossier deux.", "new editor untouched");
    assert.equal(await summary().isDisabled(), false);
    assert.equal(((await page.evaluate("window.ops")) as Array<{ id: string }>)[2].id, "d0000000-0000-4000-8000-000000000001");
    assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
