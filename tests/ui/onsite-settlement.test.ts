// On-site settlement leaf: strict DTO parse, a client never declares, the artisan confirms before
// any POST, single flight with body exactly {intervention_id}, identity-bound replies, 404 renders
// nothing, 503 keeps the declaration and retries the identical body, onSettled fires once and only
// for a verified « declared_received » under the current identity. Pure / SSR tests + ONE
// single-process Chromium mount with a fake API (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { ROOT, loadModule } from "../documents/harness";
import type * as Onsite from "../../components/role/onsite-settlement";

const m = loadModule("components/role/onsite-settlement.tsx") as unknown as typeof Onsite;
const ID = "20000000-0000-4000-8000-000000000001";
const DUE = { method: "on_site", status: "due_on_site", amount_cents: 18000, currency: "eur", can_declare: true, available: true };
const DECLARED = { method: "on_site_declared", status: "declared_received", amount_cents: 18000, currency: "eur", can_declare: false, available: false };
const BANK = /carte|\bCB\b|stripe|virement|IBAN|pay[ée] par|prélèvement|débit/i;
const noop = () => {};
// The module runs in a vm context (other Object prototype): compare by value.
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const view = (load: unknown, viewer: "client" | "artisan", extra: Record<string, unknown> = {}) =>
  renderToString(createElement(m.OnsiteView as never, { load, viewer, confirming: false, sending: false, postError: null, onReload: noop, onDeclare: noop, onConfirm: noop, onCancel: noop, ...extra } as never));
const ready = (settlement: unknown) => ({ phase: "ready", settlement: m.parseOnsiteSettlement(settlement) });
function fakeApi(replies: Array<{ status: number; body: unknown }>, get: { status: number; body: unknown } = { status: 200, body: DUE }) {
  const posts: unknown[] = [];
  const api = {
    get: async () => get,
    post: async (body: unknown) => {
      posts.push(body);
      await new Promise((r) => setTimeout(r, 5));
      return replies.shift() ?? { status: 503, body: null };
    },
  };
  return { api, posts };
}
const ctx = (gen = { v: 1 }, uid: { v: string | null } = { v: "u1" }) => ({ generation: () => gen.v, userId: () => uid.v });

test("parser: strict frozen DTO, extra keys dropped, anything else is null (never « settled »)", () => {
  same(m.parseOnsiteSettlement(DUE), DUE);
  same(m.parseOnsiteSettlement({ ...DECLARED, provider: "x" }), DECLARED);
  same(m.parseOnsiteSettlement({ ...DUE, amount_cents: null }), { ...DUE, amount_cents: null });
  for (const [name, bad] of [
    ["méthode inconnue", { ...DUE, method: "card" }],
    ["statut croisé", { ...DUE, status: "declared_received" }],
    ["déclaré avec can_declare", { ...DECLARED, can_declare: true }],
    ["déclaré disponible", { ...DECLARED, available: true }],
    ["devise", { ...DUE, currency: "usd" }],
    ["montant négatif", { ...DUE, amount_cents: -1 }],
    ["montant nul", { ...DUE, amount_cents: 0 }],
    ["montant nul déclaré", { ...DECLARED, amount_cents: 0 }],
    ["montant 1.5", { ...DUE, amount_cents: 1.5 }],
    ["montant 2^53", { ...DUE, amount_cents: 2 ** 53 }],
    ["déclaré sans montant", { ...DECLARED, amount_cents: null }],
    ["statut inconnu", { ...DUE, status: "paid" }],
    ["montant décimal", { ...DUE, amount_cents: 10.5 }],
    ["montant texte", { ...DUE, amount_cents: "180" }],
    ["can_declare absent", { method: "on_site", status: "due_on_site", amount_cents: 1, currency: "eur", available: true }],
    ["tableau", [DUE]],
    ["null", null],
  ] as const)
    assert.equal(m.parseOnsiteSettlement(bad), null, name);
});

