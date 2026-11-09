// Compte rendu historique (suite E60, sans contrat d’accusé) : le nom saisi par l’artisan est une
// déclaration de l’artisan, jamais présenté comme la signature du client. Un nom vide (route
// historique, E19) n’affiche pas « Signé par … » sans personne. Vraie fiche client montée (live,
// Chromium) ; libellés entreprise et administration contrôlés dans leurs sources.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serveLiveClient } from "./client-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM) ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const SETUP = (name: string) => `
const J = "d0000000-0000-4000-8000-000000000001";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "detail"; window.param = J;
const job = { id: J, client_id: window.uid, artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Tableau", address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "completed", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "on_site" };
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  uploads: [], capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  loadOperations: async () => ({ participants: [], appointment: null, report: { intervention_id: J, summary: "Remplacement du disjoncteur différentiel.", checks: [], signature_name: ${JSON.stringify(name)}, updated_at: "2026-11-05T10:00:00Z" }, history: [], history_limit: 50, travel_stage: "on_site" }),
} };
`;

async function text(name: string) {
  const { server, url } = await serveLiveClient(SETUP(name));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.getByText("Remplacement du disjoncteur différentiel.").first().waitFor();
    return { text: (await page.evaluate("document.getElementById('app').innerText")) as string, errors };
  } finally {
    await browser.close();
    server.close();
  }
}

test("fiche client : nom déclaré par l’artisan, jamais « Signé par » ; nom vide sans personne fictive", { skip }, async () => {
  const r = await text("Jean Martin");
  assert.doesNotMatch(r.text, /Signé par/, "pas de signature du client");
  assert.match(r.text, /Déclaré par l’artisan : Jean Martin/);
  assert.match(r.text, /ni une signature du client ni un accusé de réception/);
  const empty = await text("");
  assert.doesNotMatch(empty.text, /Signé par|Déclaré par l’artisan : \s*[—.]/);
  assert.match(empty.text, /Nom du déclarant non renseigné/);
  assert.deepEqual([...r.errors, ...empty.errors], []);
});

test("entreprise et administration : même libellé de déclaration", () => {
  for (const f of ["components/role/enterprise-space.tsx", "components/role/admin-space.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /Signé « \{/, f);
    assert.match(src, /reportDeclarant\(/, f);
  }
});
