// SYS-10 photo review (contract: ROOT assembly 12f62f2, strict browser copy). Real model + SSR + Chromium mount + real-app demo.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Model from "../../components/features/photo-review/model";

const m = loadModule("components/features/photo-review/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/photo-review/photo-review-panel.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const U = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = U("1", 1), JOB = U("2", 1), DOC = U("d", 1), DOC2 = U("d", 2), REV = U("e", 1);
const RESULT = { category: "panel", readability: "readable" };
const item = (over: Record<string, unknown> = {}) => ({ id: REV, document_id: DOC, version: 2, status: "awaiting_review", can_withdraw: false, can_review: false, result: null, ...over });
const view = (over: Record<string, unknown> = {}) => ({ provider_available: true, can_request: true, items: [item()], ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
const photos = [{ id: DOC, name: "tableau.jpg" }, { id: DOC2, name: "prise.jpg" }];
const ctx = { generation: () => 0, userId: () => USER };

test("lecture stricte (12f62f2) : statuts et libellés fixes, aucun texte libre, résultat présent EXACTEMENT si validé (ou en attente pour qui ne peut pas demander), 20 éléments max", () => {
  assert.ok(m.parseView(view()));
  assert.ok(m.parseView(view({ items: [item({ status: "validated", result: RESULT })] })));
  assert.ok(m.parseView(view({ can_request: false, items: [item({ result: RESULT })] })), "artisan view: awaiting review with its result");
  for (const bad of [{ ...view(), extra: 1 }, view({ items: [item({ status: "diagnosed" })] }), view({ items: [item({ status: "validated", result: { ...RESULT, comment: "x" } })] }), view({ items: [item({ status: "validated", result: { category: "fuse", readability: "readable" } })] }), view({ items: [item({ note: "texte libre" })] }), view({ items: [item(), item()] }), view({ items: [item({ result: RESULT })] }), view({ items: [item({ status: "validated" })] }), view({ items: [item({ status: "requested", result: RESULT })] }), view({ items: Array.from({ length: 21 }, (_, i) => item({ id: `e0000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}` })) }), view({ items: [{ ...item(), can_request: true }] }), { provider_available: true, items: [] }])
    assert.equal(m.parseView(bad), null, JSON.stringify(bad).slice(0, 90));
  for (const st of m.STATUSES) assert.ok(m.STATUS_LABEL[st].length > 0, st);
  const all = Object.values(m.STATUS_LABEL).join(" ") + Object.values(m.CATEGORY_LABEL).join(" ") + Object.values(m.READABILITY_LABEL).join(" ") + Object.values(m.COPY).filter((v) => typeof v === "string").join(" ");
  assert.doesNotMatch(all.replace("ni un diagnostic ni une promesse", ""), /diagnostic|garanti|promesse|sans danger|conforme/i, "never a diagnosis or a promise");
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0, JOB).startsWith(p)));
});

test("visibilité : le client ne voit un résultat qu’après validation humaine ; l’artisan voit et valide selon can_review ; fournisseur absent ⇒ demandes gardées, revue manuelle accessible", () => {
  const vv = (o: Record<string, unknown>, top: Record<string, unknown> = {}) => m.parseView(view({ ...top, items: [item(o)] }))!.items[0];
  same([m.visibleResult(vv({}), "client"), m.visibleResult(vv({ status: "validated", result: RESULT }), "client")?.category, m.visibleResult(vv({ result: RESULT }, { can_request: false }), "artisan")?.category], [null, "panel", "panel"]);
  const render = (role: "client" | "artisan", v: Record<string, unknown>) => renderToString(createElement(ui.PhotoReviewPanel, { interventionId: JOB, role, photos, context: ctx, initial: { ...m.PR_INITIAL, phase: "ready", view: m.parseView(v) } }));
  const client = text(render("client", view()));
  assert.doesNotMatch(client, /Tableau électrique · photo lisible/);
  assert.match(client, /En attente de validation par l’artisan.*Résultat visible après validation par l’artisan/);
  assert.match(text(render("client", view({ items: [item({ status: "validated", result: RESULT })] }))), /Validée par l’artisan Tableau électrique · photo lisible/);
  const art = render("artisan", view({ can_request: false, items: [item({ can_review: true, result: RESULT })] }));
  assert.match(text(art), /Tableau électrique · photo lisible/);
  for (const a of ["validate", "reject"]) assert.match(art, new RegExp(`data-photo-review-${a}="${REV}"`));
  assert.doesNotMatch(render("artisan", view({ can_request: false, items: [item({ result: RESULT })] })), /data-photo-review-validate/, "no review action without can_review");
  const off = render("client", view({ provider_available: false, items: [item({ status: "requested", can_withdraw: true })] }));
  assert.match(text(off), /Revue automatique indisponible.*la revue manuelle reste accessible/);
  assert.match(off, new RegExp(`data-photo-review-withdraw="${REV}"`));
  assert.match(text(off), /La revue manuelle des pièces reste disponible\./);
  assert.match(text(render("client", view())), /ni un diagnostic ni une promesse/);
  const noReq = render("client", view({ can_request: false, items: [] }));
  assert.doesNotMatch(noReq, /data-photo-review-request|data-photo-review-consent/, "request only with the top-level can_request");
  const req = render("client", view({ items: [] }));
  assert.match(req, /<input type="checkbox" data-photo-review-consent=""\/>/);
  assert.match(req, new RegExp(`disabled=""[^>]*data-photo-review-request="${DOC}"`), "disabled until consent");
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ reads = [] as Model.Result[], posts = [] as ((c: Model.PrCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [U("c", 1), U("c", 2)], c = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; cmd?: Model.PrCommand; stored?: string | null }[] = [];
  let s: Model.PrState = { ...m.PR_INITIAL };
  const ctrl = m.createPrController({ api: () => ({ read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, view())), send: async (_j, cmd) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(c.uid, c.gen, JOB)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) }), interventionId: JOB, store: () => store, newId: () => ids.shift() ?? null, context: { generation: () => c.gen, userId: () => c.uid }, get: () => s, set: (n) => (s = n) });
  return { ctrl, calls, c, get: () => s };
}

