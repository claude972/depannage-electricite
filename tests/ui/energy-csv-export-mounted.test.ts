// Energy CSV export mounted for real (React root, StrictMode, local Chromium): the CSV GET carries
// exactly the displayed filters + format=csv; one export at a time; a real browser download with
// the server filename (object URL revoked); identity change ⇒ nothing downloaded; wrong content type
// ⇒ error, nothing downloaded; 503 + Retry-After ⇒ « Réessayer » waits, then the same query; demo ⇒
// zero calls; 360 px light/dark, 44 px targets. Skipped — never passed — without Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ORG = "10000000-0000-4000-8000-000000000001";
const S1 = "20000000-0000-4000-8000-000000000001", S2 = "20000000-0000-4000-8000-000000000002";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnergyConsolidationPanel } from "./components/features/energy-consolidation/energy-consolidation-panel";
window.calls = []; window.gen = 1; window.resolvers = []; window.created = 0; window.revoked = [];
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (b) => { window.created++; return create(b); };
URL.revokeObjectURL = (u) => { window.revoked.push(u); return revoke(u); };
const fetcher = (url, init) => { window.calls.push({ url: String(url), credentials: init && init.credentials, cache: init && init.cache, method: init && init.method }); return new Promise((r) => window.resolvers.push(r)); };
window.answer = (i, body, status, headers) => window.resolvers[i](new Response(body, { status, headers }));
const ctx = { generation: () => window.gen, userId: () => "manager-1" };
const demo = location.hash === "#demo";
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(EnergyConsolidationPanel, { organizationId: "${ORG}", sites: [{ id: "${S1}", name: "Résidence QA" }, { id: "${S2}", name: "Restaurant QA" }], demo, context: ctx, fetcher })));
`;
const period = { record_count: 1, crossing_count: 0, missing_cost_count: 0, consumption_wh: "1500", cost_cents: "300", coverage_complete: true };
const total = { recorded_consumption_wh: "1500", recorded_cost_cents: "300", recorded_coverage_complete: true, cost_complete: true, actual_site_consumption_wh: null, physical_scope_complete: false };
const SCOPE = { organization_id: ORG, site_ids: [S2, S1], from: "2026-02-01", to: "2026-02-28", previous_from: "2026-01-01", previous_to: "2026-01-31" };
const REPORT = {
  basis: "declared_meter_periods_fully_inside_range", scope: SCOPE,
  meters: [{ site_id: S1, meter_label: "compteur général", current: period, previous: period }, { site_id: S2, meter_label: "cuisine", current: period, previous: period }],
  sites: [{ site_id: S1, known_meters: 1, current: total, previous: total }, { site_id: S2, known_meters: 1, current: total, previous: total }],
  current: total, previous: total,
  comparison: { comparable: false, reason: "different_duration", consumption_delta_wh: null, cost_delta_cents: null },
  limits: { sites: 50, known_meters: 500, days_per_range: 366 }, physical_scope_complete: false,
};
const JSON_URL = `/api/organizations/${ORG}/energy?site_ids=${S2}%2C${S1}&from=2026-02-01&to=2026-02-28&previous_from=2026-01-01&previous_to=2026-01-31`;
const CSV_URL = `${JSON_URL}&format=csv`;
const CSV_HEADERS = { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rapport-energie.csv"', "Cache-Control": "private, no-store" };

type W = { calls: { url: string; credentials: string; cache: string; method: string }[]; gen: number; created: number; revoked: string[]; answer: (i: number, body: string, status: number, headers: Record<string, string>) => void };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function consolidated(browser: any, base: string, width = 1280, theme = "light") {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })).newPage();
  const errors: string[] = [];
  const downloads: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  page.on("download", (d: { suggestedFilename(): string }) => downloads.push(d.suggestedFilename()));
  await page.goto(`${base}?${theme}`);
  const exportButton = page.getByRole("button", { name: "Exporter en CSV" });
  assert.equal(await exportButton.isDisabled(), true, "no export before a valid consolidation is shown");
  await page.locator(`[data-energy-site="${S2}"]`).check();
  await page.locator(`[data-energy-site="${S1}"]`).check();
  await page.getByLabel("Du", { exact: true }).fill("2026-02-01");
  await page.getByLabel("Au", { exact: true }).fill("2026-02-28");
  await page.getByLabel("Comparer à une autre période").check();
  await page.getByLabel("Comparaison du").fill("2026-01-01");
  await page.getByLabel("au", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "Consolider les relevés déclarés" }).click();
  await page.waitForTimeout(150);
  await page.evaluate((rep: unknown) => (window as unknown as W).answer(0, JSON.stringify(rep), 200, { "Content-Type": "application/json" }), REPORT);
  await page.locator("[data-energy-report]").waitFor();
  return { page, errors, downloads, exportButton };
}
const w = (page: { evaluate: (f: () => unknown) => Promise<unknown> }) => page.evaluate(() => { const x = window as unknown as W; return { calls: x.calls, created: x.created, revoked: x.revoked.length }; }) as Promise<{ calls: W["calls"]; created: number; revoked: number }>;

test("Chromium : export CSV = filtres affichés, single-flight, vrai téléchargement au nom du serveur, URL objet révoquée", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const { page, errors, downloads, exportButton } = await consolidated(browser, base);
    assert.equal(await exportButton.isDisabled(), false);
    // Two clicks in the same tick: one request only.
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Exporter en CSV")!; b.click(); b.click(); });
    await page.waitForTimeout(150);
    assert.equal(await page.getByRole("button", { name: "Export en cours…" }).isDisabled(), true);
    let s = await w(page);
    assert.deepEqual(s.calls.map((c) => c.url), [JSON_URL, CSV_URL], "exactly the displayed filters + format=csv, once");
    assert.deepEqual({ ...s.calls[1], url: undefined }, { url: undefined, credentials: "same-origin", cache: "no-store", method: "GET" });
    const dl = page.waitForEvent("download");
    await page.evaluate((h: Record<string, string>) => (window as unknown as W).answer(1, "﻿Niveau;Organisation\r\nsite;x", 200, h), CSV_HEADERS);
    const file = await dl;
    assert.equal(file.suggestedFilename(), "rapport-energie.csv");
    assert.match(await page.locator('[data-energy-export="done"] [role=status]').innerText(), /« rapport-energie\.csv » généré/);
    await page.waitForTimeout(100);
    s = await w(page);
    assert.equal(s.created, 1);
    assert.equal(s.revoked, 1, "object URL revoked after the download starts");
    assert.deepEqual(downloads, ["rapport-energie.csv"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : changement d’identité ⇒ rien n’est téléchargé ; mauvais type ⇒ erreur, aucun fichier ; 503 + Retry-After ⇒ attente puis même requête", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const { page, errors, downloads, exportButton } = await consolidated(browser, base);
    // 1. Identity changes before the file lands: dropped.
    await exportButton.click();
    await page.waitForTimeout(100);
    await page.evaluate((h: Record<string, string>) => { const x = window as unknown as W; x.gen = 2; x.answer(1, "a;b", 200, h); }, CSV_HEADERS);
    await page.waitForTimeout(300);
    let s = await w(page);
    assert.equal(s.created, 0, "no object URL");
    assert.deepEqual(downloads, [], "nothing downloaded after an identity change");
    assert.equal(await page.locator('[data-energy-export="idle"]').count(), 1);
    // 2. Same identity, off-contract content type: error, nothing saved.
    await page.evaluate(() => { (window as unknown as W).gen = 1; });
    await exportButton.click();
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as W).answer(2, JSON.stringify({ ok: true }), 200, { "Content-Type": "application/json" }));
    await page.locator("[data-energy-export-error]").waitFor();
    assert.match(await page.locator("[data-energy-export-error]").innerText(), /Réponse inattendue du serveur : aucun fichier/);
    s = await w(page);
    assert.equal(s.created, 0);
    assert.deepEqual(downloads, []);
    // 3. Réessayer → 503 Retry-After: 1 ⇒ explained, Réessayer waits, then the very same query.
    await page.getByRole("button", { name: "Réessayer" }).click();
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as W).answer(3, JSON.stringify({ error: "x" }), 503, { "Content-Type": "application/json", "Retry-After": "1" }));
    await page.waitForTimeout(100);
    assert.match(await page.locator("[data-energy-export-error]").innerText(), /réessayez dans 1 s/);
    assert.equal(await page.getByRole("button", { name: "Réessayer" }).isDisabled(), true);
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole("button", { name: "Réessayer" }).isDisabled(), false);
    await page.getByRole("button", { name: "Réessayer" }).click();
    await page.waitForTimeout(100);
    // 4. 422: limits explained.
    await page.evaluate(() => (window as unknown as W).answer(4, JSON.stringify({ error: "x" }), 422, { "Content-Type": "application/json" }));
    await page.waitForTimeout(100);
    assert.match(await page.locator("[data-energy-export-error]").innerText(), /1 à 50 sites, 366 jours au plus par période, 500 compteurs/);
    s = await w(page);
    assert.deepEqual(s.calls.slice(1).map((c) => c.url), [CSV_URL, CSV_URL, CSV_URL, CSV_URL], "every attempt = the displayed filters");
    assert.equal(s.created, 0);
    assert.deepEqual(downloads, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : démo ⇒ note honnête, aucun appel ; 360 px clair/sombre, cibles ≥ 44 px, sans débordement", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const demo = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
    await demo.goto(`${base}#demo`);
    await demo.waitForTimeout(200);
    assert.match(await demo.locator('[data-energy-export="demo"]').innerText(), /aucun export CSV n’est produit/);
    assert.equal(await demo.getByRole("button").count(), 0);
    assert.equal((await w(demo)).calls.length, 0, "demo: zero calls");
    for (const theme of ["light", "dark"]) {
      const { page, errors } = await consolidated(browser, base, 360, theme);
      const layout = await page.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim()) }))()`) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      assert.deepEqual(errors, [], theme);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
