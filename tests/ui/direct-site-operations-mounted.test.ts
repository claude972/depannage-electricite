// ENT-08 — real enterprise SiteSheet for an ACTIVE site absent from the cache (StrictMode, Chromium
// 390): after the exact settings read, the SAME « Opérations du site » module is mounted (Maintenance
// plans + visits), write cap = the settings GET can_write; another organisation or an archived site ⇒
// zero probe and zero operations read; site switch ⇒ no data of the other site; unavailable ⇒ retry;
// demo ⇒ 0 fetch; SLA ticket navigation + interventionSearch still work on the direct path.
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
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SiteSheet } from "./components/role/enterprise-space";
import { demoReport } from "./lib/features/site-operations/demo";
const ORG = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112", USER = "10000000-0000-4000-8000-000000000001";
const S = (n) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.S = S;
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
// Settings GET (exact read): site n, org per cfg, archived per cfg, can_write per cfg.
window.calls = []; window.probes = []; window.loads = []; window.opened = []; window.failLoad = cfg.failLoad || 0;
const siteRow = (n) => ({ id: S(n), organization_id: cfg.org === "other" ? OTHER : ORG, name: "Site direct " + n, address: "4 zone de la Jambette", access_notes: "", opening_hours: [], type: "office", budget_cents: 0, settings_version: 2, archived_at: cfg.archived ? "2026-10-02T10:00:00.000Z" : null, created_at: "2026-10-01T10:00:00.000Z" });
window.fetch = async (url, init) => {
  const u = String(url); window.calls.push(u);
  const m = u.match(/\\/api\\/sites\\/([^/]+)\\/settings/);
  if (m) return Response.json({ site: siteRow(Number(m[1].slice(-12))), can_write: !cfg.archived && !cfg.viewer });
  if (u.includes("/records")) return Response.json({ items: [], page: { limit: 50, has_more: false, next_cursor: null } });
  if (u.includes("/api/enterprise/interventions/search")) return Response.json({ items: [], total: 0, page: { number: 1, limit: 10, pages: 1 } });
  return Response.json({ error: "x" }, { status: 503 });
};
// Site-operations client: one report per site (its own name), plan + case with a linked ticket.
const reportFor = (siteId) => {
  const r = demoReport();
  r.site_id = siteId; r.snapshot.site.id = siteId; r.snapshot.site.organization_id = ORG; r.snapshot.site.name = "Rapport de " + siteId.slice(-2);
  r.snapshot.maintenance_plans = r.snapshot.maintenance_plans.map((p) => ({ ...p, site_id: siteId, title: p.title + " — site " + siteId.slice(-2) }));
  r.snapshot.sla_cases[0].intervention_id = "aa000000-0000-4000-8000-000000000042";
  r.snapshot.limits.can_write_site = true;
  return r;
};
const client = { load: async (siteId) => { window.loads.push(siteId); if (window.failLoad > 0) { window.failLoad--; throw new Error("Service momentanément indisponible."); } return reportFor(siteId); }, command: async (c) => ({ action: c.action, result: {} }) };
function Host() {
  const [id, setId] = useState(S(77));
  window.setSite = setId;
  const session = {
    mode: cfg.demo ? "demo" : "live", role: "manager", profileId: USER, busy: false,
    capabilities: { siteOperations: cfg.ops || "unknown", professional: "loaded" },
    data: { interventions: [], documents: [], quotes: [], payments: [], sites: [], organizations: [] },
    professional: { compliance_records: [], approval_rules: [], approval: null, compliance: null },
    features: { siteOperations: client }, loadOrganization: async () => ({ members: [] }),
    mutationContext: { userId: () => USER, generation: () => 0 },
    openIntervention: (i) => window.opened.push(i), refresh: async () => {},
    reprobeFeature: async (k, hint) => { window.probes.push([k, hint && hint.siteId]); },
    professionalCommand: async () => true,
  };
  const c = { session, demo: !!cfg.demo, organization: { id: ORG, name: "Org" }, activeSite: null, orgSites: [], orgInterventions: [], scope: { sites: [], interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, siteAccess: null, authority: { canWrite: !cfg.viewer, readOnlyReason: cfg.viewer ? "Lecture seule." : null, canWriteSite: () => !cfg.viewer }, canCreateRequest: true, reloadSiteAccess: () => {}, go: () => {} };
  return h("main", { className: "content" }, h(SiteSheet, { c, id }));
}
const div = document.createElement("div"); div.className = "ui-v2"; document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const S77 = "50000000-0000-4000-8000-000000000077";
async function withPage(fn: (open: (cfg: Record<string, unknown>) => Promise<{ page: Any; errors: string[] }>) => Promise<void>) {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    await fn(async (cfg) => {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${url}#${encodeURIComponent(JSON.stringify(cfg))}`);
      return { page, errors };
    });
  } finally {
    await browser.close();
    server.close();
  }
}