test("demande : consentement explicite + can_request de premier niveau ; écrite et relue AVANT le POST ; réponse = vue vérifiée (document, version 1)", async () => {
  const mem = memStore();
  const reqView = view({ items: [item(), item({ id: U("e", 2), document_id: DOC2, version: 1, status: "requested" })] });
  const h = harness({ store: mem.store, reads: [res(200, view())], posts: [() => res(200, reqView)] });
  await h.ctrl.load();
  same([await h.ctrl.request(DOC2, false), h.calls.map((x) => x.kind)], [false, ["GET"]], "no request without consent");
  same(await h.ctrl.request(DOC2, true), true);
  const post = h.calls.find((x) => x.kind === "POST")!;
  same([post.cmd, JSON.parse(post.stored!).command], [{ action: "request", document_id: DOC2, command_id: U("c", 1), expected_version: 0, consent: true }, post.cmd]);
  same([mem.map.size, h.get().view!.items.length, h.get().notice], [0, 2, m.COPY.done.request]);
  const no = harness({ reads: [res(200, view({ can_request: false }))] });
  await no.ctrl.load();
  same([await no.ctrl.request(DOC2, true), no.calls.map((x) => x.kind)], [false, ["GET"]], "server can_request false ⇒ no POST");
  const wrong = harness({ posts: [() => res(200, view())] });
  await wrong.ctrl.load(); await wrong.ctrl.request(DOC2, true);
  same([wrong.get().pending?.action, wrong.get().error], ["request", m.COPY.retry], "a view that does not reflect the command is an unknown outcome");
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.ctrl.load();
    same([await x.ctrl.request(DOC2, true), x.calls.map((y) => y.kind), x.get().error], [false, ["GET"], m.COPY.storage]);
  }
});

test("retrait / revue : drapeaux par élément, version exacte, statut cohérent ; incertain ⇒ même commande ; 409 relu sans rejeu ; identité changée ⇒ aucun rejeu ; 401/403 effacé", async () => {
  const h = harness({ reads: [res(200, view({ can_request: false, items: [item({ can_review: true, result: RESULT })] }))], posts: [() => res(200, view({ can_request: false, items: [item({ version: 3, status: "validated", result: RESULT })] }))] });
  await h.ctrl.load();
  same(await h.ctrl.withdraw(REV), false, "no withdraw without can_withdraw");
  same(await h.ctrl.review(REV, "validate"), true);
  same(h.calls.find((x) => x.kind === "POST")!.cmd, { action: "review", review_id: REV, command_id: U("c", 1), expected_version: 2, decision: "validate" });
  const badStatus = harness({ reads: [res(200, view({ can_request: false, items: [item({ can_review: true, result: RESULT })] }))], posts: [() => res(200, view({ can_request: false, items: [item({ version: 3, status: "rejected" })] }))] });
  await badStatus.ctrl.load(); await badStatus.ctrl.review(REV, "validate");
  same(badStatus.get().pending?.action, "review", "a mismatching status is not a success");
  const mem = memStore();
  const w = harness({ store: mem.store, reads: [res(200, view({ items: [item({ status: "requested", can_withdraw: true })] }))], posts: [() => res(m.PR_TIMEOUT), () => res(503)] });
  await w.ctrl.load(); await w.ctrl.withdraw(REV); await w.ctrl.retry();
  same(w.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd)), Array(2).fill(JSON.stringify({ action: "withdraw", review_id: REV, command_id: U("c", 1), expected_version: 2 })));
  const back = harness({ store: mem.store, reads: [res(200, view({ items: [item({ status: "requested", can_withdraw: true })] }))], posts: [() => res(200, view({ items: [item({ version: 3, status: "withdrawn" })] }))] });
  back.ctrl.restorePending();
  await back.ctrl.load();
  same([back.get().pending?.action, back.calls.map((x) => x.kind)], ["withdraw", ["GET"]], "restored, never sent by itself");
  await back.ctrl.retry();
  same([back.get().notice, mem.map.size], [m.COPY.done.withdraw, 0]);
  const c = harness({ reads: [res(200, view({ items: [item({ can_review: true })] })), res(200, view({ items: [item({ version: 3, status: "validated", result: RESULT })] }))], posts: [() => res(409)] });
  await c.ctrl.load(); await c.ctrl.review(REV, "reject");
  same([c.get().error, c.get().pending, c.calls.map((x) => x.kind)], [m.COPY.conflict, null, ["GET", "POST", "GET"]]);
  same(await c.ctrl.retry(), false);
  let release!: (r: Model.Result) => void;
  const g = harness({ reads: [res(200, view({ items: [item({ can_review: true })] }))], posts: [() => new Promise((r) => (release = r))] });
  await g.ctrl.load();
  const p = g.ctrl.review(REV, "validate");
  g.c.gen = 1;
  release(res(200, view({ items: [item({ version: 3, status: "validated", result: RESULT })] })));
  same([await p, g.get().notice], [false, ""]);
  const r = harness({ reads: [res(200, view({ items: [item({ can_review: true })] }))], posts: [() => res(503)] });
  await r.ctrl.load(); await r.ctrl.review(REV, "validate");
  r.c.uid = U("1", 2);
  same([await r.ctrl.retry(), r.get().pending], [false, null]);
  for (const st of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, reads: [res(200, view({ items: [item({ can_review: true })] }))], posts: [() => res(st)] });
    await f.ctrl.load(); await f.ctrl.review(REV, "validate");
    same([f.get().phase, f.get().view, mm.map.size], ["forbidden", null, 0], String(st));
  }
});

