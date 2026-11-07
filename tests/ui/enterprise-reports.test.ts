// ENT-15 on-screen enterprise report from the server JSON. Real model/controller + Chromium mount of
// the REAL ReportsView (live ctx stub + fake fetch) at 390 / 1280 px; demo ⇒ zero fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/enterprise-reports/model";

const m = loadModule("components/features/enterprise-reports/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const S1 = "30000000-0000-4000-8000-000000000001";
const S2 = "30000000-0000-4000-8000-000000000002";
const BASIS = { accepted: "accepted_base_and_all_accepted_amendments", paid: "server_registered_stripe_paid_rows_with_paid_at_not_live_bank_verification", historical: "on_site_declared_separate_not_bank_confirmation", refunds: "settled_request_and_matching_immutable_provider_event_ledger", net: "net_client_expense_not_artisan_payout_or_platform_revenue", committed: "active_accepted_less_gross_recorded_settlements_no_automatic_debt_reopening_after_refund" };
const site = (id: string, over: Record<string, unknown> = {}) => ({ site_id: id, name: id === S1 ? "Siège" : "Entrepôt", type: "office", budget_cents: 500000, paid_cents: 120000, committed_cents: 30000, interventions: 150, accepted_cents: 150000, active_accepted_cents: 150000, declared_paid_cents: 20000, unverified_paid_cents: 0, refunded_cents: 0, net_paid_cents: 120000, financial_complete: true, ...over });
const KEYS = ["budget_cents", "accepted_cents", "active_accepted_cents", "paid_cents", "declared_paid_cents", "unverified_paid_cents", "refunded_cents", "net_paid_cents", "committed_cents"] as const;
const totalsOf = (rows: Record<string, unknown>[]) => ({ ...Object.fromEntries(KEYS.map((k) => [k, rows.reduce((n, r) => n + (r[k] as number), 0)])), financial_complete: rows.every((r) => r.financial_complete) });
const reply = (rows: Record<string, unknown>[], org: string = ORG, siteId: string | null = null, over: Record<string, unknown> = {}) => ({ sites: rows, totals: totalsOf(rows), currency: "eur", scope: { kind: "visible_sites", site_id: siteId, organization_id: org, complete: true }, basis: BASIS, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });

test("requête : même périmètre pour le JSON et le CSV (organization_id + site_id) ; lecture stricte ; totaux recalculés", () => {
  same([m.reportQuery(ORG, null), m.reportQuery(ORG, S1), m.reportQuery(ORG, S1, "csv")], [`/api/reports?organization_id=${ORG}`, `/api/reports?organization_id=${ORG}&site_id=${S1}`, `/api/reports?organization_id=${ORG}&site_id=${S1}&format=csv`]);
  assert.ok(m.parseReport(reply([site(S1), site(S2)]), ORG, null));
  assert.ok(m.parseReport(reply([site(S1)], ORG, S1), ORG, S1));
  assert.ok(m.parseReport(reply([]), ORG, null));
  for (const [bad, org, s] of [
    [{ ...reply([site(S1)]), extra: 1 }, ORG, null],
    [reply([site(S1)], ORG_B), ORG, null],
    [reply([site(S1)], ORG, null), ORG, S1],
    [reply([site(S2)], ORG, S1), ORG, S1],
    [reply([site(S1), site(S1)]), ORG, null],
    [{ ...reply([site(S1)]), totals: { ...totalsOf([site(S1)]), paid_cents: 1 } }, ORG, null],
    [reply([site(S1, { net_paid_cents: 1 })]), ORG, null],
    [{ ...reply([site(S1)]), currency: "usd" }, ORG, null],
    [{ ...reply([site(S1)]), basis: { ...BASIS, paid: "bank_verified" } }, ORG, null],
    [reply([site(S1, { secret: 1 })]), ORG, null],
  ] as [unknown, string, string | null][])
    assert.equal(m.parseReport(bad, org, s), null, JSON.stringify(bad).slice(0, 90));
  same(m.parseReport(reply([site(S1)], ORG, null, { scope: { kind: "visible_sites", site_id: null, organization_id: ORG, complete: false } }), ORG, null)?.scope.complete, false, "incomplete scope parsed, labelled honestly by the view");
});

test("contrôleur : pas d’organisation ⇒ 0 lecture ; réponse tardive de l’ancienne organisation ignorée ; 404 / 503 + réessai ; 401/403 effacement ; clé au rendu", async () => {
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const calls: [string, string | null][] = [];
  const replies: (Model.ReportResult | Promise<Model.ReportResult>)[] = [];
  let s: Model.ReportState = m.REPORT_INITIAL;
  const c = m.createReportController({ api: () => ({ read: async (o, x) => (calls.push([o, x]), replies.shift() ?? res(503)) }), context, set: (n) => (s = n) });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  c.query(null, null);
  same([calls.length, s.phase], [0, "idle"], "no organization ⇒ nothing read");
  let lateA!: (r: Model.ReportResult) => void;
  replies.push(new Promise((r) => (lateA = r)), res(200, reply([site(S1, { interventions: 7 })], ORG_B)));
  c.query(ORG, null);
  c.query(ORG_B, null); await tick();
  same([s.phase, s.data?.sites[0].interventions], ["ready", 7]);
  lateA(res(200, reply([site(S1, { interventions: 999 })]))); await tick();
  same(s.data?.sites[0].interventions, 7, "late reply of the old organization dropped");
  replies.push(res(404), res(503), res(200, reply([site(S1)], ORG, S1)));
  c.query(ORG, S1); await tick();
  same([s.phase, s.error], ["error", m.REPORT_COPY.notFound]);
  c.retry(s.key); await tick();
  same([s.phase, s.error], ["error", m.REPORT_COPY.failed]);
  c.retry(s.key); await tick();
  same([s.phase, s.data?.sites.length], ["ready", 1]);
  replies.push(res(403));
  c.query(ORG_B, S2); await tick();
  same([s.phase, s.data], ["forbidden", null], "401/403 ⇒ cleared");
  same(calls[calls.length - 1], [ORG_B, S2]);
  const k = m.reportKey(context, ORG, S1);
  const st = { ...m.REPORT_INITIAL, key: k, phase: "ready" as const, data: m.parseReport(reply([site(S1)], ORG, S1), ORG, S1) };
  for (const other of [m.reportKey(context, ORG, null), m.reportKey(context, ORG_B, S1), m.reportKey({ generation: () => 1, userId: () => USER }, ORG, S1)])
    same([m.reportView(st, other).phase, m.reportView(st, other).data], ["loading", null], "another identity / org / site ⇒ never the old frame");
  same(m.reportView(st, m.reportKey(context, null, null)).phase, "idle");
});

test("câblage : ReportsView en direct ⇒ JSON serveur seulement ; CSV même requête ; pas de « 100 derniers » en direct ; démo inchangée", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  const view = src.slice(src.indexOf("export function ReportsView"), src.indexOf("// ---- Facturation"));
  assert.match(view, /useEnterpriseReport\(\{ enabled: live, context: session\.mutationContext, organizationId: orgId, siteId \}\)/);
  assert.match(view, /const url = reportQuery\(orgId, siteId, "csv"\);/, "CSV carries the same organization_id + site_id");
  assert.match(view, /disabled=\{busy \|\| \(live && !orgId\)\}/, "no organization ⇒ CSV disabled");
  assert.match(view, /subtitle=\{live \? `Rapport consolidé de \$\{c\.activeSite \? c\.activeSite\.name : "tous les sites de l’organisation"\} · \$\{REPORT_COPY\.serverNote\}` : `Rapport consolidé de \$\{c\.activeSite \? c\.activeSite\.name : "tous les sites"\} · \$\{LOADED_NOTE\}`\}/);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReportsView } from "./components/role/enterprise-space";
import { useEnterpriseReport } from "./components/features/enterprise-reports/use-enterprise-report";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const ORG = "${ORG}", ORG_B = "${ORG_B}", S1 = "${S1}", USER = "${USER}";
const reply = ${JSON.stringify(reply([site(S1), site(S2)]))};
const cacheSites = [{ id: S1, organization_id: ORG, name: "Siège", type: "office", budget_cents: 500000 }, { id: "${S2}", organization_id: ORG, name: "Entrepôt", type: "office", budget_cents: 0 }];
// Cache: ONE intervention (window of 100), server: 150 per site.
const cacheData = { interventions: [{ id: "a0000000-0000-4000-8000-000000000001", site_id: S1, status: "requested", urgency: "scheduled", created_at: "2026-01-01T00:00:00Z", category: "outage", address: "x", postal_code: "97200", city: "FDF", estimate_min_cents: 1, estimate_max_cents: 2, description: "" }], quotes: [], payments: [], documents: [] };
const ctx = (org, mode = "live", gen = 0) => ({
  session: { mode, mutationContext: { userId: () => USER, generation: () => gen }, data: cacheData },
  demo: mode === "demo", organization: org ? { id: org, name: "Org" } : null, activeSite: null, orgSites: cacheSites,
  scope: { sites: cacheSites, interventions: cacheData.interventions, quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] },
  authority: { canWrite: true, readOnlyReason: null }, go: () => {},
});
window.run = async () => {
  const calls = [];
  let downloads = 0;
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.startsWith("/api/reports")) {
      if (u.includes("format=csv")) return new Response("x", { status: 200, headers: { "content-type": "text/csv" } });
      return Response.json(reply);
    }
    return Response.json({ error: "x" }, { status: 503 });
  };
  const origCreate = URL.createObjectURL; URL.createObjectURL = (b) => { downloads++; return origCreate(b); };
  const div = document.createElement("div"); div.className = "ui-v2"; document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(ReportsView, { c: ctx(ORG) })));
  await tick(500);
  const total = div.querySelector("[data-report-total]");
  const out = { totalKind: total?.getAttribute("data-report-total"), totalText: total?.textContent ?? "", text: div.textContent, rows: div.querySelectorAll("[data-report-site]").length };
  div.querySelector("[data-report-csv]").click(); await tick(300);
  out.reportCalls = calls.filter((u) => u.startsWith("/api/reports"));
  out.downloads = downloads;
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  root.unmount();
  // Several organizations, none chosen ⇒ disabled, zero fetch.
  const n0 = calls.length;
  const d2 = document.createElement("div"); document.body.appendChild(d2);
  const r2 = createRoot(d2);
  r2.render(h(StrictMode, null, h(ReportsView, { c: ctx(null) })));
  await tick(300);
  out.noOrg = { calls: calls.length - n0, disabled: d2.querySelector("[data-report-csv]").disabled, text: d2.querySelector("[data-report-choose-org]")?.textContent ?? null };
  r2.unmount();
  // Demo ⇒ zero fetch, local table unchanged.
  const n1 = calls.length;
  const d3 = document.createElement("div"); document.body.appendChild(d3);
  const r3 = createRoot(d3);
  r3.render(h(StrictMode, null, h(ReportsView, { c: ctx(ORG, "demo") })));
  await tick(300);
  out.demo = { calls: calls.length - n1, subtitle: d3.textContent.includes("100 derniers"), state: d3.querySelector("[data-report]")?.getAttribute("data-report") };
  r3.unmount();
  // Identity / org change: the first render after the change never shows the old report.
  const frames = [];
  window.fetch = async (url) => { const u = String(url); await tick(u.includes(ORG_B) ? 50 : 10); return Response.json(u.includes(ORG_B) ? ${JSON.stringify(reply([site(S1, { interventions: 7 })], ORG_B))} : reply); };
  let gen = 0;
  const c2 = { userId: () => USER, generation: () => gen };
  function Probe({ org }) { const r = useEnterpriseReport({ enabled: true, context: c2, organizationId: org, siteId: null }); frames.push({ org, gen, phase: r.state.phase, n: r.state.data ? r.state.data.sites[0].interventions : null }); return null; }
  const d4 = document.createElement("div"); document.body.appendChild(d4);
  const r4 = createRoot(d4);
  r4.render(h(StrictMode, null, h(Probe, { org: ORG }))); await tick(200);
  let mark = frames.length; r4.render(h(StrictMode, null, h(Probe, { org: ORG_B }))); await tick(300);
  out.afterOrg = frames.slice(mark);
  mark = frames.length; gen = 1; r4.render(h(StrictMode, null, h(Probe, { org: ORG_B }))); await tick(300);
  out.afterIdentity = frames.slice(mark);
  r4.unmount();
  URL.createObjectURL = origCreate;
  return out;
};
`;
for (const width of [390, 1280])
  test(`ReportsView réelle (Chromium ${width} px) : chiffres du serveur (≠ cache de 100), CSV même périmètre, multi-organisation sans choix ⇒ désactivé 0 appel, démo 0 appel, aucun ancien cadre`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
    const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
    const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><script>${js}</script>`); });
    let browser: { close(): Promise<void>; newContext(o: unknown): Promise<any> } | null = null;
    try {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
      browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
      const context = await browser!.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e: Error) => errors.push(String(e)));
        await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
        const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as Record<string, any>;
        same([r.rows, r.totalKind], [2, "complete"]);
        assert.match(r.totalText, /300/, "server total: 2 × 150 interventions, while the cache has 1");
        assert.doesNotMatch(r.text, /100 derniers/, "no « Données chargées (100 derniers) » in live");
        assert.match(r.text, /données du serveur, tous dossiers/);
        assert.ok(r.reportCalls.includes(`/api/reports?organization_id=${ORG}`) && r.reportCalls.includes(`/api/reports?organization_id=${ORG}&format=csv`), `JSON and CSV share the scope: ${JSON.stringify(r.reportCalls)}`);
        same(r.downloads, 1, "CSV download behaviour unchanged");
        same(r.noOrg, { calls: 0, disabled: true, text: "Choisissez une organisation pour obtenir son rapport et son export CSV." });
        same([r.demo.calls, r.demo.subtitle, r.demo.state], [0, true, "demo"], "demo unchanged, zero fetch");
        for (const [name, frames] of [["org", r.afterOrg], ["identity", r.afterIdentity]] as [string, { phase: string; n: number | null }[]][]) {
          same([frames[0].phase, frames[0].n], ["loading", null], `${name}: FIRST render after the change shows no old report`);
          const firstReady = frames.findIndex((f) => f.phase === "ready");
          assert.ok(frames.slice(0, firstReady).every((f) => f.n === null), `${name}: ${JSON.stringify(frames)}`);
        }
        same(r.afterOrg[r.afterOrg.length - 1].n, 7);
        assert.ok(r.overflow <= 0, `${r.overflow}px`);
        same(errors, []);
      } finally {
        await context.close();
      }
    } finally {
      await browser?.close();
      server.close();
    }
  });
