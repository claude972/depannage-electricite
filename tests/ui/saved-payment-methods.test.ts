// FIN-08 saved payment methods (client « Mon profil »). Real model + SSR + a Chromium mount of the
// real panel (fake api) + real-app demo wiring.
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
import type * as Model from "../../components/features/saved-payment-methods/model";

const m = loadModule("components/features/saved-payment-methods/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/saved-payment-methods/saved-payment-methods-panel.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const USER = "10000000-0000-4000-8000-000000000001";
const CID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const card = (n: number, over: Record<string, unknown> = {}) => ({ id: `pm_test${n}`, brand: "visa", last4: String(4240 + n).slice(-4), exp_month: 12, exp_year: 2030, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
const URL_OK = "https://checkout.stripe.com/c/setup/cs_test_1";

test("lecture stricte + pagination ; expiration locale ; marqueur de retour", () => {
  assert.ok(m.parseMethods({ methods: [card(1)], has_more: false }, null));
  for (const bad of [{ methods: [card(1)] }, { methods: [card(1)], has_more: false, extra: 1 }, { methods: [card(1, { last4: "12" })], has_more: false }, { methods: [card(1, { id: "card_1" })], has_more: false }, { methods: [card(1, { exp_month: 13 })], has_more: false }, { methods: [card(1), card(1)], has_more: false }, { methods: [], has_more: true }, { methods: [{ ...card(1), number: "4242424242424242" }], has_more: false }])
    assert.equal(m.parseMethods(bad, null), null, JSON.stringify(bad).slice(0, 80));
  assert.equal(m.parseMethods({ methods: [card(1)], has_more: false }, "pm_test1"), null, "a next page never repeats the cursor");
  const now = new Date(2026, 10, 7);
  same([m.isExpired({ exp_month: 10, exp_year: 2026 }, now), m.isExpired({ exp_month: 11, exp_year: 2026 }, now), m.isExpired({ exp_month: 1, exp_year: 2025 }, now), m.isExpired({ exp_month: 1, exp_year: 2027 }, now)], [true, false, true, false]);
  same([m.returnMarker("?saved_methods=returned"), m.returnMarker("?x=1&saved_methods=cancelled"), m.returnMarker("?saved_methods=paid"), m.returnMarker("")], ["returned", "cancelled", null, null]);
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0).startsWith(p)), "covered by the central purge");
});