test("démo : aucun appel ; câblage client (zone Photos) et artisan (après les pièces)", () => {
  let calls = 0;
  const api = { read: async () => (calls++, res(200)), send: async () => (calls++, res(200)) };
  assert.match(text(renderToString(createElement(ui.PhotoReviewPanel, { interventionId: JOB, role: "client", photos, context: ctx, demo: true, api }))), /aucune photo n’est analysée ni transmise.*revue manuelle des pièces reste disponible/);
  same(calls, 0);
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /<PhotoReviewPanel key=\{`\$\{i\.id\}\|[^`]+`\} interventionId=\{i\.id\} role="client" photos=\{photos\.map/);
  assert.match(readFileSync("components/role/artisan-space.tsx", "utf8"), /photoReview=\{session\.mutationContext\}\s+\/>\s+\{\/\* SYS-10[^}]*\*\/\}\s+<PhotoReviewPanel[\s\S]{0,300}role="artisan"/);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhotoReviewPanel } from "./components/features/photo-review/photo-review-panel";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = "d0000000-0000-4000-8000-000000000001";
window.run = async () => {
  const calls = [];
  let items = [];
  const api = { read: async () => (calls.push("GET"), { status: 200, body: { provider_available: false, can_request: true, items } }), send: async (_j, cmd) => { calls.push("POST:" + cmd.action + ":" + cmd.consent); items = [{ id: "e0000000-0000-4000-8000-000000000001", document_id: DOC, version: 1, status: "requested", can_withdraw: true, can_review: false, result: null }]; return { status: 200, body: { provider_available: false, can_request: true, items } }; } };
  const map = new Map();
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(PhotoReviewPanel, { interventionId: "20000000-0000-4000-8000-000000000001", role: "client", photos: [{ id: DOC, name: "tableau.jpg" }], context: { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" }, api, store: () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) }), newId: () => crypto.randomUUID() })));
  await tick(300);
  const btn = () => div.querySelector("[data-photo-review-request]");
  const disabledBefore = btn().disabled;
  btn().click(); await tick(100);
  const postsBeforeConsent = calls.filter((c) => c.startsWith("POST")).length;
  div.querySelector("[data-photo-review-consent]").click(); await tick(50);
  btn().click(); await tick(300);
  const heights = [...div.querySelectorAll("button, label")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  return { disabledBefore, postsBeforeConsent, calls, status: div.querySelector("[data-photo-review-status]")?.getAttribute("data-photo-review-status"), withdraw: !!div.querySelector("[data-photo-review-withdraw]"), providerOff: !!div.querySelector("[data-photo-review-provider-off]"), heights, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
`;
test("monté (Chromium, StrictMode, 390 px) : aucun POST sans consentement, puis une demande ; fournisseur absent dit ; 44 px", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2"></div><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as { disabledBefore: boolean; postsBeforeConsent: number; calls: string[]; status: string; withdraw: boolean; providerOff: boolean; heights: number[]; overflow: number };
    same([r.disabledBefore, r.postsBeforeConsent, r.calls.filter((c) => c.startsWith("POST")), r.status, r.withdraw, r.providerOff], [true, 0, ["POST:request:true"], "requested", true, true]);
    assert.ok(r.heights.every((x) => x >= 44), r.heights.join(","));
    assert.ok(r.overflow <= 0);
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo) : client et artisan, aucun appel /api, pas d’erreur, pas de débordement à 390", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-detail.demo-001", "artisan-detail.demo-001"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ demo: document.querySelectorAll('[data-photo-review="demo"]').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      same([r.overflow <= 0, api, errors], [true, [], []], route);
      await page.context().close();
    }
  });
});
