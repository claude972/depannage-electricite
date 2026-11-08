// ENT-09/ENT-15 (Astra P2): an energy CSV export held by the network belongs to the panel instance
// and the organisation that started it. Mounted in Chromium (StrictMode, real panel, fake fetcher):
// export A held → switch to organisation B with the SAME uid/generation (key change remounts the
// panel, as in enterprise-space) → release A ⇒ no file A saved, no A error or busy on B; then a real
// export on B saves B's file; leaving « Rapports » (unmount) during an export saves nothing.
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
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnergyConsolidationPanel } from "./components/features/energy-consolidation/energy-consolidation-panel";
import { formToSelection, parseReport } from "./components/features/energy-consolidation/model";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const A = "10000000-0000-4000-8000-00000000000a", B = "10000000-0000-4000-8000-00000000000b";
const SITE = { [A]: "20000000-0000-4000-8000-00000000000a", [B]: "20000000-0000-4000-8000-00000000000b" };
const period = { record_count: 1, crossing_count: 0, missing_cost_count: 0, consumption_wh: "1500", cost_cents: "300", coverage_complete: true };
const total = { recorded_consumption_wh: "1500", recorded_cost_cents: "300", recorded_coverage_complete: true, cost_complete: true, actual_site_consumption_wh: null, physical_scope_complete: false };
const form = (org) => ({ site_ids: [SITE[org]], from: "2026-02-01", to: "2026-02-28", compare: false, previous_from: "", previous_to: "" });
const sel = (org) => { const out = formToSelection(org, form(org)); if (!("selection" in out)) throw new Error(out.error); return out.selection; };
const report = (org) => ({
  basis: "declared_meter_periods_fully_inside_range", scope: sel(org),
  meters: [{ site_id: SITE[org], meter_label: "compteur général", current: period, previous: null }],
  sites: [{ site_id: SITE[org], known_meters: 1, current: total, previous: null }],
  current: total, previous: null,
  comparison: { comparable: false, reason: "not_requested", consumption_delta_wh: null, cost_delta_cents: null },
  limits: { sites: 50, known_meters: 500, days_per_range: 366 }, physical_scope_complete: false,
});
// Saves are observed at the anchor click (no real download needed).
window.saved = [];
HTMLAnchorElement.prototype.click = function () { if (this.download) window.saved.push(this.download); };
const calls = [], resolvers = [];
const fetcher = (url) => { calls.push(String(url)); return new Promise((r) => resolvers.push(r)); };
const csv = (name) => new Response("site;kwh\\n", { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + name + '"', "Cache-Control": "private, no-store" } });
const ctx = { generation: () => 1, userId: () => "manager-1" }; // SAME uid / generation for A and B
const div = document.createElement("div"); document.body.appendChild(div);
const root = createRoot(div);
const mount = (org) => {
  const s = sel(org);
  const parsed = parseReport(report(org), s);
  if (!parsed) throw new Error("fixture report rejected by parseReport");
  root.render(h(StrictMode, null, h(EnergyConsolidationPanel, { key: org, organizationId: org, sites: [{ id: SITE[org], name: "Site " + org.slice(-1) }], demo: false, context: ctx, fetcher, initial: { form: form(org), report: parsed, selection: s } })));
};
const exportButton = () => [...div.querySelectorAll("button")].find((b) => b.textContent.trim() === "Exporter en CSV" || b.getAttribute("aria-busy") === "true");
const bar = () => ({ state: div.querySelector("[data-energy-export]")?.getAttribute("data-energy-export") ?? null, alerts: [...div.querySelectorAll("[role=alert]")].map((e) => e.textContent), busy: !!div.querySelector("[aria-busy=true]"), org: div.querySelector("[data-energy-site]")?.getAttribute("data-energy-site") ?? null });
window.scenario = async () => {
  mount(A);
  await tick(200);
  exportButton().click();
  await tick(150);
  const heldA = { calls: calls.length, url: calls[0], bar: bar() };
  mount(B); // organisation switch, same uid/generation: the key change unmounts A
  await tick(200);
  const onB = bar();
  resolvers[0](csv("rapport-A.csv"));
  await tick(300);
  const afterLateA = { saved: [...window.saved], bar: bar() };
  exportButton().click();
  await tick(150);
  const urlB = calls[1];
  resolvers[1](csv("rapport-B.csv"));
  await tick(300);
  const exportB = { saved: [...window.saved], bar: bar() };
  // Leaving « Rapports » during an export: the panel unmounts, the late file is not saved.
  exportButton().click();
  await tick(150);
  root.render(h("div", null, "Autre onglet"));
  await tick(100);
  resolvers[2](csv("rapport-B-2.csv"));
  await tick(300);
  return { heldA, onB, afterLateA, urlB, exportB, afterUnmount: { saved: [...window.saved], calls: calls.length, html: div.textContent } };
};
`;

test("ENT-09/15 export énergie : un export retenu de l’organisation A ne s’enregistre jamais après le passage à B (même uid/génération), ni après démontage", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    type Bar = { state: string | null; alerts: string[]; busy: boolean; org: string | null };
    const r = (await page.evaluate(() => (window as unknown as { scenario: () => Promise<unknown> }).scenario())) as { heldA: { calls: number; url: string; bar: Bar }; onB: Bar; afterLateA: { saved: string[]; bar: Bar }; urlB: string; exportB: { saved: string[]; bar: Bar }; afterUnmount: { saved: string[]; calls: number; html: string } };
    same([r.heldA.calls, r.heldA.bar.state, r.heldA.bar.busy], [1, "busy", true], "export A in flight");
    assert.match(r.heldA.url, /\/api\/organizations\/10000000-0000-4000-8000-00000000000a\/energy\?.*format=csv/);
    same([r.onB.org, r.onB.state, r.onB.busy, r.onB.alerts], ["20000000-0000-4000-8000-00000000000b", "idle", false, []], "organisation B: no busy inherited from A");
    same([r.afterLateA.saved, r.afterLateA.bar.state, r.afterLateA.bar.busy, r.afterLateA.bar.alerts], [[], "idle", false, []], "late A reply: no file A saved, no A error or busy on B");
    assert.match(r.urlB, /\/api\/organizations\/10000000-0000-4000-8000-00000000000b\/energy\?.*format=csv/);
    same([r.exportB.saved, r.exportB.bar.state], [["rapport-B.csv"], "done"], "a real export on B saves B's file");
    same([r.afterUnmount.saved, r.afterUnmount.calls, r.afterUnmount.html], [["rapport-B.csv"], 3, "Autre onglet"], "leaving « Rapports » during an export saves nothing");
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
