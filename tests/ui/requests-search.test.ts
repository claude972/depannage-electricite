// Client « Mes demandes » server search. Real model/controller (fake api + fake timers) and a Chromium
// mount of the REAL RequestsView from client-space (live session stub + fake fetch; demo = zero fetch).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import { withApp, skip as appSkip } from "./real-app-harness";
import type * as Model from "../../components/features/requests-search/model";

const m = loadModule("components/features/requests-search/model.ts") as unknown as typeof Model;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), category: "outage", address: `${n} rue Victor Hugo`, postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 12000, created_at: "2025-01-02T10:00:00.000Z", ...over });
const page = (items: unknown[], cursor: string | null = null, total = items.length) => ({ items, total, page: { limit: 50, has_more: cursor !== null, next_cursor: cursor } });
const res = (status: number, body: unknown = null) => ({ status, body });

test("lecture stricte : clés exactes, ≤ 50, has_more ⇔ next_cursor, total ≥ éléments affichés, ids uniques", () => {
  assert.ok(m.parsePage(page([item(1), item(2)], "c1", 120)));
  assert.ok(m.parsePage(page([], null, 0)));
  for (const bad of [
    { ...page([item(1)]), extra: 1 },
    { items: [item(1)], total: 1, page: { limit: 50, has_more: true, next_cursor: null } },
    { items: [item(1)], total: 1, page: { limit: 50, has_more: false, next_cursor: "c" } },
    { items: [item(1)], total: 1, page: { limit: 25, has_more: false, next_cursor: null } },
    { items: [item(1)], total: 1, page: { limit: 50, has_more: false, next_cursor: null, extra: 1 } },
    page([item(1, { description: "secret" })]),
    page([item(1, { status: "deleted" })]),
    page([item(1, { category: "plumbing" })]),
    page([item(1, { estimate_min_cents: 1.5 })]),
    page([item(1, { id: "x" })]),
    page([item(1), item(1)], null, 2),
    page([item(1), item(2)], null, 1),
    page([item(1)], null, -1),
    page(Array.from({ length: 51 }, (_, i) => item(i + 1)), null, 51),
    (({ total: _t, ...x }) => x)(page([item(1)])),
  ])
    assert.equal(m.parsePage(bad), null, JSON.stringify(bad).slice(0, 100));
  assert.equal(m.parsePage(page([item(3)], null, 2), 2), null, "total must cover what is already shown");
  same(m.toListRows([item(1) as Model.SearchItem])[0].description, "");
});

test("API : POST JSON exact, rien dans l’URL", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const api = m.createSearchApi((async (url: string, init: RequestInit) => (seen.push({ url, init }), { status: 200, json: async () => page([]) })) as unknown as typeof fetch);
  await api.search({ filter: "past", search: "12 rue des Lilas 97200", cursor: "c9" });
  same([seen[0].url, seen[0].init.method, seen[0].init.body], ["/api/client/interventions/search", "POST", JSON.stringify({ filter: "past", search: "12 rue des Lilas 97200", cursor: "c9" })]);
  assert.ok(!seen[0].url.includes("?") && !seen[0].url.includes("Lilas"), "query never in the URL");
});

function harness({ replies = [] as (Model.Result | Promise<Model.Result>)[], ctx = { uid: USER as string | null, gen: 0 }, clock = { t: 0 } } = {}) {
  const calls: Model.SearchBody[] = [];
  const timers: { f: () => void; ms: number; id: number; cleared: boolean }[] = [];
  let s: Model.SearchState = { ...m.SEARCH_INITIAL };
  const c = m.createSearchController({
    api: () => ({ search: async (b) => (calls.push(b), replies.shift() ?? res(200, page([]))) }),
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    set: (n) => (s = n),
    timers: { set: (f, ms) => (timers.push({ f, ms, id: timers.length, cleared: false }), timers.length - 1), clear: (h) => void (timers[h as number].cleared = true) },
    now: () => clock.t,
  });
  const flush = () => { for (const t of timers) if (!t.cleared) { t.cleared = true; t.f(); } };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { c, calls, timers, flush, tick, ctx, clock, get: () => s };
}