test("Chromium 390 : fiche directe ⇒ module Opérations (plans + visites) ; écrivain vs lecteur ; sonde exacte ; changement de site ; SLA + recherche", { skip }, async () => {
  await withPage(async (open) => {
    // Writer, capability unknown ⇒ exactly one probe for THIS site after the exact read.
    const { page, errors } = await open({ ops: "unknown" });
    await page.locator("[data-site-sheet='direct']").waitFor();
    await page.waitForFunction("window.probes.length >= 1");
    assert.deepEqual([...new Set(((await page.evaluate("window.probes")) as string[][]).map((p) => p.join("|")))], [`siteOperations|${S77}`], "probe only for this site");
    assert.match(await page.locator("#site-operations").innerText(), /Opérations du site/);
    // Available ⇒ the same module renders Maintenance with plans and the visit action.
    const w = await open({ ops: "available" });
    await w.page.getByRole("tab", { name: "Maintenance" }).or(w.page.getByRole("button", { name: "Maintenance", exact: true })).first().click();
    await w.page.getByText(/site 77/).first().waitFor();
    assert.ok((await w.page.getByRole("button", { name: "Enregistrer une visite" }).count()) >= 1, "visit action (writer)");
    assert.equal(await w.page.getByRole("button", { name: "Ajouter un plan" }).count(), 1);
    assert.deepEqual([...new Set((await w.page.evaluate("window.loads")) as string[])], [S77], "operations read for the exact site");
    // SLA: ticket navigation + interventionSearch on the direct path.
    await w.page.getByRole("tab", { name: "Délais" }).or(w.page.getByRole("button", { name: "Délais", exact: true })).first().click();
    await w.page.locator('[data-sla-case-link="aa000000-0000-4000-8000-000000000042"] button').click();
    assert.deepEqual(await w.page.evaluate("window.opened"), ["aa000000-0000-4000-8000-000000000042"]);
    await w.page.locator("li").filter({ hasText: "DEMO-001" }).getByRole("button", { name: "Modifier" }).click();
    await w.page.getByRole("button", { name: "Choisir un autre ticket" }).click();
    await w.page.locator('[data-sla-picker="ready"]').waitFor();
    const search = ((await w.page.evaluate("window.calls")) as string[]).filter((u) => u.includes("/interventions/search"));
    assert.ok(search.length >= 1, "interventionSearch wired on the direct path");
    // Site switch ⇒ no data of the previous site.
    await w.page.getByRole("button", { name: "Annuler" }).click();
    await w.page.evaluate("window.setSite(window.S(78))");
    await w.page.getByText("Site direct 78").first().waitFor();
    await w.page.getByRole("tab", { name: "Maintenance" }).or(w.page.getByRole("button", { name: "Maintenance", exact: true })).first().click();
    await w.page.getByText(/site 78/).first().waitFor();
    assert.equal(await w.page.getByText(/site 77/).count(), 0, "no other-site data after a switch");
    assert.deepEqual(errors, []);
    assert.deepEqual(w.errors, []);
    // Viewer (settings can_write false) ⇒ no write control.
    const v = await open({ ops: "available", viewer: true });
    await v.page.getByRole("tab", { name: "Maintenance" }).or(v.page.getByRole("button", { name: "Maintenance", exact: true })).first().click();
    await v.page.getByText(/site 77/).first().waitFor();
    assert.equal(await v.page.getByRole("button", { name: "Enregistrer une visite" }).count(), 0, "viewer ⇒ no visit action");
    assert.equal(await v.page.getByRole("button", { name: "Ajouter un plan" }).count(), 0, "viewer ⇒ no plan creation");
    assert.ok(((await v.page.evaluate("document.documentElement.scrollWidth")) as number) <= 390);
    assert.deepEqual(v.errors, []);
  });
});

test("Chromium 390 : autre organisation / site archivé ⇒ ZÉRO sonde et zéro lecture ; indisponible ⇒ Réessayer ; démo ⇒ 0 fetch", { skip }, async () => {
  await withPage(async (open) => {
    for (const cfg of [{ ops: "unknown", org: "other" }, { ops: "unknown", archived: true }]) {
      const { page, errors } = await open(cfg);
      await page.waitForTimeout(600);
      assert.deepEqual(await page.evaluate("window.probes"), [], JSON.stringify(cfg) + " ⇒ zero probe");
      assert.deepEqual(await page.evaluate("window.loads"), [], JSON.stringify(cfg) + " ⇒ zero operations read");
      assert.equal(await page.locator("#site-operations").count(), 0);
      assert.deepEqual(errors, []);
    }
    // Capability unavailable ⇒ honest state with « Réessayer » (re-probe of this site).
    const u = await open({ ops: "unavailable" });
    await u.page.locator("[data-site-sheet='direct']").waitFor();
    await u.page.locator("section[aria-labelledby=site-operations]").getByRole("button", { name: "Réessayer" }).click();
    await u.page.waitForFunction("window.probes.length === 1");
    assert.deepEqual(await u.page.evaluate("window.probes"), [["siteOperations", S77]]);
    // Transport failure on the operations read ⇒ retry ⇒ report.
    const t = await open({ ops: "available", failLoad: 99 });
    const retry = t.page.locator("section[aria-labelledby=site-operations] [data-blocker=site-operations-load]").getByRole("button", { name: "Réessayer" });
    await retry.waitFor();
    assert.equal(await t.page.getByText(/site 77/).count(), 0, "no data while unavailable");
    await t.page.evaluate("window.failLoad = 0");
    await retry.click();
    await t.page.getByRole("tab", { name: "Maintenance" }).or(t.page.getByRole("button", { name: "Maintenance", exact: true })).first().click();
    await t.page.getByText(/site 77/).first().waitFor();
    // Demo ⇒ 0 fetch.
    const d = await open({ demo: true, ops: "available" });
    await d.page.waitForTimeout(500);
    assert.deepEqual(await d.page.evaluate("window.calls"), [], "demo ⇒ 0 fetch");
    assert.deepEqual(await d.page.evaluate("window.loads"), []);
  });
});