test("load: 404 (and 401/403) ⇒ nothing rendered; 503 / malformed ⇒ error with « Réessayer », never settled", async () => {
  const get = (status: number, body: unknown) => ({ get: async () => ({ status, body }), post: async () => ({ status: 500, body: null }) });
  same(await m.loadOnsite(get(404, { error: "x" }), ID), { kind: "hidden" });
  same(await m.loadOnsite(get(401, null), ID), { kind: "hidden" });
  same(await m.loadOnsite(get(503, null), ID), { kind: "error" });
  same(await m.loadOnsite(get(0, null), ID), { kind: "error" });
  same(await m.loadOnsite(get(200, { status: "declared_received" }), ID), { kind: "error" });
  for (const body of [{ ...DUE, amount_cents: 0 }, { ...DUE, amount_cents: -1 }, { ...DUE, amount_cents: 1.5 }, { ...DUE, amount_cents: 2 ** 53 }, { ...DECLARED, amount_cents: null }, { ...DUE, method: "card" }])
    same(await m.loadOnsite(get(200, body), ID), { kind: "error" }, JSON.stringify(body));
  same(await m.loadOnsite({ get: async () => { throw new Error("boom"); }, post: async () => ({ status: 0, body: null }) }, ID), { kind: "error" });
  assert.equal(view({ phase: "hidden" }, "client"), "");
  const err = view({ phase: "error" }, "artisan");
  assert.match(err, /Réessayer/);
  assert.doesNotMatch(err, /Déclaré|réglé|reçu/i);
});

test("client: never a declare control, even with can_declare + available; due text with the amount", () => {
  const html = view(ready(DUE), "client", { confirming: true });
  assert.match(html, /Règlement sur place prévu \(180,00\s€\) — à régler à l’artisan après l’intervention\./);
  assert.doesNotMatch(html, /<button|data-onsite-declare|data-onsite-confirm|Je confirme/);
});

test("artisan: declare needs the explicit confirm step; no button when not allowed / unavailable / amount unknown", () => {
  const first = view(ready(DUE), "artisan");
  assert.match(first, /data-onsite-declare=""[^>]*>Déclarer le règlement reçu sur place/);
  assert.doesNotMatch(first, /data-onsite-confirm|Je confirme/, "no POST control before the confirm step");
  const confirm = view(ready(DUE), "artisan", { confirming: true });
  assert.match(confirm, /data-onsite-confirm=""[^>]*>Je confirme avoir reçu 180,00\s€ sur place/);
  for (const dto of [{ ...DUE, can_declare: false }, { ...DUE, available: false }, { ...DUE, amount_cents: null }]) {
    const html = view(ready(dto), "artisan", { confirming: true });
    assert.doesNotMatch(html, /<button/, JSON.stringify(dto));
  }
});

test("declared: same honest text for both viewers, no bank or card wording", () => {
  for (const viewer of ["client", "artisan"] as const) {
    const html = view(ready(DECLARED), viewer);
    assert.match(html, /Déclaré reçu sur place par l’artisan \(180,00\s€\)\. Ce n’est pas un paiement bancaire\./);
    assert.doesNotMatch(html.replace("Ce n’est pas un paiement bancaire.", ""), BANK);
    assert.doesNotMatch(html, /<button/);
  }
  const copy = Object.values(m.ONSITE_COPY).map((c) => (typeof c === "function" ? (c as (n: number) => string)(18000) : c)).join(" ");
  assert.doesNotMatch(copy.replace(/Ce n’est pas un paiement bancaire\./g, ""), BANK);
  assert.doesNotMatch(readFileSync("components/role/onsite-settlement.tsx", "utf8"), /stripe|payé par carte/i);
});

test("declare: double call ⇒ ONE POST with body exactly {intervention_id}; 503 ⇒ retry with the identical body", async () => {
  const { api, posts } = fakeApi([{ status: 503, body: null }, { status: 200, body: DECLARED }]);
  const flight = { current: false };
  const [a, b] = await Promise.all([m.declareOnsite(flight, ctx(), api, ID, () => true), m.declareOnsite(flight, ctx(), api, ID, () => true)]);
  assert.deepEqual([a.kind, b.kind].sort(), ["busy", "retry"]);
  assert.equal(posts.length, 1);
  const again = await m.declareOnsite(flight, ctx(), api, ID, () => true);
  assert.equal(again.kind, "declared");
  assert.equal(posts.length, 2);
  for (const body of posts) assert.equal(JSON.stringify(body), JSON.stringify({ intervention_id: ID }));
  assert.equal(m.ONSITE_COPY.retry, "Statut non confirmé. Vérifiez à nouveau ou reprenez la même déclaration.");
  assert.equal(flight.current, false, "flight released after each reply");
});

