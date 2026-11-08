// ENT-09/15: complete portfolio selection in the energy report, MOUNTED in Chromium (StrictMode,
// real panel + real createSlApi / createListController, fake fetcher routed by URL). A site beyond
// the bootstrap, on a next portfolio page, is selectable and the report and CSV use exactly it; the
// archived filter keeps the choices and their labels; 401/403/404 clear the selection with an
// honest message; an organisation switch shows no old data and saves no stale export.
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
const sid = (n) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
const AT = "2026-01-01T00:00:00.000Z";
const rec = (org, n, archived) => ({ id: sid(n), organization_id: org, name: n === 55 ? "Site cible 55" : archived ? "Ancien dépôt " + n : "Site " + n, address: "1 rue des Tests", access_notes: "", opening_hours: [], type: "office", budget_cents: 0, settings_version: 1, archived_at: archived ? AT : null, created_at: AT });
const ACTIVE = Array.from({ length: 60 }, (_, i) => i + 1);
const ARCHIVED = [901, 902];
const period = { record_count: 1, crossing_count: 0, missing_cost_count: 0, consumption_wh: "1500", cost_cents: "300", coverage_complete: true };
const total = { recorded_consumption_wh: "1500", recorded_cost_cents: "300", recorded_coverage_complete: true, cost_complete: true, actual_site_consumption_wh: null, physical_scope_complete: false };
const reportFor = (org, ids, from, to) => ({
  basis: "declared_meter_periods_fully_inside_range", scope: { organization_id: org, site_ids: ids, from, to, previous_from: null, previous_to: null },
  meters: ids.map((id) => ({ site_id: id, meter_label: "compteur " + id.slice(-3), current: period, previous: null })),
  sites: ids.map((id) => ({ site_id: id, known_meters: 1, current: total, previous: null })),
  current: total, previous: null,
  comparison: { comparable: false, reason: "not_requested", consumption_delta_wh: null, cost_delta_cents: null },
  limits: { sites: 50, known_meters: 500, days_per_range: 366 }, physical_scope_complete: false,
});
window.saved = [];
HTMLAnchorElement.prototype.click = function () { if (this.download) window.saved.push(this.download); };
const json = (status, body) => new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls = [], hold = {}, refuse = {}, waiting = {};
const route = (url) => {
  const u = new URL(url, "http://x");
  const org = u.pathname.split("/")[3];
  if (u.pathname.endsWith("/sites")) {
    const state = u.searchParams.get("state"), after = u.searchParams.get("after");
    const key = "sites:" + state + ":" + (after ?? "");
    if (refuse[key]) return { key, res: () => json(refuse[key], { error: "refus" }) };
    const all = (state === "archived" ? ARCHIVED : ACTIVE).map((n) => rec(org, n, state === "archived"));
    const start = after ? all.findIndex((s) => s.id === after) + 1 : 0;
    const page = all.slice(start, start + 50);
    return { key, res: () => json(200, { sites: page, next_after: start + 50 < all.length ? page[page.length - 1].id : null }) };
  }
  const ids = (u.searchParams.get("site_ids") ?? "").split(",").filter(Boolean);
  if (u.searchParams.get("format") === "csv") return { key: "csv:" + org, res: () => new Response("site;kwh\\n", { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="energie-' + org.slice(-1) + '.csv"', "Cache-Control": "private, no-store" } }) };
  return { key: "report:" + org, res: () => json(200, reportFor(org, ids, u.searchParams.get("from"), u.searchParams.get("to"))) };
};
const fetcher = (url) => {
  calls.push(String(url));
  const { key, res } = route(String(url));
  if (hold[key]) { delete hold[key]; return new Promise((r) => { waiting[key] = () => r(res()); }); }
  return Promise.resolve(res());
};
const release = async (key) => { const go = waiting[key]; delete waiting[key]; if (go) go(); await tick(250); return !!go; };
const ctx = { generation: () => 1, userId: () => "manager-1" };
const div = document.createElement("div"); document.body.appendChild(div);
const root = createRoot(div);
const BOOT = (org) => [{ id: sid(1), name: "Site 1" }, { id: sid(2), name: "Site 2" }];
const mount = (org, initial) => root.render(h(StrictMode, null, h(EnergyConsolidationPanel, { key: org, organizationId: org, sites: BOOT(org), demo: false, context: ctx, fetcher, initial })));
const reset = async () => { calls = []; hold = {}; refuse = {}; waiting = {}; window.saved = []; root.render(null); await tick(50); };
const q = (sel) => div.querySelector(sel);
const qa = (sel) => [...div.querySelectorAll(sel)];
const click = async (sel, ms = 250) => { const el = typeof sel === "string" ? q(sel) : sel; if (el && !el.disabled) el.click(); await tick(ms); return !!el; };
const button = (text) => qa("button").find((b) => b.textContent.trim() === text);
const setVal = (el, v) => { const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
const dates = () => qa("input[type=date]");
const state = () => ({ portfolio: q("[data-energy-portfolio]")?.getAttribute("data-energy-portfolio") ?? null, boxes: qa("[data-energy-site]").map((x) => x.getAttribute("data-energy-site")), chosen: q("[data-energy-chosen]")?.textContent ?? null, refused: q("[data-energy-portfolio-refused]")?.textContent ?? null, report: !!q("[data-energy-report]"), alerts: qa("[role=alert]").map((x) => x.textContent) });
window.scenarios = {
  async beyond() {
    await reset(); mount(A); await tick(200);
    await click("[data-energy-portfolio-open]");
    const page1 = { ...state(), target: !!q('[data-energy-site="' + sid(55) + '"]') };
    await click("[data-energy-portfolio-more]");
    const page2 = { boxes: qa("[data-energy-site]").length, target: !!q('[data-energy-site="' + sid(55) + '"]'), unique: new Set(qa("[data-energy-site]").map((x) => x.getAttribute("data-energy-site"))).size };
    await click('[data-energy-site="' + sid(55) + '"]', 100);
    await click('[data-energy-site="' + sid(1) + '"]', 100);
    setVal(q("[data-energy-portfolio-filter]"), "archived"); await tick(250);
    const archived = { ...state() };
    await click('[data-energy-site="' + sid(901) + '"]', 100);
    setVal(q("[data-energy-portfolio-filter]"), "active"); await tick(250);
    const back = { ...state(), targetVisible: !!q('[data-energy-site="' + sid(55) + '"]') };
    setVal(dates()[0], "2026-02-01"); setVal(dates()[1], "2026-02-28"); await tick(50);
    q("form").requestSubmit(); await tick(300);
    const reportUrl = calls.find((c) => c.includes("/energy?") && !c.includes("format=csv"));
    const shown = { report: !!q("[data-energy-report]"), names: qa("[data-energy-site-result]").map((x) => x.querySelector("strong")?.textContent) };
    await click(button("Exporter en CSV"), 300);
    const csvUrl = calls.find((c) => c.includes("format=csv"));
    return { page1, page2, archived, back, reportUrl, shown, csvUrl, saved: [...window.saved] };
  },
  async refusal(status, onMore) {
    await reset();
    if (onMore === "more") refuse["sites:active:" + sid(50)] = Number(status); else refuse["sites:active:"] = Number(status);
    mount(A); await tick(200);
    await click('[data-energy-site="' + sid(1) + '"]', 100);
    await click("[data-energy-portfolio-open]");
    if (onMore === "more") { await click('[data-energy-site="' + sid(30) + '"]', 100); await click("[data-energy-portfolio-more]"); }
    return state();
  },
  async orgSwitch() {
    await reset();
    const form = { site_ids: [sid(1)], from: "2026-02-01", to: "2026-02-28", compare: false, previous_from: "", previous_to: "" };
    const sel = formToSelection(A, form).selection;
    mount(A, { form, report: parseReport(reportFor(A, [sid(1)], "2026-02-01", "2026-02-28"), sel), selection: sel });
    await tick(200);
    hold["sites:active:"] = true; hold["csv:" + A] = true;
    await click("[data-energy-portfolio-open]", 100);
    await click(button("Exporter en CSV"), 100);
    mount(B); await tick(250); // organisation switch, same uid/generation
    const releasedPage = await release("sites:active:");
    const releasedCsv = await release("csv:" + A);
    return { releasedPage, releasedCsv, ...state(), saved: [...window.saved], exportState: q("[data-energy-export]")?.getAttribute("data-energy-export") ?? null };
  },
};
`;

test("ENT-09/15 portefeuille complet (Chromium) : site au-delà du bootstrap sélectionnable, filtre archivés, refus, changement d’organisation", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const run = (name: string, ...args: string[]) => page.evaluate(([n, a]: [string, string[]]) => (window as unknown as { scenarios: Record<string, (...x: string[]) => Promise<unknown>> }).scenarios[n](...a), [name, args] as [string, string[]]);
    const sid = (n: number) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
    type S = { portfolio: string | null; boxes: string[]; chosen: string | null; refused: string | null; report: boolean; alerts: string[] };

    const r = (await run("beyond")) as { page1: S & { target: boolean }; page2: { boxes: number; target: boolean; unique: number }; archived: S; back: S & { targetVisible: boolean }; reportUrl: string; shown: { report: boolean; names: string[] }; csvUrl: string; saved: string[] };
    same([r.page1.portfolio, r.page1.target, r.page1.boxes.length], ["ready", false, 50], "page 1: 2 bootstrap + 48 more, target not yet listed");
    same([r.page2.target, r.page2.boxes, r.page2.unique], [true, 60, 60], "next page: the target is listed, no duplicate");
    assert.ok(r.archived.boxes.includes(sid(901)) && !r.archived.boxes.includes(sid(30)), "archived filter lists archived sites only");
    assert.match(r.archived.chosen ?? "", /Sites choisis : 2 \/ 50 — .*Site cible 55/, "choices and labels kept across the filter change");
    same(r.back.targetVisible, false, "back to active page 1: the target is no longer listed");
    assert.match(r.back.chosen ?? "", /Sites choisis : 3 \/ 50 — .*Site cible 55.*Ancien dépôt 901/);
    for (const url of [r.reportUrl, r.csvUrl]) {
      const ids = new URL(url, "http://x").searchParams.get("site_ids")!.split(",").sort();
      same(ids, [sid(1), sid(55), sid(901)].sort(), "the report and the CSV use exactly the selection");
    }
    assert.ok(r.shown.report && r.shown.names.includes("Site cible 55"), "the report names the target site");
    same(r.saved, ["energie-a.csv"], "the CSV of that selection is saved");

    for (const [status, where] of [["401", "first"], ["403", "first"], ["404", "first"], ["403", "more"]]) {
      const s = (await run("refusal", status, where)) as S;
      assert.ok(s.refused && s.refused.length > 0, `${status} (${where}): honest message `);
      same([s.chosen, s.report], ["Sites choisis : 0 / 50", false], `${status} (${where}): selection and report cleared`);
      same(s.boxes.filter((id) => ![sid(1), sid(2)].includes(id)), [], `${status} (${where}): no portfolio site left`);
    }

    const o = (await run("orgSwitch")) as S & { releasedPage: boolean; releasedCsv: boolean; saved: string[]; exportState: string | null };
    same([o.releasedPage, o.releasedCsv], [true, true], "A's page and export were in flight");
    same([o.portfolio, o.boxes, o.saved, o.exportState, o.report], ["closed", [sid(1), sid(2)], [], "idle", false], "organisation B: no A data, no stale export");
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
