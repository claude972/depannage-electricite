// Energy consolidation panel mounted for real (React root, local Chromium), StrictMode: the exact
// GET is sent once per submit; a reply that arrives after an identity change is never applied; the
// form and the result fit 360 px with 44 px targets. Skipped — never passed — without Chromium.
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
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ORG = "10000000-0000-4000-8000-000000000001", S1 = "20000000-0000-4000-8000-000000000001";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnergyConsolidationPanel } from "./components/features/energy-consolidation/energy-consolidation-panel";
window.urls = []; window.gen = 1; window.resolvers = [];
const fetcher = (url) => { window.urls.push(String(url)); return new Promise((r) => window.resolvers.push(r)); };
const ctx = { generation: () => window.gen, userId: () => "manager-1" };
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(EnergyConsolidationPanel, { organizationId: "${ORG}", sites: [{ id: "${S1}", name: "Résidence QA" }], demo: false, context: ctx, fetcher })));
`;
const period = { record_count: 1, crossing_count: 0, missing_cost_count: 0, consumption_wh: "1500", cost_cents: "300", coverage_complete: true };
const total = { recorded_consumption_wh: "1500", recorded_cost_cents: "300", recorded_coverage_complete: true, cost_complete: true, actual_site_consumption_wh: null, physical_scope_complete: false };
const REPORT = { basis: "declared_meter_periods_fully_inside_range", scope: { organization_id: ORG, site_ids: [S1], from: "2026-01-01", to: "2026-01-31", previous_from: null, previous_to: null }, meters: [{ site_id: S1, meter_label: "compteur général", current: period, previous: null }], sites: [{ site_id: S1, known_meters: 1, current: total, previous: null }], current: total, previous: null, comparison: { comparable: false, reason: "not_requested", consumption_delta_wh: null, cost_delta_cents: null }, limits: { sites: 50, known_meters: 500, days_per_range: 366 }, physical_scope_complete: false };

test("Chromium : GET exact, réponse après changement d’identité ignorée, 360 px", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.locator(`[data-energy-site="${S1}"]`).check();
    await page.getByLabel("Du", { exact: true }).fill("2026-01-01");
    await page.getByLabel("Au", { exact: true }).fill("2026-01-31");
    await page.getByRole("button", { name: "Consolider les relevés déclarés" }).click();
    await page.waitForTimeout(200);
    const urls = await page.evaluate(() => (window as unknown as { urls: string[] }).urls);
    assert.deepEqual(urls, [`/api/organizations/${ORG}/energy?site_ids=${S1}&from=2026-01-01&to=2026-01-31`], "one exact GET (StrictMode safe)");
    // Identity changes before the reply lands: nothing is applied.
    await page.evaluate((rep: unknown) => { const w = window as unknown as { gen: number; resolvers: ((r: Response) => void)[] }; w.gen = 2; w.resolvers[0](new Response(JSON.stringify(rep), { status: 200 })); }, REPORT);
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-energy-report]").count(), 0, "stale reply ignored");
    // Same identity: the reply applies.
    await page.getByRole("button", { name: "Consolider les relevés déclarés" }).click();
    await page.waitForTimeout(200);
    await page.evaluate((rep: unknown) => { const w = window as unknown as { resolvers: ((r: Response) => void)[] }; w.resolvers[1](new Response(JSON.stringify(rep), { status: 200 })); }, REPORT);
    await page.locator("[data-energy-report]").waitFor();
    assert.match(await page.locator("[data-energy-total]").innerText(), /1,5 kWh/);
    const layout = await page.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, input[type=date], label")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; }).map((e) => e.textContent.trim().slice(0, 30)) }))()`) as { sw: number; small: string[] };
    assert.equal(layout.sw, 360);
    assert.deepEqual(layout.small, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