const STRIPE_REAL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4#fidkdWxOYHwnPyd1blpxYHZxWjA0";
test("URL de configuration : origine EXACTE https://checkout.stripe.com ; fragment Stripe (#fid…) gardé tel quel ; autres hôtes / http / identifiants / port refusés", () => {
  same([m.safeSetupUrl(URL_OK), m.safeSetupUrl(STRIPE_REAL), m.safeSetupUrl("https://checkout.stripe.com:443/c/pay/cs_x?a=1#fidX")], [URL_OK, STRIPE_REAL, "https://checkout.stripe.com:443/c/pay/cs_x?a=1#fidX"], "byte-for-byte, fragment preserved");
  for (const bad of ["http://checkout.stripe.com/c/pay/cs_test_a1B2c3D4#fidX", "https://checkout.stripe.com.evil.example/c/pay/x", "https://stripe.com/c/pay/x", "https://evil.test/checkout.stripe.com", "https://user:pw@checkout.stripe.com/c/pay/x", "https://checkout.stripe.com:8443/c/pay/x", "javascript:alert(1)", "//checkout.stripe.com/x", "https://pay.stripe.com/x", " https://checkout.stripe.com/c/pay/x"])
    assert.equal(m.safeSetupUrl(bad), null, bad);
  same([m.parseSetupReply({ url: STRIPE_REAL }), m.parseSetupReply({ url: URL_OK, extra: 1 }), m.parseSetupReply({ url: "https://evil.test" })], [STRIPE_REAL, null, null]);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ lists = [] as Model.Result[], posts = [] as ((c: Model.PmCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [CID(1), CID(2)], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; after?: string | null; cmd?: Model.PmCommand; stored?: string | null }[] = [];
  let s: Model.PmState = { ...m.PM_INITIAL };
  const c = m.createPmController({ api: () => ({ list: async (after) => (calls.push({ kind: "GET", after }), lists.shift() ?? res(200, { methods: [card(1), card(2)], has_more: false })), post: async (cmd) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) }), store: () => store, newId: () => ids.shift() ?? null, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => s, set: (n) => (s = n) });
  return { c, calls, ctx, get: () => s };
}

test("consentement explicite : texte (réutilisation lors de prochains règlements personnels confirmés sur Stripe ; aucun prélèvement automatique) ; aucun POST de configuration sans accord", async () => {
  assert.match(m.COPY.consent, /réutilisée lors de mes prochains règlements personnels/);
  assert.match(m.COPY.consent, /chacun confirmé par moi sur Stripe/);
  assert.match(m.COPY.consent, /Aucun prélèvement automatique/);
  const html = renderToString(createElement(ui.SavedPaymentMethodsPanel, { context: { generation: () => 0, userId: () => USER }, initial: { ...m.PM_INITIAL, phase: "ready" } }));
  assert.match(text(html), /prochains règlements personnels sur la plateforme, chacun confirmé par moi sur Stripe\. Aucun prélèvement automatique/);
  assert.match(html, /<input type="checkbox" data-saved-methods-consent=""\/>/, "unchecked by default");
  assert.match(html, /disabled=""[^>]*data-saved-methods-setup=""/, "the add button stays disabled without consent");
  const h = harness({ posts: [() => res(200, { url: URL_OK })] });
  await h.c.load();
  same([await h.c.setup(false), h.calls.filter((x) => x.kind === "POST").length], [false, 0], "no setup POST without explicit consent");
  await h.c.setup(true);
  same((h.calls.find((x) => x.kind === "POST")!.cmd as { consent: boolean }).consent, true);
});

test("configuration : consentement requis ; commande écrite et relue AVANT le POST ; URL gardée en mémoire seulement, jamais persistée ; mauvais hôte ⇒ rien d’ouvert", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, posts: [() => res(200, { url: URL_OK })] });
  await h.c.load();
  same(await h.c.setup(false), false);
  same(h.calls.map((x) => x.kind), ["GET"]);
  same(await h.c.setup(true), true);
  const post = h.calls.find((x) => x.kind === "POST")!;
  same([post.cmd, JSON.parse(post.stored!).command], [{ action: "setup", consent: true, command_id: CID(1) }, post.cmd]);
  same([h.get().setupUrl, mem.map.size, [...mem.map.values()].some((v) => v.includes("checkout.stripe.com"))], [URL_OK, 0, false]);
  same([h.c.takeSetupUrl(), h.c.takeSetupUrl()], [URL_OK, null], "single use");
  const real = harness({ posts: [() => res(200, { url: STRIPE_REAL })] });
  await real.c.load(); await real.c.setup(true);
  same(real.c.takeSetupUrl(), STRIPE_REAL, "the exact string, fragment included, is what the click opens");
  const evil = harness({ posts: [() => res(200, { url: "https://evil.test/pay" })] });
  await evil.c.load(); await evil.c.setup(true);
  same([evil.get().setupUrl, evil.get().error, evil.get().pending], [null, m.COPY.badUrl, null]);
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.c.load();
    same([await x.c.setup(true), x.calls.map((c) => c.kind), x.get().error], [false, ["GET"], m.COPY.storage]);
  }
});

