// FIN-07 operator subscription catalog. Real model + SSR + a Chromium mount of the real panel (fake
// api) + real-app demo of the platform finance « Abonnements » tab.
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
import { withApp, skip as appSkip } from "./real-app-harness";
import type * as Model from "../../components/features/subscriptions-catalog/model";

const m = loadModule("components/features/subscriptions-catalog/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/subscriptions-catalog/catalog-panel.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[  ]/g, " ").replace(/\s+/g, " ");
const USER = "10000000-0000-4000-8000-000000000001";
const O1 = "33333333-3333-4333-8333-333333333333";
const CID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (over: Record<string, unknown> = {}) => ({ id: O1, version: 3, label: "Mensuel artisan", role: "artisan", amount_cents: 1990, currency: "eur", interval: "month", interval_count: 1, tax_behavior: "inclusive", active: true, price_id: "price_QA1", ...over });
const catalog = (over: Record<string, unknown> = {}) => ({ mode: "test", configured_mode: "test", can_write: true, catalog_enabled: true, offers: [offer()], ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
const publicReply = { offer: { id: O1, version: 4, label: "Mensuel artisan", role: "artisan", amount_cents: 1990, currency: "eur", interval: "month", interval_count: 1, tax_behavior: "inclusive" }, active: true };
const draft = (over: Partial<Model.Draft> = {}): Model.Draft => ({ label: "Annuel client", role: "client", active: false, price_id: "price_QA2", ...over });

test("lecture stricte ; mode demandé = mode relu ; brouillon sans valeur par défaut ; purge centrale", () => {
  assert.ok(m.parseCatalog(catalog(), "test"));
  assert.ok(m.parseCatalog(catalog({ mode: "live", configured_mode: null, offers: [] }), "live"));
  for (const bad of [catalog({ extra: 1 }), catalog({ mode: "live" }), catalog({ configured_mode: "prod" }), catalog({ can_write: "yes" }), (({ catalog_enabled: _c, ...x }) => x)(catalog()), catalog({ offers: [offer({ price_id: "prod_1" })] }), catalog({ offers: [offer({ currency: "usd" })] }), catalog({ offers: [offer({ interval: "quarter" })] }), catalog({ offers: [offer({ amount_cents: 1.5 })] }), catalog({ offers: [offer({ active: undefined })] }), catalog({ offers: [offer({ secret: "x" })] }), catalog({ offers: [offer(), offer()] })])
    assert.equal(m.parseCatalog(bad, "test"), null, JSON.stringify(bad).slice(0, 120));
  same(m.amountText(offer() as Model.CatalogOffer), "19,90 € tous les mois · taxes incluses");
  same(m.EMPTY_DRAFT, { label: "", role: "", active: false, price_id: "" }, "no default offer / role / price");
  same(Object.keys(m.validateDraft(m.EMPTY_DRAFT)).sort(), ["label", "price_id", "role"]);
  same(m.validateDraft(draft()), {});
  same(Object.keys(m.validateDraft(draft({ price_id: "price_x y" }))), ["price_id"]);
  same([m.parseSaveReply(publicReply), m.parseSaveReply({ ...publicReply, extra: 1 }), m.parseSaveReply({ offer: { ...publicReply.offer, amount_cents: "1990" }, active: true })], [true, false, false]);
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0).startsWith(p)));
  assert.ok(m.pendingKey(USER, 0).startsWith("courant-private-subscriptions-catalog:"));
});

