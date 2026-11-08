// Site sheet paginated records (SYS-07 / ENT-04 / ENT-10). Real model/controller + Chromium mount of
// the REAL enterprise SiteSheet (live ctx stub + fake fetch) at 360 / 390 / 1280 px; demo ⇒ 0 fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-records/model";

const m = loadModule("components/features/site-records/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "33333333-3333-4333-8333-333333333333";
const SITE = "22222222-2222-4222-8222-222222222222";
const SITE_B = "22222222-2222-4222-8222-222222222223";
const J = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const D = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n: number, over: Record<string, unknown> = {}) => ({ id: J(n), site_id: SITE, category: "outage", status: "requested", created_at: "2026-01-02T10:00:00Z", ...over });
const due = (n: number, over: Record<string, unknown> = {}) => ({ id: D(n), site_id: SITE, title: `Échéance ${n}`, kind: "maintenance", due_on: "2026-12-01", status: "pending", notes: "", ...over });
const page = (items: unknown[], next: string | null = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
const res = (status: number, body: unknown = null) => ({ status, body });

test("lecture stricte du contrat (docs/SITE_RECORDS_BACKEND.md) : formes, limite 50, curseur, site, filtre propre à chaque kind ; URL exacte", () => {
  assert.ok(m.parseRecords(page([job(1)], "c1"), SITE, "open"));
  assert.ok(m.parseRecords(page([job(1, { status: "paid" })]), SITE, "past"));
  assert.ok(m.parseRecords(page([due(1, { status: "scheduled" })]), SITE, "upcoming"));
  assert.ok(m.parseRecords(page([due(1, { status: "completed" })]), SITE, "completed"));
  assert.ok(m.parseRecords(page([due(1, { kind: "safety", status: "completed" })]), SITE, "audits"));
  for (const [bad, kind] of [
    [{ ...page([job(1)]), extra: 1 }, "open"],
    [{ items: [job(1)], page: { limit: 25, has_more: false, next_cursor: null } }, "open"],
    [{ items: [job(1)], page: { limit: 50, has_more: true, next_cursor: null } }, "open"],
    [page([job(1, { status: "paid" })]), "open"],
    [page([job(1, { status: "requested" })]), "past"],
    [page([job(1, { site_id: SITE_B })]), "open"],
    [page([job(1), job(1)]), "open"],
    [page([job(1, { description: "x" })]), "open"],
    [page([due(1)]), "open"],
    [page([due(1, { status: "completed" })]), "upcoming"],
    [page([due(1)]), "completed"],
    [page([due(1, { kind: "maintenance" })]), "audits"],
    [page([due(1, { due_on: "demain" })]), "upcoming"],
    [page(Array.from({ length: 51 }, (_, i) => job(i + 1))), "open"],
  ] as [unknown, Model.Kind][])
    assert.equal(m.parseRecords(bad, SITE, kind), null, JSON.stringify(bad).slice(0, 90));
  same([m.recordsUrl(SITE, "upcoming", null), m.recordsUrl(SITE, "open", "c 1")], [`/api/sites/${SITE}/records?kind=upcoming`, `/api/sites/${SITE}/records?kind=open&cursor=c%201`]);
});

test("contrôleur : kind ⇒ page 1 sans mélange ; « Afficher plus » dédupliqué ; réponse tardive ignorée ; 404 / 503 + réessai ; 401/403 ; relecture après action", async () => {
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const calls: [string, string, string | null][] = [];
  const replies: (Model.RecordsResult | Promise<Model.RecordsResult>)[] = [];
  let s: Model.RecordsState = m.RECORDS_INITIAL;
  const c = m.createRecordsController({ api: () => ({ read: async (site, kind, cursor) => (calls.push([site, kind, cursor]), replies.shift() ?? res(503)) }), context, set: (n) => (s = n) });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  replies.push(res(200, page([job(1), job(2)], "c1")), res(200, page([job(2), job(3)])));
  c.query(SITE, "open"); await tick();
  await c.more(s.key);
  same([s.items.map((x) => x.id), s.next, calls[1]], [[J(1), J(2), J(3)], null, [SITE, "open", "c1"]], "appended with dedupe");
  let late!: (r: Model.RecordsResult) => void;
  replies.push(new Promise((r) => (late = r)), res(200, page([job(9, { status: "paid" })])));
  c.query(SITE, "open"); // same key: nothing
  same(calls.length, 2);
  c.query(SITE_B, "open");
  c.query(SITE, "past"); await tick();
  same([s.items.map((x) => x.id), calls[calls.length - 1]], [[J(9)], [SITE, "past", null]], "kind switch ⇒ page 1, cursor reset");
  late(res(200, page([job(5, { site_id: SITE_B })], null))); await tick();
  same(s.items.map((x) => x.id), [J(9)], "late reply of the previous site dropped");
  replies.push(res(404), res(503), res(200, page([due(1)])));
  c.query(SITE, "upcoming"); await tick();
  same([s.phase, s.error], ["error", m.RECORDS_COPY.notFound]);
  c.retry(s.key); await tick();
  same(s.error, m.RECORDS_COPY.failed);
  c.retry(s.key); await tick();
  same([s.phase, s.items.length], ["ready", 1]);
  replies.push(res(200, page([])));
  c.refresh(s.key); await tick();
  same([s.items.length, calls[calls.length - 1]], [0, [SITE, "upcoming", null]], "refresh re-reads page 1 of the same key");
  replies.push(res(403));
  c.query(SITE, "completed"); await tick();
  same([s.phase, s.items], ["forbidden", []]);
  const k = m.recordsKey(context, SITE, "open");
  const st = { ...m.RECORDS_INITIAL, key: k, phase: "ready" as const, items: [job(1) as Model.JobRow] };
  for (const other of [m.recordsKey(context, SITE, "past"), m.recordsKey(context, SITE_B, "open"), m.recordsKey({ generation: () => 1, userId: () => USER }, SITE, "open")])
    same([m.recordsView(st, other).phase, m.recordsView(st, other).items], ["loading", []], "another identity / site / kind ⇒ never the old rows");
});

test("câblage : lectures seulement dans la fiche live ; droits = canWriteSite ; un seul panneau de rappel monté à la demande ; relecture après « Marquer terminé »", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  const sheet = src.slice(src.indexOf("export function SiteSheet"), src.indexOf("function DirectSiteSheet"));
  assert.match(sheet, /const live = session\.mode !== "demo";/);
  assert.match(sheet, /useSiteRecords\(\{ enabled: live, context: session\.mutationContext, siteId: recordsSite, kind: tab \}\)/);
  assert.match(sheet, /const canWrite = c\.authority\.canWriteSite\(site\.id\);/, "rights stay with canWriteSite");
  assert.match(sheet, /aria-expanded=\{openReminder === r\.id\}/);
  assert.match(sheet, /\{openReminder === r\.id && \(/, "reminder panel mounted only when opened");
  assert.match(sheet, /if \(ok\) \{\n\s*setReminder\(null\);\n\s*upcoming\.refresh\(\);\n\s*completedDue\.refresh\(\);/, "re-read after a server-confirmed save_compliance");
  assert.equal((src.match(/useSiteRecords\(/g) ?? []).length, 4, "records read only from the site sheet");
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteSheet } from "./components/role/enterprise-space";
import { demoClient, demoReport } from "./lib/features/site-operations/demo";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = "${SITE}", ORG = "11111111-1111-4111-8111-111111111111", USER = "${USER}";
const J = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const D = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const job = (n, status) => ({ id: J(n), site_id: SITE, category: "outage", status, created_at: "2026-01-02T10:00:00Z" });
const due = (n, status, kind = "maintenance") => ({ id: D(n), site_id: SITE, title: "Échéance " + n, kind, due_on: "2026-12-01", status, notes: "" });
const page = (items, next = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
const mount = (opts) => {
  const calls = [];
  let saved = 0, upcomingFails = opts.upcomingFails, holdOpen = opts.holdOpen;
  let releaseOpen = null;
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    const q = new URL(u, "http://x").searchParams;
    if (u.includes("/records")) {
      const kind = q.get("kind"), cursor = q.get("cursor");
      if (kind === "open") {
        if (holdOpen) { holdOpen = false; await new Promise((r) => (releaseOpen = r)); return Response.json(page([job(999, "requested")])); }
        return Response.json(cursor ? page([job(50, "requested"), ...Array.from({ length: 70 }, (_, i) => job(101 + i, "requested")).slice(0, 49)]) : page(Array.from({ length: 50 }, (_, i) => job(i + 1, "requested")), "c1"));
      }
      if (kind === "past") return Response.json(page([job(500, "paid")]));
      if (kind === "upcoming") {
        if (upcomingFails) return Response.json({ error: "x" }, { status: 503 });
        const n = cursor ? Number(cursor.slice(1)) : 0; // 7 pages × 50 = 350 due dates (> the 300 cache)
        return Response.json(page(Array.from({ length: 50 }, (_, i) => due(301 + n * 50 + i - saved, "pending")), n < 6 ? "u" + (n + 1) : null));
      }
      if (kind === "completed") return Response.json(page([due(900, "completed")]));
      if (kind === "audits") return Response.json(page([due(700, "completed", "audit")]));
    }
    if (u.includes("/reminder")) return Response.json({ error: "x" }, { status: 503 });
    return Response.json({ error: "x" }, { status: 503 });
  };
  const site = { id: SITE, organization_id: ORG, name: "Site QA", address: "Adresse QA", type: "erp", budget_cents: 0, archived_at: null };
  let gen = 0;
  const session = {
    mode: opts.demo ? "demo" : "live", role: "manager", profileId: USER, busy: false,
    capabilities: { siteOperations: "available", professional: "loaded" },
    // Cache: ONE intervention and ONE due date (windows of 100 / 300).
    data: { interventions: [{ id: J(1), site_id: SITE, status: "requested", urgency: "scheduled", created_at: "2026-01-01T00:00:00Z", category: "outage", address: "x", postal_code: "97200", city: "FDF", estimate_min_cents: 1, estimate_max_cents: 2, description: "" }], documents: [], quotes: [], payments: [], sites: [site], organizations: [] },
    professional: { compliance_records: [{ id: D(1), site_id: SITE, title: "Cache", kind: "maintenance", due_on: "2026-12-01", status: "pending", notes: "" }], approval_rules: [], approval: null, compliance: null },
    features: { siteOperations: demoClient(demoReport()) },
    loadOrganization: async () => ({ members: [] }),
    mutationContext: { userId: () => USER, generation: () => gen },
    openIntervention: () => {}, refresh: async () => {}, reprobeFeature: async () => {},
    professionalCommand: async () => { saved++; return true; },
  };
  const c = { session, demo: !!opts.demo, organization: { id: ORG, name: "Org" }, activeSite: null, orgSites: [site], orgInterventions: [], scope: { sites: [site], interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, siteAccess: null, authority: { canWrite: true, readOnlyReason: null, canWriteSite: () => true }, canCreateRequest: true, reloadSiteAccess: () => {}, go: () => {} };
  const div = document.createElement("div"); div.className = "ui-v2"; document.body.appendChild(div);
  const root = createRoot(div);
  const render = () => root.render(h(StrictMode, null, h("main", { className: "content" }, h(SiteSheet, { c, id: SITE }))));
  render();
  return { div, root, calls, release: () => releaseOpen?.(), setGen: (g) => { gen = g; render(); }, saved: () => saved };
};
const segment = (div, label, text) => [...div.querySelectorAll("[aria-label='" + label + "'] button")].find((b) => b.textContent === text);
window.run = async () => {
  const out = {};
  const a = mount({});
  await tick(700);
  out.jobsFirst = a.div.querySelectorAll("[data-site-job]").length;
  a.div.querySelector("[data-site-records-more='jobs']").click(); await tick(300);
  out.jobsAfterMore = a.div.querySelectorAll("[data-site-job]").length;
  out.dueRows = a.div.querySelectorAll("[data-site-due]").length;
  for (let i = 0; i < 6; i++) {
    const before = a.div.querySelectorAll("[data-site-due]").length;
    a.div.querySelector("[data-site-records-more='due']").click();
    for (let w = 0; w < 40 && a.div.querySelectorAll("[data-site-due]").length === before; w++) await tick(25);
    await tick(30);
  }
  out.dueAll = a.div.querySelectorAll("[data-site-due]").length;
  out.dueMoreLeft = !!a.div.querySelector("[data-site-records-more='due']");
  out.nextDue = a.div.querySelector("[data-site-next-due]").textContent;
  out.remindersOnLoad = a.calls.filter((u) => u.includes("/reminder")).length;
  const t = a.div.querySelector("[data-site-reminder-toggle]");
  out.ariaBefore = t.getAttribute("aria-expanded");
  t.click(); await tick(300);
  out.ariaAfter = a.div.querySelector("[data-site-reminder-toggle]").getAttribute("aria-expanded");
  out.remindersAfterOpen = new Set(a.calls.filter((u) => u.includes("/reminder"))).size;
  out.reminderCallsAfterOpen = a.calls.filter((u) => u.includes("/reminder")).length;
  segment(a.div, "Filtre des échéances du site", "Terminées").click(); await tick(300);
  out.reminderClosedOnTab = !a.div.querySelector("[id^='site-reminder-']");
  out.completedRows = a.div.querySelectorAll("[data-site-due]").length;
  segment(a.div, "Filtre des échéances du site", "En attente").click(); await tick(300);
  const n = a.calls.filter((u) => u.includes("kind=upcoming")).length;
  a.div.querySelector("[data-site-due-complete]").click(); await tick(400);
  out.upcomingReread = a.calls.filter((u) => u.includes("kind=upcoming")).length - n;
  out.saved = a.saved();
  segment(a.div, "Filtre des interventions du site", "Passées").click(); await tick(300);
  out.pastRows = [...a.div.querySelectorAll("[data-site-job]")].map((x) => x.getAttribute("data-site-job"));
  out.pastCalls = a.calls.filter((u) => u.includes("kind=past"));
  out.auditRows = a.div.querySelectorAll("[data-site-audit]").length;
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const heights = [...a.div.querySelectorAll("[data-site-reminder-toggle], [data-site-due-complete], [data-site-records-more]")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  out.heights = heights;
  a.root.unmount();
  // Late reply: the open read is held, the tab switches to « Passées » before it lands.
  const b = mount({ holdOpen: true });
  await tick(300);
  segment(b.div, "Filtre des interventions du site", "Passées").click(); await tick(200);
  b.release(); await tick(300);
  out.lateRows = [...b.div.querySelectorAll("[data-site-job]")].map((x) => x.getAttribute("data-site-job"));
  b.root.unmount();
  // Next due date on a failed upcoming read: never « Aucune ».
  const e = mount({ upcomingFails: true });
  await tick(500);
  out.nextDueError = e.div.querySelector("[data-site-next-due]").textContent;
  e.root.unmount();
  // Demo: unchanged, zero records call.
  const d = mount({ demo: true });
  await tick(400);
  out.demoRecords = d.calls.filter((u) => u.includes("/records") || u.includes("/reminder")).length;
  out.demoCache = d.div.textContent.includes("Cache");
  d.root.unmount();
  return out;
};
`;
for (const width of [360, 390, 1280])
  test(`fiche de site réelle à ${width} px : lignes serveur (> caches), onglets et kinds, plus, rappel à la demande, relecture après action, tardive ignorée, échéance « Non vérifiée », démo 0 appel`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
        same([r.jobsFirst, r.jobsAfterMore], [50, 99], "server rows (> the 1 cached), page 2 appended with dedupe");
        same(r.dueRows, 50, "50 server due dates (> the 1 cached)");
        same([r.dueAll, r.dueMoreLeft], [350, false], "350 due dates across 7 pages (> the 300 cache), then no « Afficher plus »");
        assert.match(r.nextDue, /Prochaine échéance.*Échéance 301/);
        same([r.remindersOnLoad, r.ariaBefore, r.ariaAfter, r.remindersAfterOpen], [0, "false", "true", 1], "0 reminder GET on load, exactly 1 reminder read after opening one");
        assert.ok(r.reminderCallsAfterOpen <= 2, "≤ 2 calls: React StrictMode (dev) mounts the opened panel twice; production mounts it once");
        same([r.reminderClosedOnTab, r.completedRows], [true, 1], "a tab change closes the reminder; completed kind shown");
        same([r.saved, r.upcomingReread], [1, 1], "« Marquer terminé » then one upcoming re-read");
        same(r.pastRows, ["a0000000-0000-4000-8000-000000000500"], "past kind, page 1");
        assert.ok(r.pastCalls.every((u: string) => !u.includes("cursor")), "kind switch resets the cursor");
        same(r.auditRows, 1);
        same(r.lateRows, ["a0000000-0000-4000-8000-000000000500"], "the late « open » reply after switching to « Passées » is dropped");
        assert.match(r.nextDueError, /Non vérifiée/);
        assert.doesNotMatch(r.nextDueError, /Aucune/, "never « Aucune » from an error");
        same([r.demoRecords, r.demoCache], [0, true], "demo unchanged, zero records call");
        assert.ok(r.heights.length > 0 && r.heights.every((x: number) => x >= 44), `targets ${r.heights.join(",")}`);
        assert.ok(r.overflow <= 0, `${width}px overflow ${r.overflow}`);
        same(errors, []);
      } finally {
        await context.close();
      }
    } finally {
      await browser?.close();
      server.close();
    }
  });