test("suppression : seulement une méthode listée, puis relecture ; réponse incertaine ⇒ même commande ; identité changée ⇒ aucun rejeu ; 401/403 ⇒ tout effacé", async () => {
  const h = harness({ lists: [res(200, { methods: [card(1), card(2)], has_more: false }), res(200, { methods: [card(2)], has_more: false })], posts: [() => res(200, { removed: true })] });
  await h.c.load();
  same(await h.c.remove("pm_unknown"), false);
  same(await h.c.remove("pm_test1"), true);
  same([h.calls.filter((x) => x.kind === "POST").map((x) => x.cmd), h.get().methods.map((x) => x.id), h.get().notice], [[{ action: "remove", method_id: "pm_test1", command_id: CID(1) }], ["pm_test2"], m.COPY.removed]);
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.PM_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.remove("pm_test1"); await a.c.retry();
  same(a.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd)), Array(2).fill(JSON.stringify({ action: "remove", method_id: "pm_test1", command_id: CID(1) })));
  same(await a.c.setup(true), false, "no new command while one is uncertain");
  const b = harness({ store: mem.store, posts: [() => res(200, { removed: true })] });
  b.c.restorePending();
  await b.c.load();
  same([b.get().pending?.command_id, b.calls.map((x) => x.kind)], [CID(1), ["GET"]], "restored, never sent by itself");
  mem.map.set(m.pendingKey(USER, 1), JSON.stringify({ uid: USER, gen: 0, command: { action: "remove", method_id: "pm_test1", command_id: CID(1) } }));
  const other = harness({ store: mem.store, ctx: { uid: USER, gen: 1 } });
  other.c.restorePending();
  same([other.get().pending, mem.map.has(m.pendingKey(USER, 1))], [null, false]);
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.remove("pm_test1");
  g.ctx.gen = 1;
  release(res(200, { removed: true }));
  same([await p, g.get().notice, g.calls.filter((x) => x.kind === "GET").length], [false, "", 1]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.remove("pm_test1");
  r.ctx.uid = "10000000-0000-4000-8000-000000000002";
  same([await r.c.retry(), r.get().pending], [false, null]);
  for (const st of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, posts: [() => res(st)] });
    await f.c.load(); await f.c.remove("pm_test1");
    same([f.get().phase, f.get().methods, mm.map.size], ["forbidden", [], 0], String(st));
  }
});