test("droits : écriture seulement si can_write ET mode affiché = mode configuré (et session inscriptible)", () => {
  const p = (o: Record<string, unknown>) => m.parseCatalog(catalog(o), (o.mode as Model.Mode) ?? "test");
  same([m.writable(p({})), m.writable(p({ can_write: false })), m.writable(p({ configured_mode: "live" })), m.writable(p({ configured_mode: null })), m.writable(p({ mode: "live", configured_mode: "live" })), m.writable(p({}), false), m.writable(null)], [true, false, false, false, true, false, false]);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ reads = [] as Model.Result[], saves = [] as ((c: Model.CatalogCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [CID(1), CID(2)], ctx: who = { uid: USER as string | null, gen: 0 }, writableSession = true } = {}) {
  const calls: { kind: string; mode?: string; cmd?: Model.CatalogCommand; stored?: string | null }[] = [];
  let drawn = 0;
  let s: Model.CatalogState = { ...m.CATALOG_INITIAL };
  const c = m.createCatalogController({
    api: () => ({ read: async (mode) => (calls.push({ kind: "GET", mode }), reads.shift() ?? res(200, catalog({ mode }))), save: async (cmd) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(who.uid, who.gen)) ?? null }), (saves.shift() ?? (() => res(503)))(cmd)) }),
    store: () => store,
    newId: () => (drawn++, ids.shift() ?? null),
    context: { generation: () => who.gen, userId: () => who.uid },
    sessionWritable: () => writableSession,
    get: () => s,
    set: (n) => (s = n),
  });
  return { c, calls, ctx: who, get: () => s, drawn: () => drawn };
}

test("mode : GET avec ?mode ; changement de mode relu ; bloqué pendant une commande incertaine", async () => {
  let seen = "";
  const api = m.createCatalogApi((async (url: string) => ((seen = url), { status: 200, json: async () => catalog() })) as unknown as typeof fetch);
  await api.read("live");
  same(seen, "/api/subscriptions/offers?mode=live");
  const h = harness({ reads: [res(200, catalog()), res(200, catalog({ mode: "live", configured_mode: "test" }))] });
  await h.c.load();
  await h.c.selectMode("live");
  same([h.calls.map((x) => x.mode), h.get().mode, h.get().catalog?.mode, m.writable(h.get().catalog)], [["test", "live"], "live", "live", false]);
  const lied = harness({ reads: [res(200, catalog({ mode: "test" }))] });
  await lied.c.load("live");
  same(lied.get().phase, "error", "a reply for another mode is refused");
});

test("enregistrement : corps exact sans montant ; écrit et relu AVANT le POST ; relecture après succès ; préconditions avant l’identifiant", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, saves: [() => res(200, publicReply)], reads: [res(200, catalog()), res(200, catalog({ offers: [offer({ version: 4 })] }))] });
  await h.c.load();
  same(await h.c.save(offer() as Model.CatalogOffer, draft({ label: "  Mensuel artisan  ", role: "artisan", active: true, price_id: "price_QA1" })), true);
  const post = h.calls.find((x) => x.kind === "POST")!;
  same(post.cmd, { mode: "test", command_id: CID(1), id: O1, expected_version: 3, label: "Mensuel artisan", role: "artisan", active: true, price_id: "price_QA1" }, "exact body, expected_version = shown version, no amount");
  for (const k of ["amount_cents", "currency", "interval", "interval_count", "tax_behavior"]) assert.ok(!(k in post.cmd!), k);
  same(JSON.parse(post.stored!).command, post.cmd, "persisted before the POST");
  same([h.calls.map((x) => x.kind), h.get().notice, h.get().catalog?.offers[0].version, mem.map.size], [["GET", "POST", "GET"], m.COPY.saved, 4, 0]);
  const create = harness({ saves: [() => res(200, publicReply)] });
  await create.c.load();
  await create.c.save(null, draft());
  same(create.calls.find((x) => x.kind === "POST")!.cmd, { mode: "test", command_id: CID(1), id: null, expected_version: 0, label: "Annuel client", role: "client", active: false, price_id: "price_QA2" });
  for (const [over, d, session] of [[{ can_write: false }, draft(), true], [{ configured_mode: "live" }, draft(), true], [{ configured_mode: null }, draft(), true], [{}, m.EMPTY_DRAFT, true], [{}, draft({ role: "" }), true], [{}, draft(), false]] as [Record<string, unknown>, Model.Draft, boolean][]) {
    const g = harness({ reads: [res(200, catalog(over))], writableSession: session });
    await g.c.load();
    same([await g.c.save(null, d), g.drawn(), g.calls.map((x) => x.kind)], [false, 0, ["GET"]], JSON.stringify([over, d, session]));
  }
  const stale = harness();
  await stale.c.load();
  same([await stale.c.save(offer({ version: 2 }) as Model.CatalogOffer, draft()), stale.drawn()], [false, 0], "only the shown version");
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.c.load();
    same([await x.c.save(null, draft()), x.calls.map((c) => c.kind), x.get().error], [false, ["GET"], m.COPY.storage]);
  }
});