test("filtre immédiat, recherche différée (~300 ms) et normalisée ; même requête ⇒ rien", async () => {
  const h = harness({ replies: [res(200, page([item(1)]))] });
  h.c.query("active", "");
  await h.tick();
  same([h.calls, h.get().phase, h.get().items.length], [[{ filter: "active", search: "", cursor: null }], "ready", 1], "first load immediate");
  h.c.query("active", "  t");
  h.c.query("active", "ta");
  h.c.query("active", " tab ");
  same([h.calls.length, h.get().phase, h.timers.map((t) => [t.ms, t.cleared])], [1, "loading", [[300, true], [300, true], [300, false]]], "debounced: only the last timer survives");
  h.flush(); await h.tick();
  same(h.calls[1], { filter: "active", search: "tab", cursor: null });
  h.c.query("active", "tab  ");
  same(h.calls.length, 2, "same trimmed query ⇒ nothing");
  h.c.query("past", "tab");
  await h.tick();
  same([h.calls.length, h.calls[2]], [3, { filter: "past", search: "tab", cursor: null }], "filter change ⇒ immediate");
});

test("séquence périmée ignorée ; identité changée ⇒ aucune suite ; 401/403 ⇒ résultats effacés ; erreur + réessai", async () => {
  let release!: (r: Model.Result) => void;
  const h = harness({ replies: [new Promise((r) => (release = r)), res(200, page([item(2)]))] });
  h.c.query("active", "");
  h.c.query("all", "");
  await h.tick();
  release(res(200, page([item(1)])));
  await h.tick();
  same(h.get().items.map((x) => x.id), [ID(2)], "the older sequence is dropped");
  let late!: (r: Model.Result) => void;
  const g = harness({ replies: [new Promise((r) => (late = r))] });
  g.c.query("active", "");
  g.ctx.gen = 1;
  late(res(200, page([item(1)])));
  await g.tick();
  same([g.get().items, g.get().phase], [[], "loading"], "other identity ⇒ dropped");
  g.c.query("all", "");
  same(g.calls.length, 1, "a controller never serves another identity");
  for (const st of [401, 403]) {
    const f = harness({ replies: [res(200, page([item(1)], "c1", 3)), res(st)] });
    f.c.query("active", ""); await f.tick();
    await f.c.more(f.get().key);
    same([f.get().phase, f.get().items, f.get().cursor], ["forbidden", [], null], String(st));
  }
  const e = harness({ replies: [res(503), res(200, { junk: 1 }), res(200, page([]))] });
  e.c.query("active", ""); await e.tick();
  same([e.get().phase, e.get().failed], ["error", "first"]);
  e.c.retry(e.get().key); await e.tick();
  same(e.get().phase, "error", "invalid reply is an error, never empty");
  e.c.retry(e.get().key); await e.tick();
  same([e.get().phase, e.get().items, e.calls.length], ["ready", [], 3], "empty after retry");
});

test("« Afficher plus » : curseur, ajout dédupliqué, échec ⇒ réessai de la suite ; tout changement remet à zéro", async () => {
  const h = harness({ replies: [res(200, page([item(1), item(2)], "c1", 4)), res(500), res(200, page([item(2), item(3)], "c2", 4)), res(200, page([item(4)], null, 4)), res(200, page([item(9)]))] });
  h.c.query("all", ""); await h.tick();
  await h.c.more(h.get().key);
  same([h.get().failed, h.get().items.length, h.get().cursor], ["more", 2, "c1"], "a failed page keeps what is shown");
  h.c.retry(h.get().key); await h.tick();
  same([h.calls[2], h.get().items.map((x) => x.id), h.get().cursor], [{ filter: "all", search: "", cursor: "c1" }, [ID(1), ID(2), ID(3)], "c2"]);
  await h.c.more(h.get().key);
  same([h.get().items.length, h.get().cursor], [4, null]);
  await h.c.more(h.get().key);
  same(h.calls.length, 4, "no cursor ⇒ no call");
  h.c.query("active", ""); await h.tick();
  same([h.calls[4], h.get().items.map((x) => x.id)], [{ filter: "active", search: "", cursor: null }, [ID(9)]], "filter change resets the cursor and the list");
  let release!: (r: Model.Result) => void;
  const r = harness({ replies: [res(200, page([item(1)], "c1", 5)), new Promise((x) => (release = x)), res(200, page([item(7)]))] });
  r.c.query("all", ""); await r.tick();
  const p = r.c.more(r.get().key);
  r.c.query("past", ""); await r.tick();
  release(res(200, page([item(2)], null, 5)));
  await p;
  same(r.get().items.map((x) => x.id), [ID(7)], "a page for the old filter is dropped");
});

