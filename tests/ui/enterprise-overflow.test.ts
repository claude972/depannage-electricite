import { fileURLToPath as localSourcePath } from "node:url";
// Site sheet at 360 / 390 / 1280 px (real mount of the enterprise SiteSheet with live-like QA data:
// long names, an editable approval circuit with named members, site operations 503 then « Réessayer »).
// No horizontal overflow, tabs and controls reachable. Fix: minmax(0, 1fr) single columns.
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { SiteSheet } from "./components/role/enterprise-space";
import { demoClient, demoReport } from "./lib/features/site-operations/demo";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = "22222222-2222-4222-8222-222222222222", ORG = "11111111-1111-4111-8111-111111111111", USER = "33333333-3333-4333-8333-333333333333", READER = "44444444-4444-4444-8444-444444444444";
const measure = () => {
  const W = document.documentElement.clientWidth;
  const block = document.querySelector("[class*='approvals_block']");
  const form = document.querySelector("[class*='approvals_form']");
  const over = [...document.querySelectorAll("#app *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > W + 0.5; }).length;
  return { W, sw: document.documentElement.scrollWidth, block: block ? Math.round(block.getBoundingClientRect().width) : null, form: form ? Math.round(form.getBoundingClientRect().width) : null, over };
};
window.run = async (failFirst) => {
  const rep = demoReport();
  rep.snapshot.site.name = "QA-2BDC1016136B Site A1";
  rep.snapshot.equipment = [{ ...rep.snapshot.equipment[1], name: "QA-2BDC1016136B TGBT recette", location: "Local technique QA" }];
  const base = demoClient(rep);
  let loads = 0;
  const client = { ...base, load: async (id) => { loads++; if (failFirst && loads === 1) { const e = new Error("Les données du site n’ont pas pu être chargées."); e.status = 503; throw e; } return base.load(id); } };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/approval-policy")) return Response.json({ site_id: SITE, policy: { version: 1, enabled: true, threshold_cents: 0, steps: [{ role: "owner" }] }, can_manage: true });
    return Response.json({ error: "x" }, { status: 503 });
  };
  const site = { id: SITE, organization_id: ORG, name: "QA-2BDC1016136B Site A1", address: "Adresse technique QA, aucun déplacement", type: "erp", budget_cents: 0, archived_at: null };
  const session = {
    mode: "live", role: "manager", profileId: USER, busy: false,
    capabilities: { siteOperations: "available", professional: "loaded" },
    data: { interventions: [], documents: [], quotes: [], payments: [], sites: [site], organizations: [] },
    professional: { compliance_records: [], approval_rules: [], approval: null, compliance: null },
    features: { siteOperations: client },
    loadOrganization: async () => ({ members: [{ user_id: USER, role: "owner", full_name: "QA 2BDC1016136B owner" }, { user_id: READER, role: "viewer", full_name: "QA 2BDC1016136B lecteur" }] }),
    mutationContext: { userId: () => USER, generation: () => 0 },
    openIntervention: () => {}, refresh: async () => {}, professionalCommand: async () => null, reprobeFeature: async () => {},
  };
  const c = { session, demo: false, organization: { id: ORG, name: "QA-2BDC1016136B Organisation A" }, activeSite: null, orgSites: [site], orgInterventions: [], scope: { sites: [site], interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, siteAccess: null, authority: { canWrite: true, readOnlyReason: null, canWriteSite: () => true }, canCreateRequest: true, reloadSiteAccess: () => {}, go: () => {} };
  const div = document.getElementById("app");
  div.className = "ui-v2";
  createRoot(div).render(h("main", { className: "content" }, h(SiteSheet, { c, id: SITE })));
  await tick(1200);
  const out = { loaded: null, afterRetry: null, errorShown: false };
  if (failFirst) {
    const retry = document.querySelector("[data-blocker='site-operations-load'] button");
    out.errorShown = !!retry;
    out.onError = measure();
    retry?.click();
    await tick(800);
    out.afterRetry = measure();
  } else out.loaded = measure();
  // Realigned (phase 2 lot B): the site sheet now also mounts « Pièces du site » with its own
  // two-tab list; the count targets the site-operations tablist, reachability covers every tab.
  const rect = (t) => { const b = t.getBoundingClientRect(); return { h: Math.round(b.height), right: Math.round(b.right) }; };
  out.tabs = [...document.querySelectorAll('[role=tablist][aria-label="Sections des opérations du site"] [role=tab]')].map(rect);
  out.allTabs = [...document.querySelectorAll("[role=tab]")].map(rect);
  const controls = [...document.querySelectorAll("[class*='approvals_block'] button, [class*='approvals_block'] select, [class*='approvals_block'] input:not([type=checkbox]), [class*='approvals_block'] label:has(input[type=checkbox])")];
  out.controls = controls.map((el) => { const b = el.getBoundingClientRect(); return { h: Math.round(b.height), right: Math.round(b.right), w: Math.round(b.width) }; }).filter((x) => x.w > 0);
  return out;
};
`;
for (const width of [360, 390, 1280])
  test(`fiche de site réelle à ${width} px : aucun débordement chargé, ni après 503 + « Réessayer » ; onglets et contrôles atteignables`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
    const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
    const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div id="app"></div><script>${js}</script>`); });
    let browser: { close(): Promise<void>; newContext(o: unknown): Promise<any> } | null = null;
    try {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
      browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
      for (const failFirst of [false, true]) {
        const context = await browser!.newContext({ viewport: { width, height: 900 } });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e: Error) => errors.push(String(e)));
          await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
          const r = (await page.evaluate((f: boolean) => (window as unknown as { run: (x: boolean) => Promise<unknown> }).run(f), failFirst)) as Record<string, any>;
          const m = failFirst ? r.afterRetry : r.loaded;
          if (failFirst) assert.ok(r.errorShown, "503 ⇒ « Réessayer » shown");
          assert.ok(m.sw <= m.W && m.over === 0, `${width}px ${failFirst ? "after 503 + Réessayer" : "loaded"}: scrollWidth ${m.sw} > ${m.W} (${m.over} elements past the edge)`);
          if (failFirst) assert.ok(r.onError.sw <= r.onError.W, `${width}px on the 503 state: ${r.onError.sw}`);
          assert.ok(m.block !== null && m.form !== null && m.block <= m.W && m.form <= m.W, `approval block ${m.block} / form ${m.form}`);
          assert.equal(r.tabs.length, 7, "7 site operations tabs");
          assert.ok(r.tabs.every((t: { right: number }) => t.right <= m.W + 0.5) || width < 1280, "tabs inside the viewport at desktop");
          assert.ok(r.allTabs.length >= r.tabs.length && (r.allTabs.every((t: { right: number }) => t.right <= m.W + 0.5) || width < 1280), "every tab of the sheet inside the viewport at desktop");
          assert.ok(r.controls.length > 0 && r.controls.every((x: { h: number; right: number }) => x.h >= 44 && x.right <= m.W + 0.5), `approval controls ${JSON.stringify(r.controls)}`);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser?.close();
      server.close();
    }
  });