test("réponse perdue / 5xx ⇒ même commande + relecture ; 409 ⇒ relecture sans rejeu ; identité changée ⇒ aucun rejeu ; restauration jamais envoyée seule ; 401/403 ⇒ tout effacé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, saves: [() => res(m.CATALOG_TIMEOUT), () => res(502), () => res(200, publicReply)] });
  await a.c.load(); await a.c.save(null, draft());
  same([a.get().pending?.command_id, a.calls.map((x) => x.kind), a.get().error], [CID(1), ["GET", "POST", "GET"], m.COPY.retry], "lost reply ⇒ re-read, command kept");
  same(await a.c.save(null, draft({ label: "Autre" })), false, "no new command while one is uncertain");
  await a.c.retry();
  const sent = a.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd));
  same([sent.length, new Set(sent).size, JSON.parse(sent[0]).command_id], [2, 1, CID(1)], "the SAME command");
  const b = harness({ store: mem.store, saves: [() => res(200, publicReply)] });
  same(b.c.restorePending(), "test");
  await b.c.load();
  same([b.get().pending?.command_id, b.calls.map((x) => x.kind)], [CID(1), ["GET"]], "restored, never sent by itself");
  same(await b.c.retry(), true);
  same([b.get().pending, mem.map.size], [null, 0]);
  const conflict = harness({ reads: [res(200, catalog()), res(200, catalog({ offers: [offer({ version: 5, label: "Changé" })] }))], saves: [() => res(409)] });
  await conflict.c.load(); await conflict.c.save(offer() as Model.CatalogOffer, draft());
  same([conflict.get().error, conflict.get().pending, conflict.calls.map((x) => x.kind), conflict.get().catalog?.offers[0].version], [m.COPY.conflict, null, ["GET", "POST", "GET"], 5]);
  same(await conflict.c.retry(), false, "409 ⇒ nothing to replay");
  let release!: (r: Model.Result) => void;
  const g = harness({ saves: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.save(null, draft());
  g.ctx.gen = 1;
  release(res(200, publicReply));
  same([await p, g.get().notice, g.calls.filter((x) => x.kind === "GET").length], [false, "", 1], "identity changed ⇒ no follow-up");
  const r = harness({ saves: [() => res(503)] });
  await r.c.load(); await r.c.save(null, draft());
  r.ctx.uid = "10000000-0000-4000-8000-000000000002";
  same([await r.c.retry(), r.get().pending], [false, null], "no replay after an identity change");
  mem.map.set(m.pendingKey(USER, 1), JSON.stringify({ uid: USER, gen: 0, command: JSON.parse(sent[0]) }));
  const other = harness({ store: mem.store, ctx: { uid: USER, gen: 1 } });
  same([other.c.restorePending(), mem.map.has(m.pendingKey(USER, 1))], [null, false]);
  for (const st of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, saves: [() => res(st)] });
    await f.c.load(); await f.c.save(null, draft());
    same([f.get().phase, f.get().catalog, mm.map.size], ["forbidden", null, 0], String(st));
  }
  const forb = harness({ reads: [res(403)] });
  await forb.c.load();
  same(forb.get().phase, "forbidden");
});