test("declare: generation / UID change or unmount ⇒ reply ignored; outcome mapping 403/401/409/422/timeout", async () => {
  const gen = { v: 1 };
  const uid: { v: string | null } = { v: "u1" };
  const slow = { get: async () => ({ status: 200, body: DUE }), post: async () => { gen.v += 1; return { status: 200, body: DECLARED }; } };
  assert.equal((await m.declareOnsite({ current: false }, ctx(gen, uid), slow, ID, () => true)).kind, "ignored");
  const swap = { ...slow, post: async () => { uid.v = "u2"; return { status: 200, body: DECLARED }; } };
  assert.equal((await m.declareOnsite({ current: false }, ctx(gen, uid), swap, ID, () => true)).kind, "ignored");
  const ok = { ...slow, post: async () => ({ status: 200, body: DECLARED }) };
  assert.equal((await m.declareOnsite({ current: false }, ctx(), ok, ID, () => false)).kind, "ignored", "unmounted");
  assert.equal((await m.declareOnsite({ current: false }, ctx({ v: 1 }, { v: null }), ok, ID, () => true)).kind, "unauthenticated");
  const out = async (status: number, body: unknown = null) => (await m.declareOnsite({ current: false }, ctx(), { ...slow, post: async () => ({ status, body }) }, ID, () => true)).kind;
  assert.equal(await out(403), "forbidden");
  assert.equal(await out(401), "unauthenticated");
  assert.equal(await out(409), "conflict");
  assert.equal(await out(422), "conflict");
  assert.equal(await out(0), "retry");
  assert.equal(await out(503), "retry");
  assert.equal(await out(200, DUE), "conflict", "a 2xx that is not declared_received is never success");
  assert.equal(m.ONSITE_COPY.forbidden, "Action réservée à l’artisan affecté.");
});

test("onSettled wiring: once, only after a verified declared reply (POST or GET), never stale", () => {
  const src = readFileSync("components/role/onsite-settlement.tsx", "utf8");
  assert.match(src, /if \(settled\.current\) return;\s*settled\.current = true;/);
  const reload = src.slice(src.indexOf("const reload = useCallback("), src.indexOf("useEffect(() => {\n    mounted.current = true;"));
  const guard = reload.indexOf("if (context.generation() !== generation || context.userId() !== me) return;");
  assert.ok(guard > reload.indexOf("await loadOnsite(") && guard < reload.indexOf("setLoad(out.kind"), "identity guard before any state after the GET");
  assert.ok(reload.indexOf("setLoad(out.kind") < reload.indexOf("fireSettled()"));
  const submit = src.slice(src.indexOf("async function submit()"), src.indexOf("return (\n    <OnsiteView"));
  assert.ok(submit.indexOf('out.kind === "ignored"') < submit.indexOf("fireSettled()"), "stale replies never fire");
  assert.match(submit, /if \(viewer !== "artisan"\) return;/);
});

