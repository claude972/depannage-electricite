// ENT-12 decision on an EXACT enterprise quote outside the startup data. Real model/controller +
// Chromium mount of the REAL EnterpriseQuoteView (live ctx stub + fake fetch) at 390 / 1280 px.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/enterprise-quote-decision/model";

const m = loadModule("components/features/enterprise-quote-decision/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const SITE = "30000000-0000-4000-8000-000000000001";
const QID = "b1000000-0000-4000-8000-000000000001";
const IID = "c1000000-0000-4000-8000-000000000001";
const APP = "a1000000-0000-4000-8000-000000000001";
const ctxOk = (over: Record<string, unknown> = {}) => ({ quote_id: QID, intervention_id: IID, site_id: SITE, can_write: true, simple_rule: null, simple_approval: null, validity: { valid_until: null, state: "unspecified" }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });

test("lecture stricte du contexte (docs/ENTERPRISE_QUOTE_DECISION_BACKEND.md) ; règle simple : activée ET TTC strictement supérieur ; URL exacte", () => {
  assert.ok(m.parseContext(ctxOk(), QID));
  assert.ok(m.parseContext(ctxOk({ validity: { valid_until: "2026-12-01", state: "valid" } }), QID));
  for (const bad of [{ ...ctxOk(), extra: 1 }, ctxOk({ quote_id: IID }), ctxOk({ validity: { valid_until: null, state: "valid" } }), ctxOk({ validity: { valid_until: "2026-12-01", state: "unspecified" } }), ctxOk({ simple_rule: { enabled: true, threshold_cents: 1, required_role: "viewer" } }), ctxOk({ simple_approval: { id: APP, status: "escalated" } }), ctxOk({ can_write: "yes" }), (({ validity: _v, ...x }) => x)(ctxOk())])
    assert.equal(m.parseContext(bad, QID), null, JSON.stringify(bad).slice(0, 90));
  const rule = (enabled: boolean, threshold: number, approval: string | null) => m.parseContext(ctxOk({ simple_rule: { enabled, threshold_cents: threshold, required_role: "manager" }, simple_approval: approval ? { id: APP, status: approval } : null }), QID)!;
  same([m.simplePending(rule(true, 9765, null), 9765), m.simplePending(rule(true, 9764, null), 9765), m.simplePending(rule(true, 9764, "approved"), 9765), m.simplePending(rule(true, 9764, "pending"), 9765), m.simplePending(rule(false, 0, null), 9765), m.simplePending(m.parseContext(ctxOk(), QID)!, 9765)], [false, true, false, true, false, false], "strictly above; approved lifts it; disabled / proven absence ⇒ not pending");
  same(m.contextUrl(QID, ORG, SITE), `/api/quotes/${QID}/decision-context?organization_id=${ORG}&site_id=${SITE}`);
});

test("contrôleur : 401/403/404 ⇒ inaccessible, 422/503 ⇒ erreur (jamais absence) ; tardive ignorée ; clé au rendu", async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mk = () => {
    const urls: string[] = [];
    const replies: (Model.Result | Promise<Model.Result>)[] = [];
    let s: Model.ContextState = m.CONTEXT_INITIAL;
    const context = { generation: () => 0, userId: () => USER };
    const c = m.createContextController({ api: () => ({ get: async (u) => (urls.push(u), replies.shift() ?? res(503)) }), context, set: (n) => (s = n) });
    return { c, urls, replies, context, s: () => s };
  };
  for (const [st, phase] of [[401, "forbidden"], [403, "forbidden"], [404, "forbidden"], [422, "error"], [503, "error"]] as [number, string][]) {
    const h = mk();
    h.replies.push(res(st));
    h.c.query(QID, ORG, SITE); await tick();
    same([h.s().phase, h.s().data], [phase, null], String(st));
  }
  const l = mk();
  let late!: (r: Model.Result) => void;
  l.replies.push(new Promise((r) => (late = r)), res(200, ctxOk()));
  l.c.query(QID, ORG_B, SITE);
  l.c.query(QID, ORG, SITE); await tick();
  late(res(200, ctxOk({ can_write: false }))); await tick();
  same(l.s().data?.can_write, true, "late reply of the previous organization dropped");
  const k = m.contextKey(l.context, QID, ORG, SITE);
  const st = { ...m.CONTEXT_INITIAL, key: k, phase: "ready" as const, data: m.parseContext(ctxOk(), QID) };
  for (const other of [m.contextKey(l.context, QID, ORG_B, SITE), m.contextKey(l.context, QID, ORG, null), m.contextKey({ generation: () => 1, userId: () => USER }, QID, ORG, SITE)])
    same([m.contextView(st, other).phase, m.contextView(st, other).data], ["loading", null]);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnterpriseQuoteView } from "./components/role/enterprise-space";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = "${USER}", ORG = "${ORG}", ORG_B = "${ORG_B}", SITE = "${SITE}", QID = "${QID}", IID = "${IID}", APP = "${APP}";
const quote = (over = {}) => ({ id: QID, intervention_id: IID, artisan_id: USER, lines: [{ label: "Remplacement disjoncteur", quantity: 1, unit_price_cents: 9000 }], subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "sent", created_at: "2026-01-01T10:00:00Z", accepted_at: null, ...over });
const point = (q = {}, iv = {}, ver = { current_quote_id: QID, is_current: true }) => ({ quote: quote(q), intervention: { id: IID, category: "panel", status: "quoted", site_id: SITE, ...iv }, version: ver });
const ctxOk = (over = {}) => ({ quote_id: QID, intervention_id: IID, site_id: SITE, can_write: true, simple_rule: null, simple_approval: null, validity: { valid_until: null, state: "unspecified" }, ...over });
const wf = (over = {}) => ({ quote_id: QID, site_id: SITE, required: false, approved_current: false, policy: null, workflow: null, permissions: { can_submit: false, can_decide: false, can_respond: false }, events: [], next_after: null, ...over });
const run = async (opts) => {
  const calls = [], log = [];
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes(ORG_B)) await tick(300); // the new scope's reads are still in flight
    if (u.includes("/decision-context")) { if (opts.ctxHold) await opts.ctxHold; return typeof opts.ctx === "number" ? Response.json({ error: "x" }, { status: opts.ctx }) : Response.json(opts.ctx ?? ctxOk()); }
    if (u.includes("/approval")) return typeof opts.wf === "number" ? Response.json({ error: "x" }, { status: opts.wf }) : Response.json(opts.wf ?? wf());
    if (u.startsWith("/api/quotes/")) return typeof opts.point === "number" ? Response.json({ error: "x" }, { status: opts.point }) : Response.json(opts.point ?? point());
    return Response.json({ error: "x" }, { status: 503 });
  };
  const session = {
    mode: "live", role: "manager", profileId: USER, busy: false, displayName: "Moi",
    mutationContext: { userId: () => opts.uid ?? USER, generation: () => 0 },
    data: { quotes: [], interventions: [], documents: [], messages: [], payments: [], reviews: [], organization_members: [] },
    capabilities: { quoteDocuments: "available" }, reprobeFeature: async () => {},
    features: { quoteDocuments: new Proxy({}, { get: () => () => new Promise(() => {}) }) },
    go: () => {}, openIntervention: () => {}, loadOrganization: async () => null,
    action: async (id, a, b) => { log.push(["action", a, b.quote_id, id]); return true; },
    operate: async (id, b) => { log.push(["operate", b.action, b.quote_id, id]); return true; },
  };
  const c = { session, demo: false, organization: { id: opts.org ?? ORG, name: "Org" }, activeSite: { id: SITE, name: "Siège" }, orgSites: [], orgInterventions: [], scope: { sites: [], rules: [] }, authority: { role: "owner", canWrite: true, readOnlyReason: null, canWriteSite: () => opts.authority !== false }, go: () => {} };
  const div = document.createElement("div"); div.className = "ui-v2"; document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(EnterpriseQuoteView, { c, quoteId: QID })));
  await tick(500);
  const out = { decision: !!div.querySelector("[data-enterprise-quote-decision]"), blocked: div.querySelector("[data-enterprise-quote-readonly]")?.textContent ?? null, log, calls };
  if (opts.act === "accept" && out.decision) {
    const before = calls.length;
    const acceptBtn = [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Accepter le devis"));
    acceptBtn.focus(); out.focused = document.activeElement === acceptBtn;
    acceptBtn.click(); await tick(50);
    const confirm = [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Confirmer l’acceptation"));
    confirm.click(); await tick(400);
    out.after = calls.slice(before).map((u) => (u.includes("/decision-context") ? "context" : u.includes("/approval") ? "approval" : u.startsWith("/api/quotes/") ? "quote" : "other"));
  }
  if (opts.act === "reject" && out.decision) {
    [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Refuser ce devis")).click(); await tick(50);
    const ta = div.querySelector("[data-enterprise-quote-reject] textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "Montant trop élevé");
    ta.dispatchEvent(new Event("input", { bubbles: true })); await tick(30);
    const before = calls.length;
    div.querySelector("[data-enterprise-quote-reject]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(400);
    out.after = calls.slice(before).map((u) => (u.includes("/decision-context") ? "context" : u.includes("/approval") ? "approval" : u.startsWith("/api/quotes/") ? "quote" : "other"));
  }
  if (opts.switchOrg) {
    root.render(h(StrictMode, null, h(EnterpriseQuoteView, { c: { ...c, organization: { id: ORG_B, name: "B" } }, quoteId: QID })));
    await tick(30);
    out.afterSwitch = { decision: !!div.querySelector("[data-enterprise-quote-decision]"), ready: !!div.querySelector("[data-enterprise-quote='ready']") };
  }
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  root.unmount();
  return out;
};
window.all = async () => {
  const r = {};
  r.allProven = await run({ act: "accept" });
  r.reject = await run({ act: "reject" });
  r.notSent = await run({ point: point({ status: "accepted" }) });
  r.notCurrent = await run({ point: point({ status: "rejected" }, {}, { current_quote_id: "b1000000-0000-4000-8000-000000000002", is_current: false }) });
  r.dossierNotQuoted = await run({ point: point({}, { status: "accepted" }) });
  r.noWrite = await run({ ctx: ctxOk({ can_write: false }) });
  r.authority = await run({ authority: false });
  r.ctxOtherSite = await run({ ctx: ctxOk({ site_id: "30000000-0000-4000-8000-000000000009" }) });
  r.simplePending = await run({ ctx: ctxOk({ simple_rule: { enabled: true, threshold_cents: 5000, required_role: "manager" }, simple_approval: { id: APP, status: "pending" } }) });
  r.simpleApproved = await run({ ctx: ctxOk({ simple_rule: { enabled: true, threshold_cents: 5000, required_role: "manager" }, simple_approval: { id: APP, status: "approved" } }) });
  r.simpleBelow = await run({ ctx: ctxOk({ simple_rule: { enabled: true, threshold_cents: 9765, required_role: "manager" }, simple_approval: null }) });
  r.expired = await run({ ctx: ctxOk({ validity: { valid_until: "2026-01-02", state: "expired" } }) });
  r.advancedPending = await run({ wf: wf({ required: true, approved_current: false, policy: { version: 1, enabled: true, threshold_cents: 0, steps: [{ role: "owner" }] } }) });
  r.advancedUnread = await run({ wf: 503 });
  for (const st of [401, 403, 404, 422, 503]) r["ctx" + st] = await run({ ctx: st });
  let release;
  r.switchMidRead = await run({ ctxHold: new Promise((x) => (release = x)), switchOrg: true });
  release();
  return r;
};
`;
for (const width of [390, 1280])
  test(`décision sur devis entreprise exact (Chromium ${width} px) : toutes les preuves ⇒ accepter / refuser ids exacts + relecture ; chaque preuve manquante ⇒ aucune action ; erreurs ; périmètre`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
        const r = (await page.evaluate(() => (window as unknown as { all: () => Promise<unknown> }).all())) as Record<string, any>;
        same([r.allProven.decision, r.allProven.focused, r.allProven.log], [true, true, [["action", "accept_quote", QID, IID]]], "all proven ⇒ accept with the exact ids (keyboard focusable)");
        for (const k of ["quote", "context", "approval"]) assert.ok(r.allProven.after.includes(k), `accept ⇒ re-read ${k}: ${JSON.stringify(r.allProven.after)}`);
        same(r.reject.log, [["operate", "reject_quote", QID, IID]], "refuse with the exact ids");
        for (const k of ["quote", "context", "approval"]) assert.ok(r.reject.after.includes(k), `refuse ⇒ re-read ${k}`);
        for (const k of ["notSent", "notCurrent", "dossierNotQuoted", "noWrite", "authority", "ctxOtherSite", "simplePending", "expired", "advancedPending", "advancedUnread", "ctx401", "ctx403", "ctx404", "ctx422", "ctx503"])
          same([r[k].decision, r[k].log], [false, []], `${k}: missing proof ⇒ no action`);
        same([r.simpleApproved.decision, r.simpleBelow.decision], [true, true], "simple rule approved / total not above the threshold ⇒ decidable");
        assert.match(r.expired.blocked, /expiré/);
        assert.match(r.advancedPending.blocked, /circuit d’approbation interne/);
        assert.match(r.simplePending.blocked, /approuvé dans « Devis & approbations »/);
        assert.match(r.notCurrent.blocked, /lecture seule/);
        assert.match(r.ctx503.blocked, /n’ont pas pu être vérifiées/);
        assert.match(r.ctx403.blocked, /pas accessibles/);
        same(r.switchMidRead.afterSwitch, { decision: false, ready: false }, "scope switch mid-read ⇒ no old frame, no action");
        assert.ok(r.allProven.overflow <= 0);
        same(errors, []);
      } finally {
        await context.close();
      }
    } finally {
      await browser?.close();
      server.close();
    }
  });

test("câblage : gardes existantes réutilisées (acceptanceDecision, QuoteApprovalPanel, ConfirmAction), recontrôle au clic, chemin DossierView en cache inchangé", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  const view = src.slice(src.indexOf("export function EnterpriseQuoteView"), src.indexOf("// ---- Rapports"));
  assert.match(view, /acceptanceDecision\(decisionSimplePending\(ctx!, quote\.total_cents\), advanced, true, true\)/);
  assert.match(view, /<QuoteApprovalPanel/);
  assert.match(view, /<ConfirmAction/);
  assert.match(view, /if \(!proofRef\.current\(\)\) return false; \/\/ re-checked at click time/);
  assert.match(view, /session\.action\(intervention\.id, "accept_quote", \{ quote_id: quote\.id \}\)/);
  assert.match(view, /session\.operate\(intervention\.id, \{ action: "reject_quote", quote_id: quote\.id, reason: reason\.trim\(\) \}\)/);
  assert.match(src, /if \(quote\) return <DossierView key=\{`\$\{quote\.intervention_id\}-\$\{quote\.id\}`\} c=\{c\} id=\{quote\.intervention_id\} initialQuoteId=\{quote\.id\} \/>;/, "cached DossierView path unchanged");
});