test("rendu : modes visibles, écart de mode, lecture seule, service désactivé, vide, montant en lecture seule, aucun bouton d’activation ; démo sans appel ; montage de l’onglet", async () => {
  const ctx = { generation: () => 0, userId: () => USER };
  const view = (over: Record<string, unknown> = {}, session = true) => renderToString(createElement(ui.SubscriptionsCatalogPanel, { demo: false, canRead: true, sessionWritable: session, context: ctx, initial: { ...m.CATALOG_INITIAL, mode: (over.mode as Model.Mode) ?? "test", phase: "ready", catalog: m.parseCatalog(catalog(over), (over.mode as Model.Mode) ?? "test") } }));
  const ok = view();
  assert.match(text(ok), /Mode affiché Test/);
  assert.match(text(ok), /Mode configuré sur le serveur Test/);
  assert.match(text(ok), /Mensuel artisan .*Artisan .*Active .*price_QA1 .*19,90 € tous les mois · taxes incluses/);
  assert.match(ok, /data-catalog-edit=/);
  assert.match(ok, /data-catalog-create=/);
  assert.doesNotMatch(ok, /<input[^>]*amount/i, "no amount input");
  const mismatch = view({ mode: "live", configured_mode: "test" });
  assert.match(text(mismatch), /Le mode affiché \(Live\) n’est pas le mode configuré sur le serveur \(Test\) : lecture seule\./);
  assert.doesNotMatch(mismatch, /data-catalog-edit|data-catalog-create|data-catalog-form/);
  assert.match(text(view({ configured_mode: null })), /Aucun mode n’est configuré sur le serveur : lecture seule\./);
  assert.doesNotMatch(view({ configured_mode: null }), /data-catalog-edit|data-catalog-create/);
  const ro = view({ can_write: false });
  assert.match(text(ro), /Lecture seule : votre habilitation ne permet pas de modifier le catalogue\./);
  assert.doesNotMatch(ro, /data-catalog-edit|data-catalog-create/);
  assert.doesNotMatch(view({}, false), /data-catalog-edit|data-catalog-create/, "read-only session");
  const off = view({ catalog_enabled: false });
  assert.match(text(off), /Offres non publiées tant que le service est désactivé\./);
  assert.doesNotMatch(text(off), /Activer|Publier|Désactiver le service/);
  assert.match(text(view({ offers: [] })), /Aucune offre dans ce mode\./);
  const forbidden = renderToString(createElement(ui.SubscriptionsCatalogPanel, { demo: false, canRead: true, sessionWritable: true, context: ctx, initial: { ...m.CATALOG_INITIAL, phase: "forbidden" } }));
  assert.match(text(forbidden), /ne permet pas de consulter le catalogue/);
  same(renderToString(createElement(ui.SubscriptionsCatalogPanel, { demo: false, canRead: false, sessionWritable: true, context: ctx })), "");
  let calls = 0;
  const api = { read: async () => (calls++, res(200)), save: async () => (calls++, res(200)) };
  assert.match(text(renderToString(createElement(ui.SubscriptionsCatalogPanel, { demo: true, canRead: true, sessionWritable: false, context: ctx, api }))), /aucun catalogue n’est lu ni modifié/);
  same(calls, 0);
  const src = readFileSync("components/features/subscriptions-catalog/catalog-panel.tsx", "utf8") + readFileSync("components/features/subscriptions-catalog/model.ts", "utf8");
  assert.doesNotMatch(src, /amount_cents:\s*(d|draft)\.|data-catalog-amount-input|catalog_enabled:\s*true|stripe\.com/);
  const fv = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
  assert.match(fv, /\{ id: "subscriptions", label: "Abonnements" \}/);
  assert.match(fv, /\(t\.id !== "subscriptions" \|\| demo \|\| me\.data\?\.super_admin \|\| me\.data\?\.scopes\.includes\("finance_read"\)\)/);
  assert.match(fv, /\{tab === "subscriptions" && <SubscriptionsCatalogPanel demo=\{Boolean\(demo\)\} canRead=\{me\.data\.super_admin \|\| me\.data\.scopes\.includes\("finance_read"\)\} sessionWritable=\{scope\.authority\.canWrite && !demo\} context=\{context\} \/>\}/);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SubscriptionsCatalogPanel } from "./components/features/subscriptions-catalog/catalog-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const offer = ${JSON.stringify(offer())};
w.run = async () => {
  const calls = [];
  let version = 3, first = true;
  const api = {
    read: async (mode) => (calls.push("GET:" + mode), { status: 200, body: { mode, configured_mode: "test", can_write: true, catalog_enabled: false, offers: [{ ...offer, version }] } }),
    save: async (cmd) => { calls.push("POST:" + JSON.stringify(cmd)); if (first) { first = false; return { status: 0, body: null }; } version++; return { status: 200, body: ${JSON.stringify(publicReply)} }; },
  };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(SubscriptionsCatalogPanel, { demo: false, canRead: true, sessionWritable: true, context: { generation: () => 0, userId: () => "${USER}" }, api, store, newId: () => crypto.randomUUID() })));
  await tick(300);
  const disabledNote = div.querySelector("[data-catalog-disabled]")?.textContent ?? null;
  div.querySelector("[data-catalog-create]").click(); await tick(50);
  const amountInputs = div.querySelectorAll("form input").length;
  div.querySelector("[data-catalog-submit]").click(); await tick(50);
  const postsInvalid = calls.filter((c) => c.startsWith("POST")).length;
  const errorsShown = div.querySelectorAll("form [aria-invalid=true]").length;
  const set = (el, v) => { const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
  set(div.querySelector("[data-catalog-label]"), "Annuel client");
  set(div.querySelector("[data-catalog-role]"), "client");
  set(div.querySelector("[data-catalog-price]"), "price_QA2");
  await tick(50);
  div.querySelector("[data-catalog-submit]").click(); await tick(300);
  const retryShown = !!div.querySelector("[data-catalog-retry]");
  const modeLocked = div.querySelector("[data-catalog-mode=live]").disabled;
  div.querySelector("[data-catalog-retry]").click(); await tick(300);
  const notice = div.querySelector("[data-catalog-notice]")?.textContent ?? null;
  div.querySelector("[data-catalog-mode=live]").click(); await tick(300);
  const mismatch = div.querySelector("[data-catalog-mismatch]")?.textContent ?? null;
  const liveButtons = div.querySelectorAll("[data-catalog-edit], [data-catalog-create]").length;
  const heights = [...div.querySelectorAll("button, select, input[type=text], input:not([type])")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  return { calls, disabledNote, amountInputs, postsInvalid, errorsShown, retryShown, modeLocked, notice, mismatch, liveButtons, heights, stored: [...map.values()], overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
`;
test("panneau monté (Chromium, StrictMode) : validation sans POST, réponse perdue ⇒ même commande, relecture, mode live non configuré ⇒ lecture seule, 44 px, 390 px", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as { calls: string[]; disabledNote: string; amountInputs: number; postsInvalid: number; errorsShown: number; retryShown: boolean; modeLocked: boolean; notice: string; mismatch: string; liveButtons: number; heights: number[]; stored: string[]; overflow: number };
    assert.match(r.disabledNote, /Offres non publiées tant que le service est désactivé/);
    same(r.amountInputs, 3, "label, price_id, active only — no amount input");
    same([r.postsInvalid, r.errorsShown], [0, 3], "empty form ⇒ errors, no POST");
    const posts = r.calls.filter((c) => c.startsWith("POST:")).map((c) => JSON.parse(c.slice(5)));
    same(posts.length, 2);
    same(posts[0], posts[1], "lost reply ⇒ the same command on retry");
    same(Object.keys(posts[0]), ["mode", "command_id", "id", "expected_version", "label", "role", "active", "price_id"]);
    same([posts[0].id, posts[0].expected_version, posts[0].label, posts[0].role, posts[0].active, posts[0].price_id], [null, 0, "Annuel client", "client", false, "price_QA2"]);
    same([r.retryShown, r.modeLocked], [true, true]);
    assert.match(r.notice, /Offre enregistrée/);
    assert.ok(r.calls.filter((c) => c === "GET:test").length >= 3, "re-read after lost reply and after success");
    assert.match(r.mismatch, /Le mode affiché \(Live\) n’est pas le mode configuré sur le serveur \(Test\)/);
    same(r.liveButtons, 0);
    same(r.stored, [], "command cleared after success");
    assert.ok(r.heights.every((x) => x >= 44), `targets ${r.heights.join(",")}`);
    assert.ok(r.overflow <= 0);
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : finance plateforme (démo) — onglet « Abonnements », note honnête, aucun /api, pas de débordement", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const width of [390, 1280]) {
      const { page, errors, api } = await open("admin-platform-finance", width);
      api.length = 0;
      await page.getByRole("tab", { name: "Abonnements" }).click();
      const panel = page.locator('[data-subscriptions-catalog="demo"]');
      await panel.waitFor();
      assert.match(await panel.innerText(), /aucun catalogue n’est lu ni modifié/);
      const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      assert.ok(overflow <= 0, `${width}: ${overflow}px`);
      same([api, errors], [[], []], String(width));
      await page.context().close();
    }
  });
});