test("clé au rendu : état d’une autre clé ⇒ chargement vide ; commandes refusées pour une autre clé ; « Actualiser » ; revalidation bornée", async () => {
  const ctx = { generation: () => 0, userId: () => USER };
  const k = m.viewKey(ctx, "active", " tab ");
  same(k, `${USER}|0|active|tab`);
  const ready = { ...m.SEARCH_INITIAL, key: k, phase: "ready" as const, items: [item(1) as Model.SearchItem], total: 1 };
  same(m.viewOf(ready, k).items.length, 1);
  same([m.viewOf(ready, m.viewKey(ctx, "all", "tab")).phase, m.viewOf(ready, m.viewKey(ctx, "all", "tab")).items], ["loading", []], "another filter ⇒ never the old rows");
  same(m.viewOf(ready, m.viewKey({ generation: () => 1, userId: () => USER }, "active", "tab")).items, [], "another generation ⇒ never the old rows");
  const h = harness({ replies: [res(200, page([item(1)], "c1", 3)), res(200, page([item(2)], null, 3)), res(200, page([item(5)], null, 1))] });
  h.c.query("active", ""); await h.tick();
  await h.c.more("someone|0|active|");
  same(h.calls.length, 1, "« Afficher plus » for another key ⇒ nothing");
  same(h.c.refresh("someone|0|active|"), false);
  same(h.c.refresh(h.get().key), true);
  same([h.get().refreshing, h.get().items.length], [true, 1], "rows of the same key stay during the re-read");
  await h.tick();
  same([h.calls[1], h.get().items.map((x) => x.id), h.get().refreshing], [{ filter: "active", search: "", cursor: null }, [ID(2)], false], "« Actualiser » re-reads page 1");
  h.clock.t = 1000;
  h.c.revalidate(); h.c.revalidate();
  const live = h.timers.filter((t) => !t.cleared);
  same([live.length, live[0].ms], [1, 9000], "debounced, throttled to one read per 10 s after the last read");
  h.flush(); await h.tick();
  same([h.calls.length, h.get().items.map((x) => x.id)], [3, [ID(5)]]);
  h.clock.t = 60_000;
  h.c.revalidate();
  same(h.timers.filter((t) => !t.cleared)[0].ms, 500);
  h.c.query("past", "");
  same(h.timers.filter((t) => !t.cleared).length, 0, "a new query cancels a pending revalidation");
  same(m.rowsSignal([{ id: "b", status: "paid", created_at: "x" }, { id: "a", status: "requested", updated_at: "u", created_at: "x" }]), "a:requested:u,b:paid:x");
});

test("câblage : RequestsView utilise la recherche serveur en direct, garde le filtrage local en démo, ouvre par session.openIntervention", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  const view = src.slice(src.indexOf("export function RequestsView"), src.indexOf("// ---- Détail d’intervention"));
  assert.match(view, /const live = session\.mode === "live";/);
  assert.match(view, /useRequestsSearch\(\{ enabled: live, context: session\.mutationContext, filter, search, signal: live \? rowsSignal\(rows\) : "" \}\)/);
  assert.match(view, /data-requests-refresh=""/);
  assert.match(view, /if \(live\) items = toListRows\(remote\.state\.items\);/);
  assert.match(view, /<RequestList session=\{session\} items=\{items\} \/>/);
  assert.match(view, /Aucune demande dans cette liste/);
  assert.match(src, /onClick=\{\(\) => session\.openIntervention\(i\.id\)\}/, "rows open through the existing detail path");
  assert.doesNotMatch(view, /sessionStorage|localStorage|history\.|location\./, "results never stored or put in the URL");
  const leaf = readFileSync("components/features/requests-search/model.ts", "utf8") + readFileSync("components/features/requests-search/use-requests-search.ts", "utf8");
  assert.doesNotMatch(leaf, /sessionStorage|localStorage|history\.|location\./);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RequestsView } from "./components/role/client-space";
