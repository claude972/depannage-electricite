// E05 (registre phase 2) — ART-02.2 : effectif au-delà de la limite. Un dossier complet avec un effectif
// de 100001 : attendu — refus local, en français, près du champ ; bouton de soumission inactif ; aucun
// save_profile envoyé (le serveur refuse > 100 000).
// Vrai ArtisanSpace monté (live, Chromium 390), session simulée.
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

const SETUP = `
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "application"; window.param = "";
window.commands = [];
const profile = { user_id: window.uid, company_name: "Atelier Recette", siret: "12345678901234", legal_status: "SAS ou SASU", employee_count: 3, address: "3 rue des Ateliers, Fort-de-France", postal_codes: ["97200"], categories: ["panel"], available: false, application_status: "draft" };
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  capabilities: new Proxy({}, { get: () => "missing" }), uploads: [], refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadArtisanDossier: async () => ({ artisan_profile: profile, credentials: [] }),
  artisanCommand: async (body) => { window.commands.push(body); return false; },
} };
`;

test("E05 · effectif 100001 ⇒ refus local en français, aucune commande envoyée", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    const field = page.getByLabel("Effectif (vous compris)");
    await field.waitFor();
    await field.fill("100001");
    const buttons = page.locator("button").filter({ hasText: /Soumettre|Enregistrer/ });
    const n = await buttons.count();
    for (let k = 0; k < n; k++) if (await buttons.nth(k).isEnabled()) await buttons.nth(k).click();
    await page.waitForTimeout(300);
    const commands = (await page.evaluate("window.commands")) as Array<Record<string, unknown>>;
    const text = (await page.evaluate("document.getElementById('app').innerText")) as string;
    assert.equal(commands.filter((c) => c.action === "save_profile" || c.action === "submit_application").length, 0, `aucune commande (reçues : ${JSON.stringify(commands.map((c) => c.action))})`);
    assert.match(text, /ne peut pas dépasser 100 000|100 000 au plus/, "message français près du champ");
    assert.doesNotMatch(text, /Too big/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