// ---- One real mount (single-process Chromium, fake API, no network) ----------------------------
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const APP = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OnsiteSettlement } from "./components/role/onsite-settlement";
const ID = "${ID}";
window.posts = [];
window.settled = 0;
const api = {
  get: async () => ({ status: 200, body: ${JSON.stringify(DUE)} }),
  post: async (body) => {
    window.posts.push(JSON.stringify(body));
    await new Promise((r) => setTimeout(r, 30));
    return window.posts.length === 1 ? { status: 503, body: null } : { status: 200, body: ${JSON.stringify(DECLARED)} };
  },
};
const context = { generation: () => 1, userId: () => "artisan-1" };
createRoot(document.getElementById("app")).render(h(OnsiteSettlement, { interventionId: ID, viewer: "artisan", api, context, onSettled: () => { window.settled += 1; } }));
// Fresh dossier already declared: StrictMode runs the mount effect twice ⇒ two GETs, one onSettled.
window.gets2 = 0;
window.settled2 = 0;
const declaredApi = { get: async () => { window.gets2 += 1; return { status: 200, body: ${JSON.stringify(DECLARED)} }; }, post: async () => ({ status: 500, body: null }) };
// Malformed amounts / enums: error + Réessayer, 0 POST, 0 onSettled.
window.badPosts = 0;
window.badSettled = 0;
const BAD = ${JSON.stringify([{ ...DUE, amount_cents: 0 }, { ...DUE, amount_cents: -1 }, { ...DUE, amount_cents: 1.5 }, { ...DUE, amount_cents: 2 ** 53 }, { ...DECLARED, amount_cents: null }, { ...DUE, status: "paid" }])};
BAD.forEach((body, i) => {
  const el = document.createElement("div");
  el.setAttribute("data-bad", String(i));
  document.body.appendChild(el);
  const badApi = { get: async () => ({ status: 200, body }), post: async () => { window.badPosts += 1; return { status: 200, body: ${JSON.stringify(DECLARED)} }; } };
  createRoot(el).render(h(OnsiteSettlement, { interventionId: ID, viewer: "artisan", api: badApi, context, onSettled: () => { window.badSettled += 1; } }));
});
// Identity switch WITHOUT remount: load starts as A, context becomes B, then A's reply resolves.
window.gen3 = 1;
window.uid3 = "user-A";
window.settled3 = 0;
let resolveA;
window.resolveA = () => resolveA({ status: 200, body: ${JSON.stringify(DECLARED)} });
const deferredApi = { get: () => new Promise((r) => { resolveA = r; }), post: async () => ({ status: 500, body: null }) };
const ctx3 = { generation: () => window.gen3, userId: () => window.uid3 };
createRoot(document.getElementById("app3")).render(h(OnsiteSettlement, { interventionId: ID, viewer: "client", api: deferredApi, context: ctx3, onSettled: () => { window.settled3 += 1; } }));
createRoot(document.getElementById("app2")).render(h(StrictMode, null, h(OnsiteSettlement, { interventionId: ID, viewer: "client", api: declaredApi, context, onSettled: () => { window.settled2 += 1; } })));
`;
test("mounted (artisan): declare → confirm (double click = 1 POST) → 503 « non confirmé » → retry same body → declared, onSettled once; fresh declared GET twice ⇒ one onSettled; malformed ⇒ error, 0 POST; A→B stale GET dropped", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><div id="app"></div><div id="app2"></div><div id="app3"></div><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("request", (rq: { url(): string }) => requests.push(rq.url()));
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const posts = () => page.evaluate(() => (window as unknown as { posts: string[] }).posts);
    await page.locator("#app [data-onsite-declare]").click();
    assert.deepEqual(await posts(), [], "the declare button alone never POSTs");
    await page.locator("#app [data-onsite-confirm]").dblclick();
    await page.locator('#app [data-onsite-error="retry"]').waitFor();
    assert.equal((await posts()).length, 1, "double click ⇒ one POST");
    assert.match(await page.locator('#app [data-onsite-error="retry"]').innerText(), /Statut non confirmé\. Vérifiez à nouveau ou reprenez la même déclaration\./);
    assert.equal(await page.locator("#app [data-onsite-reload]").count(), 1, "« Actualiser » offered");
    assert.equal(await page.locator('#app [data-onsite-settlement="declared_received"]').count(), 0);
    await page.locator("#app [data-onsite-confirm]").click();
    await page.locator('#app [data-onsite-settlement="declared_received"]').waitFor();
    const all = await posts();
    assert.deepEqual(all, [JSON.stringify({ intervention_id: ID }), JSON.stringify({ intervention_id: ID })], "identical body on retry");
    const text = await page.locator('#app [data-onsite-settlement="declared_received"]').innerText();
    assert.match(text, /Déclaré reçu sur place par l’artisan \(180,00\s€\)\. Ce n’est pas un paiement bancaire\./);
    assert.equal(await page.evaluate(() => (window as unknown as { settled: number }).settled), 1, "onSettled once");
    // Fresh declared GET (twice, StrictMode) ⇒ exactly one onSettled.
    await page.locator('#app2 [data-onsite-settlement="declared_received"]').waitFor();
    await page.waitForTimeout(100);
    const fresh = await page.evaluate(() => ({ gets: (window as unknown as { gets2: number }).gets2, settled: (window as unknown as { settled2: number }).settled2 }));
    assert.equal(fresh.gets, 2, "two GETs (StrictMode double mount effect)");
    assert.equal(fresh.settled, 1, "fresh declared GET ⇒ onSettled exactly once");
    // Malformed DTOs: each shows the error with « Réessayer », never a POST nor onSettled.
    for (let i = 0; i < 6; i += 1) await page.locator(`[data-bad="${i}"] [data-onsite-settlement="error"]`).waitFor();
    assert.equal(await page.locator("[data-bad] [data-onsite-declare]").count(), 0);
    const bad = await page.evaluate(() => ({ posts: (window as unknown as { badPosts: number }).badPosts, settled: (window as unknown as { badSettled: number }).badSettled }));
    assert.deepEqual(bad, { posts: 0, settled: 0 });
    // A → B without remount: A's declared reply is dropped (no data, no onSettled under B).
    await page.locator('#app3 [data-onsite-settlement="loading"]').waitFor();
    await page.evaluate(() => { const w = window as unknown as { gen3: number; uid3: string; resolveA(): void }; w.gen3 = 2; w.uid3 = "user-B"; w.resolveA(); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#app3 [data-onsite-settlement="declared_received"]').count(), 0, "no A data rendered under B");
    assert.doesNotMatch(await page.locator("#app3").innerText(), /Déclaré/);
    assert.equal(await page.evaluate(() => (window as unknown as { settled3: number }).settled3), 0, "no onSettled under B");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => !u.startsWith("http://127.0.0.1")), [], "no network beyond the local page");
  } finally {
    await browser.close();
    server.close();
  }
});
