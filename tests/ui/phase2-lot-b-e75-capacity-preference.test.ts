// E75 (registre phase 2, reste DÉCISION) — ART-04.1 : préférence de capacité côté profil artisan,
// sans plafond imposé. Contrat A (e492a1b) : workspace.artisan_profile expose capacity_limit (null =
// illimité) et capacity_version ; POST /api/artisan { action:"set_capacity_limit", capacity_limit:
// entier positif | null, expected_version: capacity_version }. Attendu : réglage visible si le contrat
// est présent ; vide ⇒ null (illimité) ; refus (409) ⇒ relecture, saisie conservée, renvoi sur la
// version relue ; mention « préférence enregistrée, ne filtre pas les offres ».
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

const SETUP = (withContract: boolean) => `
window.uid = "a0000000-0000-4000-8000-000000000001";
window.view = "profile"; window.param = "";
window.commands = []; window.dossierReads = 0;
window.server = { capacity_limit: null, capacity_version: 0 };
const profile = () => ({ user_id: window.uid, company_name: "Atelier Recette", siret: "12345678901234", legal_status: "SAS ou SASU", employee_count: 3, address: "3 rue des Ateliers", postal_codes: ["97200"], categories: ["panel"], available: true, application_status: "approved"${withContract ? ", capacity_limit: window.server.capacity_limit, capacity_version: window.server.capacity_version" : ""} });
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [], quotes: [], payments: [], reviews: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  profile: { id: window.uid, role: "artisan", full_name: "Artisan Recette", phone: "", created_at: "2024-01-15T10:00:00Z", artisan_approved: true },
  capabilities: new Proxy({}, { get: () => "missing" }), uploads: [], refreshContext: "g1|artisan||", ensureFresh: async () => ({ kind: "loaded" }),
  features: new Proxy({}, { get: (_t, k) => (k === "demo" ? false : () => new Proxy({}, { get: (_x, m) => (m === "then" ? undefined : async () => ({ status: 503, body: null })) })) }),
  loadArtisanDossier: async () => { window.dossierReads++; return { artisan_profile: profile(), credentials: [] }; },
  artisanCommand: async (body) => {
    window.commands.push(JSON.parse(JSON.stringify(body)));
    if (body.action !== "set_capacity_limit") return false;
    if (body.expected_version !== window.server.capacity_version) return false; // 409
    window.server = { capacity_limit: body.capacity_limit, capacity_version: window.server.capacity_version + 1 };
    return true;
  },
} };
`;

async function open(withContract: boolean) {
  const { server, url } = await serveLiveArtisan(SETUP(withContract));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  await page.goto(url);
  await page.getByText("Profil artisan").first().waitFor();
  await page.waitForTimeout(300);
  return { server, browser, page, errors };
}

test("E75 · contrat présent ⇒ préférence neutre ; 409 ⇒ relecture et renvoi sur la version relue ; vide ⇒ illimité", { skip }, async () => {
  const { server, browser, page, errors } = await open(true);
  try {
    const field = page.getByLabel(/Nombre maximal de missions simultanées/);
    await field.waitFor({ timeout: 5000 });
    assert.match((await page.evaluate("document.getElementById('app').innerText")) as string, /ne filtre pas les offres/i);
    await page.evaluate("window.server = { capacity_limit: 4, capacity_version: 1 }"); // changed elsewhere
    await field.fill("2");
    const reads = (await page.evaluate("window.dossierReads")) as number;
    await page.getByRole("button", { name: /Enregistrer la préférence/ }).click();
    await page.waitForTimeout(400);
    assert.ok(((await page.evaluate("window.dossierReads")) as number) > reads, "refus ⇒ relecture");
    assert.equal(await field.inputValue(), "2", "saisie conservée");
    await page.getByRole("button", { name: /Enregistrer la préférence/ }).click();
    await page.waitForTimeout(400);
    await field.fill("");
    await page.getByRole("button", { name: /Enregistrer la préférence/ }).click();
    await page.waitForTimeout(400);
    const cmds = ((await page.evaluate("window.commands")) as Array<Record<string, unknown>>).filter((c) => c.action === "set_capacity_limit");
    assert.deepEqual(cmds.map((c) => [c.capacity_limit, c.expected_version]), [[2, 0], [2, 1], [null, 2]]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("E75 · contrat absent ⇒ aucun réglage affiché", { skip }, async () => {
  const { server, browser, page, errors } = await open(false);
  try {
    assert.equal(await page.getByLabel(/Nombre maximal de missions simultanées/).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
