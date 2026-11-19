import { fileURLToPath as localSourcePath } from "node:url";
// ENT-05 / ENT-09 — real enterprise SiteSheet for an ACTIVE site absent from the cache (StrictMode,
// Chromium 390): after the exact settings read in the current organisation, the EXISTING energy panel
// reads for the exact site, and the co-ownership panel only for a syndic site; server can_write governs
// the write controls; other organisation / archived / demo ⇒ no panel and no read; site switch ⇒ no old
// data. The normal (cached) sheet keeps both panels.
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SiteSheet } from "./components/role/enterprise-space";
import { demoClient, demoReport } from "./lib/features/site-operations/demo";
const ORG = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112", USER = "10000000-0000-4000-8000-000000000001";
const S = (n) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.S = S;
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
window.calls = []; window.probes = [];
const typeOf = (n) => (cfg.type || (n === 78 ? "office" : "syndic"));
const siteRow = (n) => ({ id: S(n), organization_id: cfg.org === "other" ? OTHER : ORG, name: "Site direct " + n, address: "4 zone de la Jambette", access_notes: "", opening_hours: [], type: typeOf(n), budget_cents: 0, settings_version: 2, archived_at: cfg.archived ? "2026-10-02T10:00:00.000Z" : null, created_at: "2026-10-01T10:00:00.000Z" });
const stamp = "2026-10-01T10:00:00.000Z";
const energyRow = (n) => ({ id: "e0000000-0000-4000-8000-0000000000" + n, site_id: S(n), meter_label: "Compteur du site " + n, period_start: "2026-09-01", period_end: "2026-09-30", consumption_wh: 1200000, cost_cents: 24000, source_kind: "invoice", source_reference: "FAC-" + n, note: "", version: 1, created_by: USER, created_at: stamp, updated_by: USER, updated_at: stamp, archived_at: null });
window.fetch = async (url) => {
  const u = String(url); window.calls.push(u);
  const id = (u.match(/\\/api\\/sites\\/([^/?]+)/) || [])[1];
  const n = id ? Number(id.slice(-12)) : 0;
  if (u.endsWith("/settings")) return Response.json({ site: siteRow(n), can_write: !cfg.archived && !cfg.viewer });
  if (u.includes("/energy")) return Response.json({ records: [energyRow(n)], page: { limit: 100, has_more: false, next_cursor: null }, totals: { consumption_wh: 1200000, cost_cents: 24000, complete: true, cost_complete: true }, permissions: { can_write: !cfg.viewer }, basis: "recorded_periods_fully_inside_range" });
  if (u.includes("/co-ownership")) return Response.json({ records: [], page: { limit: 50, total: 0, remaining: 0, has_more: false, next_cursor: null, complete: true }, permissions: { can_write: !cfg.viewer }, basis: "human_documentary_records", capabilities: { sends_notices: false, collects_funds: false, legal_validation: false } });
  if (u.includes("/records")) return Response.json({ items: [], page: { limit: 50, has_more: false, next_cursor: null } });
  return Response.json({ error: "x" }, { status: 503 });
};
function Host() {
  const [id, setId] = useState(S(77));
  window.setSite = setId;
  const cached = cfg.normal ? [{ id: S(77), organization_id: ORG, name: "Site normal 77", address: "Adresse", type: "syndic", budget_cents: 0, archived_at: null }] : [];
  const session = {
    mode: cfg.demo ? "demo" : "live", role: "manager", profileId: USER, busy: false,
    capabilities: { siteOperations: "missing", professional: "loaded" },
    data: { interventions: [], documents: [], quotes: [], payments: [], sites: cached, organizations: [] },
    professional: { compliance_records: [], approval_rules: [], approval: null, compliance: null },
    features: { siteOperations: demoClient(demoReport()) }, loadOrganization: async () => ({ members: [] }),
    mutationContext: { userId: () => USER, generation: () => 0 },
    openIntervention: () => {}, refresh: async () => {},
    reprobeFeature: async (k, hint) => { window.probes.push([k, hint && hint.siteId]); },
    professionalCommand: async () => true,
  };
  const c = { session, demo: !!cfg.demo, organization: { id: ORG, name: "Org" }, activeSite: null, orgSites: cached, orgInterventions: [], scope: { sites: cached, interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, siteAccess: null, authority: { canWrite: !cfg.viewer, readOnlyReason: cfg.viewer ? "Lecture seule." : null, canWriteSite: () => !cfg.viewer }, canCreateRequest: true, reloadSiteAccess: () => {}, go: () => {} };
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
const vertCalls = (calls: string[]) => calls.filter((u) => u.includes("/energy") || u.includes("/co-ownership"));

test("Chromium 390 : fiche directe ⇒ énergie du site exact, copropriété seulement syndic ; lecteur sans écriture ; hors périmètre / archivé / démo ⇒ rien ; changement de site ; fiche normale intacte", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  const open = async (cfg: Record<string, unknown>) => {
    const page: Any = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`${url}#${encodeURIComponent(JSON.stringify(cfg))}`);
    return { page, errors };
  };
  try {
    // Writer, syndic site out of the cache.
    const w = await open({});
    await w.page.locator("[data-site-sheet='direct']").waitFor();
    await w.page.locator('[data-energy-panel="ready"]').waitFor();
    assert.match(await w.page.locator('[data-energy-panel="ready"]').innerText(), /Compteur du site 77/);
    await w.page.locator('[data-co-panel="ready"]').waitFor();
    const calls = vertCalls((await w.page.evaluate("window.calls")) as string[]);
    assert.ok(calls.every((u) => u.startsWith(`/api/sites/${S77}/`)), "reads only for the exact site");
    assert.ok(calls.some((u) => u.includes("/energy")) && calls.some((u) => u.includes("/co-ownership")));
    assert.equal(await w.page.locator("[data-energy-add]").count(), 1, "writer ⇒ energy write control");
    assert.ok((await w.page.locator("[data-co-add]").count()) >= 1, "writer ⇒ co-ownership write control");
    // Site switch to a non-syndic site ⇒ new energy data, no co-ownership, nothing of site 77 left.
    await w.page.evaluate("window.setSite(window.S(78))");
    await w.page.getByText("Site direct 78").first().waitFor();
    await w.page.locator('[data-energy-panel="ready"]').waitFor();
    assert.match(await w.page.locator('[data-energy-panel="ready"]').innerText(), /Compteur du site 78/);
    assert.equal(await w.page.getByText("Compteur du site 77").count(), 0, "no old data after a switch");
    assert.equal(await w.page.locator("[data-co-panel]").count(), 0, "co-ownership only for a syndic site");
    assert.deepEqual(await w.page.evaluate("window.probes"), [], "no probe from these panels");
    assert.deepEqual(w.errors, []);
    // Viewer ⇒ no write controls (server can_write false).
    const v = await open({ viewer: true });
    await v.page.locator('[data-energy-panel="ready"]').waitFor();
    await v.page.locator('[data-co-panel="ready"]').waitFor();
    assert.equal(await v.page.locator("[data-energy-add]").count(), 0, "viewer ⇒ no energy write");
    assert.equal(await v.page.locator("[data-co-add]").count(), 0, "viewer ⇒ no co-ownership write");
    assert.ok(((await v.page.evaluate("document.documentElement.scrollWidth")) as number) <= 390);
    // Other organisation / archived / demo ⇒ no panel, no read, no probe.
    for (const cfg of [{ org: "other" }, { archived: true }, { demo: true }]) {
      const x = await open(cfg);
      await x.page.waitForTimeout(600);
      assert.deepEqual(vertCalls((await x.page.evaluate("window.calls")) as string[]), [], JSON.stringify(cfg) + " ⇒ no energy / co-ownership read");
      assert.equal(await x.page.locator("[data-energy-panel], [data-co-panel]").count(), 0, JSON.stringify(cfg) + " ⇒ no panel");
      assert.deepEqual(await x.page.evaluate("window.probes"), [], JSON.stringify(cfg) + " ⇒ no probe");
      assert.deepEqual(x.errors, []);
    }
    // Normal (cached) sheet unchanged: both panels for a syndic site.
    const n = await open({ normal: true });
    await n.page.locator('[data-energy-panel="ready"]').waitFor();
    await n.page.locator('[data-co-panel="ready"]').waitFor();
    assert.equal(await n.page.locator("[data-site-sheet='direct']").count(), 0);
    assert.deepEqual(n.errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
