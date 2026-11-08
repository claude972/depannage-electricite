// CLI-08 / ENT-12 recipient quotes. Real model/controllers + Chromium mounts of the REAL client
// QuoteView / DocumentsView and the enterprise EnterpriseQuoteView (live stubs + fake fetch); demo ⇒ 0 fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/recipient-quotes/model";

const m = loadModule("components/features/recipient-quotes/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const SITE = "30000000-0000-4000-8000-000000000001";
const Q = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1) - n * 3_600_000).toISOString();
const item = (n: number, over: Record<string, unknown> = {}) => ({ id: Q(n), intervention_id: I(n), total_cents: 10000 + n, status: "accepted", created_at: at(n), intervention: { id: I(n), category: "panel", status: "completed", site_id: null }, ...over });
const quote = (n: number, over: Record<string, unknown> = {}) => ({ id: Q(n), intervention_id: I(n), artisan_id: USER, lines: [{ label: "Remplacement disjoncteur", quantity: 1, unit_price_cents: 9000 }], subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "rejected", created_at: at(n), accepted_at: null, ...over });
const detail = (n: number, over: Record<string, unknown> = {}, current: string | null = Q(1)) => ({ quote: quote(n, over), intervention: { id: I(n), category: "panel", status: "quoted", site_id: SITE }, version: { current_quote_id: current, is_current: current === Q(n) } });
const page = (items: unknown[], next: string | null = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
const res = (status: number, body: unknown = null) => ({ status, body });

test("lecture stricte (docs/RECIPIENT_QUOTES_BACKEND.md) : liste + détail exact ; ordre µs ; is_current cohérent ; URL exactes", () => {
  assert.ok(m.parseList(page([item(1), item(2)], "c1"), "all"));
  for (const [bad, st] of [
    [{ ...page([item(1)]), extra: 1 }, "all"],
    [{ items: [item(1)], page: { limit: 50, has_more: true, next_cursor: null } }, "all"],
    [page([item(2), item(1)]), "all"],
    [page([item(1), item(1)]), "all"],
    [page([item(1, { status: "draft" })]), "all"],
    [page([item(1, { status: "sent" })]), "accepted"],
    [page([item(1, { intervention: { id: I(9), category: "panel", status: "completed", site_id: null } })]), "all"],
    [page([item(1, { address: "x" })]), "all"],
    [page([item(1)], "c=1"), "all"],
    [page([item(1)], "c".repeat(601)), "all"],
  ] as [unknown, Model.QuoteFilter][])
    assert.equal(m.parseList(bad, st), null, JSON.stringify(bad).slice(0, 90));
  assert.ok(m.parseDetail(detail(300), Q(300)));
  assert.ok(m.parseDetail(detail(1, { status: "sent" }), Q(1)), "current version");
  for (const bad of [detail(301), { ...detail(300), extra: 1 }, { ...detail(300), version: { current_quote_id: Q(1), is_current: true } }, detail(300, { tax_rate: 7 }), detail(300, { lines: [] }), detail(300, { total_cents: -1 }), detail(300, { status: "sent" }), detail(300, { total_cents: 9766 }), detail(300, { artisan_id: null }), detail(300, { lines: [{ label: "x", quantity: 1.5, unit_price_cents: 9000 }] }), detail(300, { lines: Array.from({ length: 31 }, () => ({ label: "x", quantity: 1, unit_price_cents: 0 })), subtotal_cents: 0, tax_cents: 0, total_cents: 0 }), { quote: quote(300), intervention: { id: I(9), category: "panel", status: "quoted", site_id: null }, version: { current_quote_id: null, is_current: false } }])
    assert.equal(m.parseDetail(bad, Q(300)), null, JSON.stringify(bad).slice(0, 90));
  same([m.listUrl("all", null), m.listUrl("sent", "c1"), m.detailUrl(Q(3), null), m.detailUrl(Q(3), { org: ORG, site: SITE }), m.detailUrl(Q(3), { org: ORG, site: null })], ["/api/quotes", "/api/quotes?status=sent&cursor=c1", `/api/quotes/${Q(3)}`, `/api/quotes/${Q(3)}?organization_id=${ORG}&site_id=${SITE}`, `/api/quotes/${Q(3)}?organization_id=${ORG}`]);
});

const tick = () => new Promise((r) => setTimeout(r, 0));
function ctl() {
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const urls: string[] = [];
  const replies: (Model.Result | Promise<Model.Result>)[] = [];
  let s: Model.ListState = m.LIST_INITIAL, d: Model.DetailState = m.DETAIL_INITIAL;
  const api = () => ({ get: async (u: string) => (urls.push(u), replies.shift() ?? res(503)) });
  return { context, urls, replies, list: m.createListController({ api, context, set: (n) => (s = n) }), detail: m.createDetailController({ api, context, set: (n) => (d = n) }), s: () => s, d: () => d };
}
test("contrôleurs : filtre ⇒ page 1 ; plus dédupliqué ; 401/403/404 ⇒ effacé (404 distingué) ; 422 ⇒ page 1 ; 503 + réessai ; tardive ignorée ; clés au rendu", async () => {
  const h = ctl();
  h.replies.push(res(200, page([item(1), item(2)], "c1")), res(200, page([item(2), item(3)])));
  h.list.query("all"); await tick();
  await h.list.more(h.s().key);
  same(h.s().items.map((x) => x.id), [Q(1), Q(2), Q(3)]);
  h.replies.push(res(200, page([item(4, { status: "sent" })])));
  h.list.query("sent"); await tick();
  same([h.urls[h.urls.length - 1], h.s().items.map((x) => x.id)], ["/api/quotes?status=sent", [Q(4)]]);
  for (const st of [401, 403, 404]) {
    const a = ctl();
    a.replies.push(res(200, page([item(1)], "c1")), res(st));
    a.list.query("all"); await tick();
    await a.list.more(a.s().key);
    same([a.s().phase, a.s().items, a.s().next], ["forbidden", [], null], `next page ${st}`);
    const b = ctl();
    b.replies.push(res(st));
    b.detail.query(Q(1), null); await tick();
    same([b.d().phase, b.d().data, b.d().notFound], ["forbidden", null, st === 404], `detail ${st}`);
  }
  const r = ctl();
  r.replies.push(res(200, page([item(1)], "c1")), res(422), res(200, page([item(5)])));
  r.list.query("all"); await tick();
  await r.list.more(r.s().key); await tick();
  same(r.s().items.map((x) => x.id), [Q(5)], "422 ⇒ page 1");
  const e = ctl();
  e.replies.push(res(503), res(200, detail(300)));
  e.detail.query(Q(300), { org: ORG, site: SITE }); await tick();
  same(e.d().phase, "error");
  e.detail.retry(e.d().key); await tick();
  same([e.d().phase, e.urls[1]], ["ready", `/api/quotes/${Q(300)}?organization_id=${ORG}&site_id=${SITE}`]);
  let late!: (x: Model.Result) => void;
  const l = ctl();
  l.replies.push(new Promise((x) => (late = x)), res(200, detail(7, {}, null)));
  l.detail.query(Q(300), { org: ORG, site: null });
  l.detail.query(Q(7), { org: ORG, site: null }); await tick();
  late(res(200, detail(300))); await tick();
  same(l.d().data?.quote.id, Q(7), "late reply of the previous quote dropped");
  const k = m.detailKey(l.context, Q(7), { org: ORG, site: null });
  const st = { ...m.DETAIL_INITIAL, key: k, phase: "ready" as const, data: m.parseDetail(detail(7, {}, null), Q(7)) };
  for (const other of [m.detailKey(l.context, Q(7), { org: ORG_B, site: null }), m.detailKey(l.context, Q(7), { org: ORG, site: SITE }), m.detailKey(l.context, Q(8), { org: ORG, site: null }), m.detailKey({ generation: () => 1, userId: () => USER }, Q(7), { org: ORG, site: null })])
    same([m.detailView(st, other).phase, m.detailView(st, other).data], ["loading", null], "another identity / org / site / quote ⇒ never the old frame");
  same(m.detailKey(l.context, Q(7), { org: null, site: null }), "", "manager without organization ⇒ nothing read");
});

test("câblage : is_current jamais une permission ; gardes existantes inchangées ; dispatch entreprise", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  const view = src.slice(src.indexOf("export function QuoteView"), src.indexOf("// ---- Documents"));
  assert.match(view, /session\.role === "client" && point\.state\.phase === "ready" && server\.quote\.id === quoteId && server\.quote\.status === "sent" && !!exactCurrent && server\.intervention\.status === "quoted"/, "every condition required");
  assert.match(view, /\? quoteDecisionState\(server!\.quote, exactCurrent, server!\.intervention\.status\)/, "the existing rule on the exact read");
  assert.doesNotMatch(view, /is_current \?|is_current &&\s*\(?\s*isActive|isActive = .*is_current/, "is_current never enables an action");
  const ent = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(ent, /if \(quote\) return <DossierView key=\{`\$\{quote\.intervention_id\}-\$\{quote\.id\}`\} c=\{c\} id=\{quote\.intervention_id\} initialQuoteId=\{quote\.id\} \/>;/, "cached quote ⇒ that exact version first");
  assert.match(ent, /case "quote":\n\s*return <EnterpriseQuoteRoute /);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QuoteView, DocumentsView } from "./components/role/client-space";
import { EnterpriseQuoteView, EnterpriseQuoteRoute } from "./components/role/enterprise-space";
import { quoteRef } from "./components/app/format";
import { useRecipientQuote } from "./components/features/recipient-quotes/use-recipient-quotes";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = "${USER}", ORG = "${ORG}", ORG_B = "${ORG_B}", SITE = "${SITE}";
const Q = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const I = (n) => "c0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const at = (n) => new Date(Date.UTC(2026, 9, 1) - n * 3600000).toISOString();
const quote = (n, over = {}) => ({ id: Q(n), intervention_id: I(n), artisan_id: USER, lines: [{ label: "Remplacement disjoncteur " + n, quantity: 1, unit_price_cents: 9000 }], subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "rejected", created_at: at(n), accepted_at: null, ...over });
const detail = (n, over = {}, current = Q(1)) => ({ quote: quote(n, over), intervention: { id: I(n), category: "panel", status: "quoted", site_id: SITE }, version: { current_quote_id: current, is_current: current === Q(n) } });
const item = (n) => ({ id: Q(n), intervention_id: I(n), total_cents: 10000 + n, status: n % 2 ? "accepted" : "rejected", created_at: at(n), intervention: { id: I(n), category: "panel", status: "completed", site_id: null } });
const page = (items, next = null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });
const anchor = [];
const sessionOf = (opts, log) => ({
  mode: opts.demo ? "demo" : "live", role: opts.role ?? "client", profileId: USER, busy: false, displayName: "Moi",
  mutationContext: { userId: () => opts.uid ?? USER, generation: () => 0 },
  data: { quotes: opts.cacheQuotes ?? [], interventions: opts.cacheRows ?? [], documents: [], messages: [], payments: [], reviews: [], organization_members: [], sites: [], organizations: [] },
  ensureFresh: async () => ({ kind: "loaded" }), refreshedAt: 0, uploads: [], retryUpload: () => {}, dismissUpload: () => {},
  capabilities: { quoteDocuments: "available", operations: "available" }, reprobeFeature: async () => {},
  features: { quoteDocuments: new Proxy({}, { get: (_t, name) => (...args) => { anchor.push(String(name) + ":" + JSON.stringify(args)); return new Promise(() => {}); } }) },
  loadOperations: async () => null, go: (v, p) => log.push(["go", v, p]), openIntervention: (id, q) => log.push(["open", id, q]),
  action: async (id, a, b) => { log.push(["action", a, b.quote_id, id]); return true; }, operate: async (id, b) => { log.push(["operate", b.action, b.quote_id, id]); return true; }, refresh: async () => {},
  professional: { approvals: [], approval_rules: [], audit: [] }, submitReview: async () => true, checkout: async () => {}, loadOrganization: async () => null,
});
const mount = (el) => { const d = document.createElement("div"); d.className = "ui-v2"; document.body.appendChild(d); const r = createRoot(d); r.render(h(StrictMode, null, el)); return { d, r }; };
const buttons = (d, text) => [...d.querySelectorAll("button")].filter((b) => b.textContent.includes(text)).length;
window.run = async () => {
  const out = {};
  let calls = [];
  const replies = {};
  window.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.startsWith("/api/quotes/")) {
      const id = u.split("/")[3].split("?")[0];
      const r = replies[id];
      if (typeof r === "number") return Response.json({ error: "x" }, { status: r });
      return Response.json(r);
    }
    if (u.startsWith("/api/quotes")) {
      const q = new URL(u, "http://x").searchParams;
      const start = q.get("cursor") ? Number(q.get("cursor").slice(1)) : 0;
      const status = q.get("status");
      const rows = Array.from({ length: 120 }, (_, i) => item(i + 1)).filter((x) => !status || x.status === status);
      return Response.json(page(rows.slice(start, start + 50), start + 50 < rows.length ? "p" + (start + 50) : null));
    }
    return Response.json({ error: "x" }, { status: 503 });
  };
  // 1. Old superseded quote outside the caches (deep link): exact read, read-only, link to the current one.
  let log = [];
  replies[Q(300)] = detail(300);
  let v = mount(h(QuoteView, { session: sessionOf({}, log), rows: [], quoteId: Q(300) }));
  await tick(400);
  out.old = { url: calls.filter((u) => u.startsWith("/api/quotes/"))[0], text: v.d.textContent, accept: buttons(v.d, "Accepter le devis"), refuse: buttons(v.d, "Refuser"), current: v.d.querySelector("[data-quote-current]")?.getAttribute("data-quote-current") ?? null, anchorExact: anchor.some((a) => a.includes(Q(300))) };
  v.r.unmount();
  // 2. Current « sent » quote outside the caches: still no action (the existing guard needs the loaded dossier).
  calls = []; log = [];
  replies[Q(1)] = detail(1, { status: "sent" });
  v = mount(h(QuoteView, { session: sessionOf({}, log), rows: [], quoteId: Q(1) }));
  await tick(400);
  out.currentOutside = { accept: buttons(v.d, "Accepter le devis"), refuse: buttons(v.d, "Refuser"), text: v.d.textContent };
  const exact1 = () => calls.filter((u) => u === "/api/quotes/" + Q(1)).length;
  let n1 = exact1();
  [...v.d.querySelectorAll("button")].find((b) => b.textContent.includes("Accepter le devis")).click(); await tick(300);
  out.currentOutside.accepted = log.find((x) => x[0] === "action");
  out.currentOutside.rereadAccept = exact1() - n1;
  [...v.d.querySelectorAll("button")].find((b) => b.textContent.includes("Refuser")).click(); await tick(50);
  const ta = v.d.querySelector("#reject-quote textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "Trop cher pour cette prestation");
  ta.dispatchEvent(new Event("input", { bubbles: true })); await tick(30);
  n1 = exact1();
  v.d.querySelector("#reject-quote").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(300);
  out.currentOutside.refused = log.find((x) => x[0] === "operate");
  out.currentOutside.rereadRefuse = exact1() - n1;
  v.r.unmount();
  // Error states and a non-client role ⇒ never mutable.
  calls = [];
  replies[Q(1)] = detail(1, { status: "sent" });
  v = mount(h(QuoteView, { session: sessionOf({ role: "manager" }, []), rows: [], quoteId: Q(1) }));
  await tick(300);
  out.nonClient = buttons(v.d, "Accepter le devis");
  v.r.unmount();
  // 3. Loaded active quote: the existing guard still offers « Accepter » ; accepting re-reads the server.
  calls = []; log = [];
  replies[Q(2)] = { quote: quote(2, { status: "sent" }), intervention: { id: I(2), category: "panel", status: "quoted", site_id: null }, version: { current_quote_id: Q(2), is_current: true } };
  const cq = { id: Q(2), intervention_id: I(2), artisan_id: USER, lines: quote(2).lines, subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "sent", created_at: at(2) };
  const ci = { id: I(2), category: "panel", status: "quoted", description: "", address: "x", postal_code: "97200", city: "FDF", urgency: "scheduled", created_at: at(2), estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: USER };
  v = mount(h(QuoteView, { session: sessionOf({ cacheQuotes: [cq], cacheRows: [ci] }, log), rows: [ci], quoteId: Q(2) }));
  await tick(400);
  out.active = { accept: buttons(v.d, "Accepter le devis") };
  const exact2 = () => calls.filter((u) => u === "/api/quotes/" + Q(2)).length;
  const before = exact2();
  out.active.others = [...new Set(calls.filter((u) => u.startsWith("/api/quotes/") && u !== "/api/quotes/" + Q(2)))];
  [...v.d.querySelectorAll("button")].find((b) => b.textContent.includes("Accepter le devis")).click(); await tick(400);
  out.active.action = log.find((x) => x[0] === "action");
  out.active.reread = exact2() - before;
  v.r.unmount();
  // 4. Errors.
  for (const [name, code] of [["e503", 503], ["e404", 404]]) {
    calls = [];
    replies[Q(9)] = code;
    v = mount(h(QuoteView, { session: sessionOf({}, []), rows: [], quoteId: Q(9) }));
    await tick(300);
    out[name] = { retry: buttons(v.d, "Réessayer"), text: v.d.textContent, accept: buttons(v.d, "Accepter le devis") + buttons(v.d, "Refuser") };
    v.r.unmount();
  }
  // 5. Client quotes list: 120 quotes over 3 pages (> the loaded window), filter ⇒ page 1.
  calls = []; log = [];
  v = mount(h(DocumentsView, { session: sessionOf({}, log), rows: [] }));
  await tick(400);
  out.list = { first: v.d.querySelectorAll("[data-client-quote]").length };
  for (let i = 0; i < 2; i++) { v.d.querySelector("[data-client-quotes-more]").click(); await tick(200); }
  out.list.all = v.d.querySelectorAll("[data-client-quote]").length;
  out.list.oldest = !!v.d.querySelector("[data-client-quote='" + Q(120) + "']");
  [...v.d.querySelectorAll("[aria-label='Filtrer les devis'] button")].find((b) => b.textContent === "Refusés").click(); await tick(300);
  out.list.filterCall = calls.filter((u) => u.startsWith("/api/quotes?") || u === "/api/quotes").slice(-1)[0];
  [...v.d.querySelectorAll("[data-client-quote] button")].find((b) => b.textContent === "Voir le devis").click();
  out.list.go = log.slice(-1)[0];
  v.r.unmount();
  // 6. Enterprise exact quote: organization + site sent; superseded read-only; no decision here.
  calls = []; anchor.length = 0;
  replies[Q(300)] = detail(300);
  const c = { session: sessionOf({ role: "manager" }, []), demo: false, organization: { id: ORG, name: "Org" }, activeSite: { id: SITE, name: "Siège" }, orgSites: [], orgInterventions: [], scope: { sites: [] }, authority: { canWrite: true, readOnlyReason: null, canWriteSite: () => true }, go: () => {} };
  v = mount(h(EnterpriseQuoteView, { c, quoteId: Q(300) }));
  await tick(400);
  out.ent = { url: calls.find((u) => u.startsWith("/api/quotes/")), superseded: !!v.d.querySelector("[data-enterprise-quote-superseded]"), total: v.d.querySelector("[data-enterprise-quote-total]")?.textContent, accept: buttons(v.d, "Accepter") + buttons(v.d, "Approuver"), anchorExact: anchor.some((a) => a.includes(Q(300))) };
  v.r.unmount();
  // 6b. Enterprise #quote/<id>: a cached OLD version is shown exactly on the first render (no
  // selectedQuoteId), read-only; a dossier id answers 404 on the quote read ⇒ the dossier, as before;
  // a 403 ⇒ inaccessible, never another quote.
  const OLDID = "e1a00000-0000-4000-8000-000000000010", CURID = "f2b00000-0000-4000-8000-000000000011";
  const oldQ = { id: OLDID, intervention_id: I(10), artisan_id: USER, lines: quote(10).lines, subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "rejected", created_at: at(20) };
  const curQ = { ...oldQ, id: CURID, status: "sent", created_at: at(5) };
  const dossier = { id: I(10), site_id: SITE, category: "panel", status: "quoted", description: "Tableau", address: "x", postal_code: "97200", city: "FDF", urgency: "scheduled", created_at: at(30), estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: USER };
  const entCtx = (extra = {}) => ({ ...c, session: { ...sessionOf({ role: "manager", cacheQuotes: [oldQ, curQ], cacheRows: [dossier] }, []), selectedQuoteId: "", ...extra }, orgInterventions: [dossier], orgSites: [{ id: SITE, name: "Siège", organization_id: ORG }], scope: { sites: [{ id: SITE, name: "Siège", organization_id: ORG }], interventions: [dossier], quotes: [oldQ, curQ], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, authority: { role: "owner", canWrite: true, readOnlyReason: null, canWriteSite: () => true } });
  calls = [];
  const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message) + " @ " + String(e.error && e.error.stack).slice(0, 400)));
  v = mount(h(EnterpriseQuoteRoute, { c: entCtx(), ref_: OLDID }));
  await tick(400);
  out.entOld = { errs, text: v.d.textContent, ref: quoteRef(OLDID), curRef: quoteRef(CURID), decide: buttons(v.d, "Accepter") + buttons(v.d, "Refuser ce devis"), quoteCalls: calls.filter((u) => u.startsWith("/api/quotes/") && !u.slice(12).split("?")[0].includes("/")).length };
  v.r.unmount();
  for (const [name, code] of [["ent404", 404], ["ent403", 403]]) {
    calls = [];
    replies[I(99)] = code;
    v = mount(h(EnterpriseQuoteRoute, { c: entCtx(), ref_: I(99) }));
    await tick(400);
    out[name] = { inaccessible: !!v.d.querySelector("[data-enterprise-quote-inaccessible]"), quoteView: !!v.d.querySelector("[data-enterprise-quote='ready']"), text: v.d.textContent, called: [...new Set(calls.filter((u) => u.startsWith("/api/quotes/")))] };
    v.r.unmount();
  }
  // 7. Identity / organization / site switch: the first render after the change never shows the old quote.
  window.fetch = async (url) => { await tick(30); return Response.json(detail(300)); };
  const frames = [];
  let who = USER;
  const ctxI = { userId: () => who, generation: () => 0 };
  function Probe({ scope }) { const r = useRecipientQuote({ enabled: true, context: ctxI, quoteId: Q(300), scope }); frames.push({ phase: r.state.phase, id: r.state.data ? r.state.data.quote.id : null }); return null; }
  const d = document.createElement("div"); document.body.appendChild(d);
  const root = createRoot(d);
  root.render(h(StrictMode, null, h(Probe, { scope: { org: ORG, site: null } }))); await tick(200);
  out.switches = {};
  for (const [name, change] of [["org", () => ({ org: ORG_B, site: null })], ["site", () => ({ org: ORG_B, site: SITE })], ["identity", () => { who = "10000000-0000-4000-8000-000000000002"; return { org: ORG_B, site: SITE }; }]]) {
    const mark = frames.length; root.render(h(StrictMode, null, h(Probe, { scope: change() }))); await tick(200);
    out.switches[name] = frames.slice(mark)[0];
  }
  root.unmount();
  // 8. Demo ⇒ zero fetch.
  calls = [];
  window.fetch = async (url) => (calls.push(String(url)), Response.json({}));
  const dq = { id: "q-demo", intervention_id: "i-demo", lines: quote(1).lines, subtotal_cents: 9000, tax_rate: 8.5, tax_cents: 765, total_cents: 9765, status: "sent", created_at: at(1) };
  const di = { ...ci, id: "i-demo" };
  v = mount(h(QuoteView, { session: sessionOf({ demo: true, cacheQuotes: [dq], cacheRows: [di] }, []), rows: [di], quoteId: "q-demo" }));
  await tick(300);
  const v2 = mount(h(DocumentsView, { session: sessionOf({ demo: true, cacheQuotes: [dq], cacheRows: [di] }, []), rows: [di] }));
  await tick(300);
  out.demo = { quoteCalls: calls.filter((u) => u.startsWith("/api/quotes")).length, shown: v.d.textContent.includes("Remplacement disjoncteur") };
  v.r.unmount(); v2.r.unmount();
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return out;
};
`;
for (const width of [390, 1280])
  test(`devis réels (Chromium ${width} px) : ancien hors caches exact (lien direct), lecture seule, garde existante conservée, relecture après action, erreurs, liste paginée, entreprise exacte, aucun ancien cadre, démo 0 appel`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
        same(r.old.url, `/api/quotes/${Q(300)}`, "client exact read, no parameter");
        assert.match(r.old.text, /Remplacement disjoncteur 300/);
        same([r.old.accept, r.old.refuse, r.old.current, r.old.anchorExact], [0, 0, Q(1), true], "old version read-only, link to the current one, documents of the exact quote");
        assert.match(r.old.text, /Version en lecture seule/);
        same([r.currentOutside.accept, r.currentOutside.refuse], [1, 1], "a CURRENT sent quote outside the cache (all conditions) is decidable");
        same([r.currentOutside.accepted, r.currentOutside.rereadAccept], [["action", "accept_quote", Q(1), I(1)], 1], "accept with the exact quote + dossier ids, then re-read");
        same([r.currentOutside.refused, r.currentOutside.rereadRefuse], [["operate", "reject_quote", Q(1), I(1)], 1], "refuse with the exact ids, then re-read");
        same(r.nonClient, 0, "another role ⇒ never decidable");
        same([r.active.accept, r.active.action, r.active.reread], [1, ["action", "accept_quote", Q(2), I(2)], 1], "existing guard kept; accept ⇒ server re-read");
        same([r.e503.retry, r.e503.accept, r.e404.accept], [1, 0, 0], "error states ⇒ inactive");
        assert.match(r.e404.text, /introuvable ou inaccessible/);
        same([r.list.first, r.list.all, r.list.oldest], [50, 120, true], "120 quotes over 3 pages, the oldest reachable");
        same(r.list.filterCall, "/api/quotes?status=rejected");
        same(r.list.go[0], "go");
        same([r.ent.url, r.ent.superseded, r.ent.accept, r.ent.anchorExact], [`/api/quotes/${Q(300)}?organization_id=${ORG}&site_id=${SITE}`, true, 0, true], "enterprise: organization + site, read-only, exact documents");
        assert.match(r.ent.total, /97,65/);
        assert.ok(r.entOld.text.includes(r.entOld.ref + " · reçu le"), "first render of #quote/<old cached id>: the OLD version is displayed " + r.entOld.ref + " | " + JSON.stringify(r.entOld.errs) + r.entOld.text.slice(0, 600));
        assert.ok(!r.entOld.text.includes(r.entOld.curRef + " · reçu le"), "not the current one");
        same([r.entOld.decide, r.entOld.quoteCalls], [0, 0], "cached old version: read-only, no exact quote read needed");
        same([r.ent404.inaccessible, r.ent404.quoteView, r.ent404.called], [false, false, [`/api/quotes/${I(99)}?organization_id=${ORG}&site_id=${SITE}`]], "404 on the quote read ⇒ the dossier path, as before");
        same([r.ent403.inaccessible, r.ent403.quoteView], [true, false], "403 ⇒ inaccessible, no other quote");
        for (const k of ["org", "site", "identity"]) same([r.switches[k].phase, r.switches[k].id], ["loading", null], `${k} switch: first render shows no old quote`);
        same([r.demo.quoteCalls, r.demo.shown], [0, true], "demo unchanged, zero quote call");
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