import { useRequestsSearch } from "./components/features/requests-search/use-requests-search";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const item = (n, over = {}) => (${item.toString().replace("ID(n)", "'a0000000-0000-4000-8000-' + String(n).padStart(12, '0')")})(n, over);
const page = (items, cursor = null, total = items.length) => ({ items, total, page: { limit: 50, has_more: cursor !== null, next_cursor: cursor } });
const session = (mode, opened, gen) => ({ mode, mutationContext: { userId: () => "${USER}", generation: () => gen.value }, go: () => {}, openIntervention: (id) => opened.push(id) });
w.frames = async () => {
  const bodies = [];
  w.fetch = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    const n = b.filter === "active" ? 1 : b.filter === "past" ? 2 : 3;
    return new Response(JSON.stringify(page([item(n + (b.search ? 10 : 0))])), { status: 200, headers: { "content-type": "application/json" } });
  };
  const frames = [];
  const gen = { value: 0 };
  const ctx = { userId: () => "${USER}", generation: () => gen.value };
  function Probe({ filter, search, g }) {
    const r = useRequestsSearch({ enabled: true, context: ctx, filter, search });
    frames.push({ g, filter, search, phase: r.state.phase, ids: r.state.items.map((x) => x.id) });
    return null;
  }
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  const show = (filter, search) => root.render(h(StrictMode, null, h(Probe, { filter, search, g: gen.value })));
  const firstAfter = (pred) => frames.find(pred);
  show("active", ""); await tick(200);
  const readyActive = frames[frames.length - 1];
  let mark = frames.length; show("past", ""); await tick(200);
  const afterFilter = frames.slice(mark);
  mark = frames.length; show("past", "tab"); await tick(500);
  const afterSearch = frames.slice(mark);
  mark = frames.length; gen.value = 1; show("past", "tab"); await tick(300);
  const afterIdentity = frames.slice(mark);
  root.unmount();
  // Real RequestsView: « Actualiser » and the workspace row-change signal.
  const d = document.createElement("div"); document.body.appendChild(d);
  const r2 = createRoot(d);
  const opened = [];
  const sess = session("live", opened, gen);
  const rows0 = [{ ...item(70), description: "" }];
  r2.render(h(StrictMode, null, h(RequestsView, { session: sess, rows: rows0 })));
  await tick(300);
  const before = d.querySelectorAll(".request-row").length;
  [...d.querySelectorAll("[aria-label='Filtrer les demandes'] button")].find((b) => b.textContent === "Terminées").click();
  await tick(300);
  const n0 = bodies.length;
  d.querySelector("[data-requests-refresh]").click(); await tick(300);
  const refreshBody = bodies.slice(n0);
  // Same workspace content, new array ⇒ no re-read; a real row change ⇒ one bounded re-read.
  const n1 = bodies.length;
  r2.render(h(StrictMode, null, h(RequestsView, { session: sess, rows: [{ ...rows0[0] }] }))); await tick(800);
  const sameSignal = bodies.length - n1;
  r2.render(h(StrictMode, null, h(RequestsView, { session: sess, rows: [{ ...rows0[0], status: "paid", updated_at: "2025-02-01T00:00:00.000Z" }] }))); await tick(11000);
  const changedSignal = bodies.slice(n1);
  r2.unmount();
  return { readyActive, afterFilter, afterSearch, afterIdentity, before, refreshBody, sameSignal, changedSignal };
};
w.run = async () => {
  const bodies = [], urls = [], opened = [];
  w.fetch = async (url, init) => {
    urls.push(String(url)); const b = JSON.parse(init.body); bodies.push(b);
    let body;
    if (b.cursor === "c1") body = page([item(2), item(3, { address: "3 chemin Old" })], null, 3);
    else if (b.search === "old") body = page([item(900, { status: "paid", created_at: "2019-05-01T08:00:00.000Z" })], null, 1);
    else body = page([item(1), item(2)], "c1", 3);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const gen = { value: 0 };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(RequestsView, { session: session("live", opened, gen), rows: [] })));
  await tick(300);
  const firstRows = div.querySelectorAll(".request-row").length;
  const heights = [...div.querySelectorAll(".request-row, [data-requests-more]")].map((b) => Math.round(b.getBoundingClientRect().height));
  div.querySelector("[data-requests-more]").click(); await tick(300);
  const afterMore = div.querySelectorAll(".request-row").length;
  const moreGone = !div.querySelector("[data-requests-more]");
  const input = div.querySelector("input[type=search]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const before = bodies.length;
  for (const v of ["o", "ol", "old"]) { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); await tick(60); }
  const duringTyping = bodies.length - before;
  await tick(500);
  const searchBodies = bodies.slice(before);
  const oldRow = div.querySelector(".request-row");
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  oldRow.click();
  const filterBefore = bodies.length;
  [...div.querySelectorAll("[aria-label='Filtrer les demandes'] button")].find((b) => b.textContent === "Terminées").click(); await tick(150);
  const filterBody = bodies[filterBefore];
  setter.call(input, " int-a1b2c3 "); input.dispatchEvent(new Event("input", { bubbles: true })); await tick(450);
  const referenceBody = bodies.at(-1);
  const storage = sessionStorage.length + localStorage.length;
  root.unmount();
  // Demo: local filtering, ZERO fetch.
  const demoStart = bodies.length;
  const d = document.createElement("div"); document.body.appendChild(d);
  const demoRows = [{ ...item(5), description: "" }, { ...item(6, { status: "paid" }), description: "" }];
  createRoot(d).render(h(StrictMode, null, h(RequestsView, { session: session("demo", [], gen), rows: demoRows })));
  await tick(500);
  return { firstRows, afterMore, moreGone, duringTyping, searchBodies, opened, filterBody, referenceBody, urls, storage, href: location.href, demoCalls: bodies.length - demoStart, demoRows: d.querySelectorAll(".request-row").length, heights, overflow };
};
`;
test("aucun ancien cadre (Chromium, StrictMode) : 1er rendu après changement de filtre / recherche / identité sans anciennes lignes ; « Actualiser » relit ; signal d’espace de travail borné", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)", timeout: 60_000 }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
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
    const r = (await page.evaluate(() => (window as unknown as { frames2: unknown; frames: () => Promise<unknown> }).frames())) as Record<string, any>;
    same([r.readyActive.phase, r.readyActive.ids], ["ready", [ID(1)]]);
    for (const [name, frames, oldIds] of [["filter", r.afterFilter, [ID(1)]], ["search", r.afterSearch, [ID(2)]], ["identity", r.afterIdentity, [ID(12)]]] as [string, { phase: string; ids: string[] }[], string[]][]) {
      same([frames[0].phase, frames[0].ids], ["loading", []], `${name}: the FIRST render after the change shows no old row`);
      const firstReady = frames.findIndex((f) => f.phase === "ready");
      assert.ok(frames.slice(0, firstReady).every((f) => f.ids.length === 0), `${name}: no row before the new key's reply ${JSON.stringify(frames)}`);
      if (name !== "identity") assert.ok(frames.every((f) => JSON.stringify(f.ids) !== JSON.stringify(oldIds)), `${name}: never an old frame ${JSON.stringify(frames)}`);
    }
    same(r.afterSearch[r.afterSearch.length - 1].ids, [ID(12)]);
    same(r.before, 1, "RequestsView live list rendered from the keyed hook state (the per-render check is on the hook above)");
    same(r.refreshBody, [{ filter: "past", search: "", cursor: null }], "« Actualiser » re-reads page 1");
    same(r.sameSignal, 0, "same workspace rows ⇒ no re-read");
    same(r.changedSignal, [{ filter: "past", search: "", cursor: null }], "a real row change ⇒ one throttled re-read");
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("RequestsView réelle (Chromium 390 px, StrictMode) : POST JSON sans rien dans l’URL, plus + dédup, recherche différée, ancien dossier ⇒ openIntervention, filtre ⇒ curseur remis, démo ⇒ 0 fetch", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error", alias: { "@": ROOT } });
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
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    await page.goto(origin);
    const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as { firstRows: number; afterMore: number; moreGone: boolean; duringTyping: number; searchBodies: unknown[]; opened: string[]; filterBody: unknown; referenceBody: unknown; urls: string[]; storage: number; href: string; demoCalls: number; demoRows: number; heights: number[]; overflow: number };
    same([r.firstRows, r.afterMore, r.moreGone], [2, 3, true], "page 2 appended, duplicate dropped, no more cursor");
    same([r.duringTyping, r.searchBodies], [0, [{ filter: "active", search: "old", cursor: null }]], "debounced: one request for the final text");
    same(r.opened, [ID(900)], "a dossier outside the cache opens through session.openIntervention");
    same(r.filterBody, { filter: "past", search: "old", cursor: null }, "filter change ⇒ immediate, cursor reset");
    same(r.referenceBody, { filter: "all", search: "INT-A1B2C3", cursor: null }, "reference searches all order statuses");
    assert.ok(r.urls.every((u) => u === "/api/client/interventions/search"), r.urls.join(","));
    same([r.storage, r.href], [0, origin], "nothing stored, nothing in the URL");
    same([r.demoCalls, r.demoRows], [0, 1], "demo: local filter (« En cours »), zero fetch");
    assert.ok(r.heights.length === 3 && r.heights.every((x) => x >= 44), `rows + « Afficher plus » targets ${r.heights.join(",")}`);
    assert.ok(r.overflow <= 0, `${r.overflow}px overflow`);
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo client « Mes demandes ») : filtrage local, recherche locale, aucun appel /api, pas de débordement à 390", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client-requests", 390);
    await page.waitForSelector('[data-requests-search="demo"]');
    const before = await page.locator(".request-row").count();
    await page.getByRole("button", { name: "Toutes" }).click();
    const all = await page.locator(".request-row").count();
    await page.getByPlaceholder("Rechercher une intervention").fill("zzzz-aucun");
    await page.waitForTimeout(400);
    const none = await page.locator(".request-row").count();
    const empty = await page.getByText("Aucune intervention ne correspond à votre recherche.").count();
    const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert.ok(all >= before && all > 0, `${before} → ${all}`);
    same([none, empty, overflow <= 0, api, errors], [0, 1, true, [], []]);
    await page.context().close();
  });
});