test("états : 403 refus honnête, 503 réessai, vide, pagination after, démo sans appel ; retour Stripe ⇒ relecture seulement, jamais « ajoutée »", async () => {
  const forb = harness({ lists: [res(403)] });
  await forb.c.load();
  same(forb.get().phase, "forbidden");
  const down = harness({ lists: [res(503), res(200, { methods: [], has_more: false })] });
  await down.c.load();
  same(down.get().phase, "unavailable");
  await down.c.load();
  same([down.get().phase, down.get().methods.length], ["ready", 0]);
  const paged = harness({ lists: [res(200, { methods: [card(1)], has_more: true }), res(200, { methods: [card(2)], has_more: false })] });
  await paged.c.load(); await paged.c.more();
  same([paged.calls.map((x) => x.after), paged.get().methods.map((x) => x.id), paged.get().hasMore], [[null, "pm_test1"], ["pm_test1", "pm_test2"], false]);
  const ctx = { generation: () => 0, userId: () => USER };
  const ready = (over: Partial<Model.PmState> = {}) => renderToString(createElement(ui.SavedPaymentMethodsPanel, { context: ctx, now: () => new Date(2026, 10, 7), initial: { ...m.PM_INITIAL, phase: "ready", ...over } }));
  const list = text(ready({ methods: [card(1), card(2, { exp_month: 1, exp_year: 2025, brand: "mastercard" })] as Model.SavedMethod[] }));
  assert.match(list, /Visa •••• 4241 · expire 12\/2030/);
  assert.match(list, /Mastercard •••• 4242 · expire 01\/2025 · Expirée/);
  assert.match(list, /aucun paiement n’est effectué ici/);
  assert.match(text(ready()), /Aucun moyen de paiement enregistré\./);
  assert.match(text(ready({ phase: "forbidden" })), /ne permet pas de gérer des moyens de paiement/);
  assert.doesNotMatch(ready({ methods: [card(1)] as Model.SavedMethod[] }), /data-saved-methods-open|Payer|choisir cette carte/i);
  assert.match(ready(), /disabled=""[^>]*data-saved-methods-setup=""/, "add disabled until consent");
  let calls = 0;
  const api = { list: async () => (calls++, res(200)), post: async () => (calls++, res(200)) };
  assert.match(text(renderToString(createElement(ui.SavedPaymentMethodsPanel, { context: ctx, demo: true, api }))), /aucune banque n’est contactée/);
  same(calls, 0);
  assert.doesNotMatch(m.COPY.returned, /ajoutée|enregistrée avec succès/);
  assert.match(m.COPY.returned, /ne prouve pas qu’une carte a été enregistrée/);
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /<SavedPaymentMethodsPanel key=\{`\$\{session\.mode\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\} demo=\{demo\} context=\{session\.mutationContext\} \/>/);
  assert.doesNotMatch(src, /aucun moyen de paiement n’est mémorisé/);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SavedPaymentMethodsPanel } from "./components/features/saved-payment-methods/saved-payment-methods-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
w.run = async (search) => {
  const calls = [], navigated = [];
  let methods = [{ id: "pm_test1", brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 }];
  const api = {
    list: async () => (calls.push("GET"), { status: 200, body: { methods, has_more: false } }),
    post: async (cmd) => { calls.push("POST:" + cmd.action); if (cmd.action === "remove") { methods = []; return { status: 200, body: { removed: true } }; } return { status: 200, body: { url: "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4#fidkdWxOYHwnPyd1blpxYHZxWjA0" } }; },
  };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(SavedPaymentMethodsPanel, { context: { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" }, api, store, search, navigate: (u) => navigated.push(u), newId: () => crypto.randomUUID() })));
  await tick(300);
  const notice = div.querySelector("[data-saved-methods-notice]")?.textContent ?? null;
  div.querySelector("[data-saved-method-remove]").click(); await tick(80);
  const afterOpenConfirm = calls.filter((c) => c.startsWith("POST")).length;
  div.querySelector("[data-saved-method-execute]").click(); await tick(300);
  const afterRemove = calls.slice();
  div.querySelector("[data-saved-methods-consent]").click(); await tick(50);
  div.querySelector("[data-saved-methods-setup]").click(); await tick(200);
  const navigatedBeforeClick = navigated.length;
  const heights = [...div.querySelectorAll("button, label")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  div.querySelector("[data-saved-methods-open]").click(); await tick(50);
  return { notice, afterOpenConfirm, afterRemove, navigatedBeforeClick, navigated, heights, stored: [...map.values()], overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
`;
test("panneau monté (Chromium, StrictMode) : suppression après confirmation seulement, Stripe ouvert seulement au clic, retour ⇒ relecture, 44 px", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const r = (await page.evaluate((s: string) => (window as unknown as { run: (x: string) => Promise<unknown> }).run(s), "?saved_methods=returned")) as { notice: string; afterOpenConfirm: number; afterRemove: string[]; navigatedBeforeClick: number; navigated: string[]; heights: number[]; stored: string[]; overflow: number };
    assert.match(r.notice, /Un retour ne prouve pas qu’une carte a été enregistrée/);
    same(r.afterOpenConfirm, 0, "opening the confirmation posts nothing");
    same(r.afterRemove.filter((c) => c.startsWith("POST")), ["POST:remove"]);
    same([r.navigatedBeforeClick, r.navigated], [0, [STRIPE_REAL]], "Stripe opened only on the explicit click, with the exact URL (fragment kept)");
    assert.ok(r.heights.every((x) => x >= 44), `targets ${r.heights.join(",")}`);
    assert.ok(r.stored.every((v) => !v.includes("checkout.stripe.com") && !v.includes("fid")), "the URL is never persisted");
    assert.ok(r.overflow <= 0);
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo client « Mon profil ») : note honnête, aucun appel /api, pas de débordement à 390, cibles 44 px", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client-profile", 390);
    const r = await page.evaluate(() => ({ note: document.querySelector('[data-saved-methods="demo"]')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.match(r.note ?? "", /aucune banque n’est contactée/);
    same([r.overflow <= 0, api, errors], [true, [], []]);
    await page.context().close();
  });
});
