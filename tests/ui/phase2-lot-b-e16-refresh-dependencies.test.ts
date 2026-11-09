// E16 (registre phase 2) — CLI-04 : après « Actualiser les données », la fiche client relit le
// créneau (route opérations) et le rappel du créneau ; le nouvel horaire remplace l’ancien.
// Vrai ClientSpace (fiche dossier) monté en Chromium ; session et lecture du rappel simulées.
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

const SETUP = `
const J = "d0000000-0000-4000-8000-000000000001";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "detail"; window.param = J;
const job = { id: J, client_id: window.uid, artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Tableau électrique", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", travel_stage: "planned" };
window.slot = { intervention_id: J, starts_at: "2026-12-01T13:00:00.000Z", ends_at: "2026-12-01T15:00:00.000Z", note: "", updated_at: "2026-11-08T10:00:00.000Z", reminder_version: 1 };
window.opsReads = 0;
const lim = { limited: false, limit: 100 };
window.seed = { data: { interventions: [job], quotes: [], payments: [], limits: { interventions: lim, quotes: { limited: false, limit: 200 }, sites: lim, organizations: { limited: false, limit: 50 } } }, session: {
  uploads: [], capabilities: new Proxy({}, { get: (_t, k) => (k === "operations" ? "available" : "missing") }),
  get refreshedAt() { return window.refreshedAt || 1; },
  refresh: async () => { window.refreshedAt = (window.refreshedAt || 1) + 1; window.rerender(); },
  loadOperations: async () => { window.opsReads++; return { participants: [], appointment: { ...window.slot }, report: null, history: [], history_limit: 50, travel_stage: "planned" }; },
} };
`;

test("E16 · « Actualiser » relit le créneau et le rappel ; le nouvel horaire s’affiche", { skip }, async () => {
  const { server, url } = await serveLiveClient(SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: "UTC" })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.getByText("Rendez-vous").first().waitFor();
    await page.waitForTimeout(400);
    const reminderGets = async () => ((await page.evaluate("window.fetches.filter((u) => u.includes('/reminder')).length")) as number);
    const before = { ops: (await page.evaluate("window.opsReads")) as number, reminder: await reminderGets() };
    await page.evaluate(`window.slot = { ...window.slot, starts_at: "2026-12-01T09:00:00.000Z", ends_at: "2026-12-01T11:00:00.000Z", updated_at: "2026-11-08T11:00:00.000Z", reminder_version: 2 }`);
    await page.getByTitle("Actualiser les données").click();
    await page.waitForTimeout(500);
    const after = { ops: (await page.evaluate("window.opsReads")) as number, reminder: await reminderGets() };
    const text = (await page.evaluate("document.getElementById('app').innerText")) as string;
    assert.ok(after.ops > before.ops, `créneau relu (${before.ops} → ${after.ops})`);
    assert.ok(after.reminder > before.reminder, `rappel relu (${before.reminder} → ${after.reminder})`);
    assert.match(text, /09:00/, "nouvel horaire affiché");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
