// ENT-12 enterprise approvals from the server. Real model/controllers + Chromium mounts of the REAL
// ApprovalsView and ApprovalDetail (live ctx stub + fake fetch); demo ⇒ 0 fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/enterprise-approvals/model";

const m = loadModule("components/features/enterprise-approvals/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const SITE = "30000000-0000-4000-8000-000000000001";
const A = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const Q = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1) - n * 3_600_000).toISOString();
const row = (n: number, over: Record<string, unknown> = {}, org = ORG) => ({ id: A(n), quote_id: Q(n), site_id: SITE, status: "pending", note: "", decided_by: null, created_at: at(n), decided_at: null, site: { id: SITE, name: "Siège", organization_id: org }, quote: { id: Q(n), intervention_id: I(n), total_cents: 10000 + n, status: "sent" }, intervention: { id: I(n), category: "panel", status: "quoted" }, ...over });
const page = (items: unknown[], next: string | null = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
const res = (status: number, body: unknown = null) => ({ status, body });
const Qy = { org: ORG, site: null, status: "all" as const };

test("lecture stricte (docs/ENTERPRISE_APPROVALS_BACKEND.md) : liste + point ; ordre, périmètre, jointures ; règle null = prouvée ; URL exactes", () => {
  assert.ok(m.parseList(page([row(1), row(2)], "c1"), Qy));
  assert.ok(m.parseList(page([row(1, { status: "approved", decided_by: USER, decided_at: at(0) })]), { ...Qy, status: "approved" }));
  for (const [bad, q] of [
    [{ ...page([row(1)]), extra: 1 }, Qy],
    [{ items: [row(1)], page: { limit: 25, has_more: false, next_cursor: null } }, Qy],
    [{ items: [row(1)], page: { limit: 50, has_more: true, next_cursor: null } }, Qy],
    [page([row(2), row(1)]), Qy],
    [page([row(1), row(1)]), Qy],
    [page([row(1, {}, ORG_B)]), Qy],
    [page([row(1, { site_id: "30000000-0000-4000-8000-000000000009" })]), Qy],
    [page([row(1, { quote: { id: Q(9), intervention_id: I(1), total_cents: 1, status: "sent" } })]), Qy],
    [page([row(1, { intervention: { id: I(9), category: "panel", status: "quoted" } })]), Qy],
    [page([row(1, { status: "approved" })]), { ...Qy, status: "pending" }],
    [page([row(1, { status: "escalated" })]), Qy],
    [page([row(1, { secret: 1 })]), Qy],
    [page([row(1)], "c=1"), Qy],
  ] as [unknown, typeof Qy][])
    assert.equal(m.parseList(bad, q), null, JSON.stringify(bad).slice(0, 90));
  assert.ok(m.parseList(page([row(3)]), Qy, row(2) as Model.ApprovalRow), "next page continues after the last row");
  assert.equal(m.parseList(page([row(1)]), Qy, row(2) as Model.ApprovalRow), null, "a next page never goes back in time");
  const pq = { id: A(7), org: ORG, site: null };
  same(m.parsePoint({ approval: row(7), rule: null }, pq)?.rule, null, "rule null parsed: no rule, proven");
  assert.ok(m.parsePoint({ approval: row(7), rule: { enabled: true, required_role: "owner", threshold_cents: 50000 } }, pq));
  for (const bad of [{ approval: row(8), rule: null }, { approval: row(7, {}, ORG_B), rule: null }, { approval: row(7) }, { approval: row(7), rule: { enabled: true, required_role: "viewer", threshold_cents: 1 } }, { approval: row(7), rule: null, extra: 1 }])
    assert.equal(m.parsePoint(bad, pq), null, JSON.stringify(bad).slice(0, 80));
  same([m.listUrl(ORG, null, "all", null), m.listUrl(ORG, SITE, "pending", "c1"), m.pointUrl(A(7), ORG, SITE)], [`/api/enterprise/approvals?organization_id=${ORG}`, `/api/enterprise/approvals?organization_id=${ORG}&site_id=${SITE}&status=pending&cursor=c1`, `/api/enterprise/approvals/${A(7)}?organization_id=${ORG}&site_id=${SITE}`]);
});

const tick = () => new Promise((r) => setTimeout(r, 0));
function ctl() {
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const urls: string[] = [];
  const replies: (Model.Result | Promise<Model.Result>)[] = [];
  let s: Model.ListState = m.LIST_INITIAL, p: Model.PointState = m.POINT_INITIAL;
  const api = () => ({ get: async (u: string) => (urls.push(u), replies.shift() ?? res(503)) });
  return { context, urls, replies, list: m.createListController({ api, context, set: (n) => (s = n) }), point: m.createPointController({ api, context, set: (n) => (p = n) }), s: () => s, p: () => p };
}

test("contrôleurs : filtre ⇒ page 1 ; plus dédupliqué ; tardive ignorée ; 401/403/404 (page 1 ou suite) ⇒ effacé + inaccessible ; 422 ⇒ page 1 ; 503 + réessai ; point rafraîchi", async () => {
  const h = ctl();
  h.replies.push(res(200, page([row(1), row(2)], "c1")), res(200, page([row(2), row(3)])));
  h.list.query(ORG, null, "all"); await tick();
  await h.list.more(h.s().key);
  same(h.s().items.map((x) => x.id), [A(1), A(2), A(3)]);
  let late!: (r: Model.Result) => void;
  h.replies.push(new Promise((r) => (late = r)), res(200, page([row(5)])));
  h.list.query(ORG_B, null, "all");
  h.list.query(ORG, null, "pending"); await tick();
  late(res(200, page([row(9, {}, ORG_B)]))); await tick();
  same([h.s().items.map((x) => x.id), h.urls[h.urls.length - 1]], [[A(5)], `/api/enterprise/approvals?organization_id=${ORG}&status=pending`], "late reply of org B dropped; filter ⇒ page 1");
  for (const st of [401, 403, 404]) {
    const a = ctl();
    a.replies.push(res(200, page([row(1)], "c1")), res(st));
    a.list.query(ORG, null, "all"); await tick();
    await a.list.more(a.s().key);
    same([a.s().phase, a.s().items, a.s().next], ["forbidden", [], null], `next page ${st}`);
  }
  const r = ctl();
  r.replies.push(res(200, page([row(1)], "c1")), res(422), res(200, page([row(4)])));
  r.list.query(ORG, null, "all"); await tick();
  await r.list.more(r.s().key); await tick();
  same(r.s().items.map((x) => x.id), [A(4)], "422 ⇒ page 1");
  const e = ctl();
  e.replies.push(res(503), res(200, page([])));
  e.list.query(ORG, null, "all"); await tick();
  same(e.s().phase, "error");
  e.list.retry(e.s().key); await tick();
  same([e.s().phase, e.s().items], ["ready", []]);
  const p = ctl();
  p.replies.push(res(200, { approval: row(7), rule: null }), res(200, { approval: row(7, { status: "approved", decided_by: USER, decided_at: at(0) }), rule: null }));
  p.point.query(A(7), ORG, null); await tick();
  same([p.p().phase, p.p().data?.approval.status], ["ready", "pending"]);
  p.point.refresh(p.p().key); await tick();
  same([p.urls.length, p.p().data?.approval.status], [2, "approved"], "refresh after a decision re-reads the server");
  const f = ctl();
  f.replies.push(res(404));
  f.point.query(A(7), ORG, null); await tick();
  same([f.p().phase, f.p().data], ["forbidden", null]);
  const k = m.listKey(h.context, ORG, null, "all");
  const st = { ...m.LIST_INITIAL, key: k, phase: "ready" as const, items: [row(1) as Model.ApprovalRow] };
  for (const other of [m.listKey(h.context, ORG_B, null, "all"), m.listKey(h.context, ORG, SITE, "all"), m.listKey(h.context, ORG, null, "pending"), m.listKey({ generation: () => 1, userId: () => USER }, ORG, null, "all")])
    same([m.listView(st, other).phase, m.listView(st, other).items], ["loading", []], "another identity / org / site / filter ⇒ never the old rows");
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalsView, ApprovalDetail } from "./components/role/enterprise-space";
import { useApprovalsList } from "./components/features/enterprise-approvals/use-enterprise-approvals";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const ORG = "${ORG}", ORG_B = "${ORG_B}", SITE = "${SITE}", USER = "${USER}";
const A = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const Q = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const I = (n) => "c0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const at = (n) => new Date(Date.UTC(2026, 9, 1) - n * 3600000).toISOString();
const row = (n, over = {}, org = ORG) => ({ id: A(n), quote_id: Q(n), site_id: SITE, status: n % 3 === 0 ? "pending" : "approved", note: "", decided_by: n % 3 === 0 ? null : USER, created_at: at(n), decided_at: n % 3 === 0 ? null : at(n - 0.5), site: { id: SITE, name: "Siège", organization_id: org }, quote: { id: Q(n), intervention_id: I(n), total_cents: 10000 + n, status: "sent" }, intervention: { id: I(n), category: "panel", status: "quoted" }, ...over });
const page = (items, next = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
// 250 approvals (> the 200-row cache); the oldest one (#249, pending) is only on page 5.
const all = Array.from({ length: 250 }, (_, i) => row(i + 1));
const ctxOf = (opts, gone) => ({
  session: { mode: opts.demo ? "demo" : "live", mutationContext: { userId: () => USER, generation: () => 0 }, data: { quotes: [], documents: [], organization_members: [], interventions: [] }, professional: { approvals: [], approval_rules: [], audit: [] }, profileId: USER, displayName: "Moi", busy: false, openIntervention: (id, q) => gone.push(["open", id, q]), professionalCommand: async (b) => { gone.push(["decide", b.approval_id, b.decision]); decided = true; return true; }, capabilities: {}, features: {} },
  demo: !!opts.demo, organization: opts.noOrg ? null : { id: opts.org ?? ORG, name: "Org" }, activeSite: null, orgSites: [], orgInterventions: [],
  scope: { sites: [], interventions: [], quotes: [], payments: [], approvals: opts.demo ? [{ id: "d1", quote_id: "q1", status: "pending", created_at: "2026-01-01T00:00:00Z" }] : [], compliance: [], documents: [], rules: [] },
  authority: { role: "owner", canWrite: true, readOnlyReason: null, canWriteSite: () => true }, go: (v, p) => gone.push([v, p]),
});
let decided = false;
const fetchMock = (calls, opts = {}) => async (url) => {
  const u = String(url); calls.push(u);
  const q = new URL(u, "http://x").searchParams;
  if (u.startsWith("/api/enterprise/approvals/")) {
    if (opts.point404) return Response.json({ error: "x" }, { status: 404 });
    const id = u.split("/")[4].split("?")[0];
    const n = Number(id.slice(-12));
    return Response.json({ approval: decided ? row(n, { status: "approved", decided_by: USER, decided_at: at(0) }) : row(n, { status: "pending", decided_by: null, decided_at: null }), rule: null });
  }
  if (u.startsWith("/api/enterprise/approvals")) {
    if (opts.list503) return Response.json({ error: "x" }, { status: 503 });
    const status = q.get("status") ?? "all";
    const rows = all.filter((r) => status === "all" || r.status === status);
    const start = q.get("cursor") ? Number(q.get("cursor").slice(1)) : 0;
    const slice = rows.slice(start, start + 50);
    return Response.json(page(slice, start + 50 < rows.length ? "p" + (start + 50) : null));
  }
  return Response.json({ error: "x" }, { status: 503 });
};
window.run = async () => {
  const out = {};
  // List: 5 pages, the oldest pending approval is reachable and opens its exact approval.
  let calls = [], gone = [];
  window.fetch = fetchMock(calls);
  let div = document.createElement("div"); document.body.appendChild(div);
  let root = createRoot(div);
  root.render(h(StrictMode, null, h(ApprovalsView, { c: ctxOf({}, gone) })));
  await tick(300);
  out.first = div.querySelectorAll("[data-approval]").length;
  for (let i = 0; i < 4; i++) { div.querySelector("[data-approvals-more]").click(); await tick(150); }
  out.all = div.querySelectorAll("[data-approval]").length;
  out.oldPending = !!div.querySelector("[data-approval='" + A(249) + "']");
  out.moreLeft = !!div.querySelector("[data-approvals-more]");
  div.querySelector("[data-approval='" + A(249) + "']").click();
  out.opened = gone.slice(-1)[0];
  [...div.querySelectorAll("[aria-label='Filtrer les approbations'] button")].find((b) => b.textContent === "En attente").click(); await tick(300);
  out.pendingCall = calls[calls.length - 1];
  out.pendingRows = [...div.querySelectorAll("[data-approval]")].length;
  root.unmount();
  // Detail of the old approval: exact dossier, « aucune règle » proven, decision ⇒ server refresh.
  decided = false; calls = []; gone = [];
  window.fetch = fetchMock(calls);
  div = document.createElement("div"); document.body.appendChild(div);
  root = createRoot(div);
  root.render(h(StrictMode, null, h(ApprovalDetail, { c: ctxOf({}, gone), id: A(249) })));
  await tick(400);
  out.dossierButton = div.querySelector("[data-approval-open-dossier]")?.getAttribute("data-approval-open-dossier");
  out.rule = div.querySelector("[data-approval-rule]")?.textContent;
  div.querySelector("[data-approval-open-dossier]").click();
  out.openDossier = gone.find((g) => g[0] === "open");
  [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Approuver")).click(); await tick(50);
  const pointsBefore = calls.filter((u) => u.includes("/approvals/")).length;
  div.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(400);
  out.decided = gone.find((g) => g[0] === "decide");
  out.pointsAfter = calls.filter((u) => u.includes("/approvals/")).length - pointsBefore;
  out.afterText = div.textContent.includes("Décision enregistrée");
  root.unmount();
  // Errors.
  for (const [name, opts, el] of [["list503", { list503: true }, "list"], ["point404", { point404: true }, "point"]]) {
    calls = []; gone = [];
    window.fetch = fetchMock(calls, opts);
    div = document.createElement("div"); document.body.appendChild(div);
    root = createRoot(div);
    root.render(h(StrictMode, null, el === "list" ? h(ApprovalsView, { c: ctxOf({}, gone) }) : h(ApprovalDetail, { c: ctxOf({}, gone), id: A(3) })));
    await tick(300);
    out[name] = { text: div.textContent, retry: [...div.querySelectorAll("button")].some((b) => b.textContent === "Réessayer"), inaccessible: !!div.querySelector("[data-approval-inaccessible]") };
    root.unmount();
  }
  // Org switch: the first render after the change never shows the old rows (real hook).
  calls = [];
  window.fetch = async (url) => { const u = String(url); calls.push(u); await tick(u.includes(ORG_B) ? 60 : 10); return Response.json(page(u.includes(ORG_B) ? [row(1, {}, ORG_B)] : [row(2)])); };
  const frames = [];
  const c2 = { userId: () => USER, generation: () => 0 };
  function Probe({ org }) { const r = useApprovalsList({ enabled: true, context: c2, organizationId: org, siteId: null, status: "all" }); frames.push({ org, phase: r.state.phase, ids: r.state.items.map((x) => x.id) }); return null; }
  div = document.createElement("div"); document.body.appendChild(div);
  root = createRoot(div);
  root.render(h(StrictMode, null, h(Probe, { org: ORG }))); await tick(200);
  const mark = frames.length; root.render(h(StrictMode, null, h(Probe, { org: ORG_B }))); await tick(300);
  out.afterOrg = frames.slice(mark);
  root.unmount();
  // Demo ⇒ zero fetch, local list unchanged.
  calls = [];
  window.fetch = fetchMock(calls);
  div = document.createElement("div"); document.body.appendChild(div);
  root = createRoot(div);
  root.render(h(StrictMode, null, h(ApprovalsView, { c: ctxOf({ demo: true }, []) })));
  await tick(300);
  out.demo = { calls: calls.length, text: div.textContent.includes("1 au total") };
  root.unmount();
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return out;
};
`;
for (const width of [390, 1280])
  test(`approbations réelles (Chromium ${width} px) : > 200 ⇒ ancienne en attente par pagination, ouverture exacte, filtre, détail exact + « aucune règle » prouvée, décision ⇒ relecture, erreurs, changement d’organisation sans ancien cadre, démo 0 appel`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
        same([r.first, r.all, r.oldPending, r.moreLeft], [50, 250, true, false], "250 approvals over 5 pages; the old pending one is reachable");
        same(r.opened, ["approval", A(249)], "opens its exact approval");
        assert.ok(r.pendingCall.endsWith("&status=pending") && !r.pendingCall.includes("cursor"), r.pendingCall);
        same(r.pendingRows, 50);
        same(r.dossierButton, I(249), "exact dossier of the approval");
        same(r.openDossier, ["open", I(249), Q(249)]);
        assert.match(r.rule, /Aucune règle d’approbation pour ce site \(vérifié par le serveur\)/);
        same(r.decided, ["decide", A(249), "approved"]);
        same([r.pointsAfter, r.afterText], [1, true], "decision ⇒ one server re-read, decided state shown");
        same([r.list503.retry, r.list503.text.includes("n’ont pas pu être lues")], [true, true]);
        same([r.point404.inaccessible, r.point404.text.includes("introuvable ou inaccessible")], [true, true]);
        same([r.afterOrg[0].phase, r.afterOrg[0].ids], ["loading", []], "first render after an org switch shows no old row");
        same(r.afterOrg[r.afterOrg.length - 1].ids, [A(1)]);
        same(r.demo, { calls: 0, text: true }, "demo unchanged, zero fetch");
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
