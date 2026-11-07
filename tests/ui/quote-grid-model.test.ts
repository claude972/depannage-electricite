// ENT-13 contract quote grid — real model functions + SSR of the real components (strict browser
// copy of the e829877 / 737182d schemas).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/quote-grid/model";

const m = loadModule("components/features/quote-grid/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/quote-grid/quote-grid.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const U = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = U("1", 1), JOB = U("2", 1), GRID = U("6", 1), GRID2 = U("6", 2), QUOTE = U("3", 1);
const TOKEN = "a".repeat(64);
const AT = "2026-11-07T10:00:00.000Z";
const grid = (over: Record<string, unknown> = {}) => ({ id: GRID, label: "Contrat 2026", version: 3, lines: [{ index: 0, label: "Déplacement", unit: "visit", unit_price_cents: 4500 }, { index: 1, label: "Main-d’œuvre", unit: "hour", unit_price_cents: 6000 }], ...over });
const options = (over: Record<string, unknown> = {}) => ({ current: null, grids: [grid()], next_cursor: null, ...over });
const env = { version: 4, assignment_token: TOKEN, current_quote_id: null };
const applied = (over: Record<string, unknown> = {}, draft: Record<string, unknown> = {}) => ({ version: 5, assignment_token: TOKEN, current_quote_id: null, draft: { intervention_id: JOB, artisan_id: USER, version: 5, assignment_token: TOKEN, base_quote_id: null, lines: [{ label: "Déplacement", quantity: 1, unit_price_cents: 4500 }], tax_rate: 8.5, updated_at: AT, ...draft }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });

test("lecture stricte : grilles (lignes uniques, unités du contrat), source, accès propriétaire ; réponse d’application = enveloppe exacte", () => {
  assert.ok(m.parseOptions(options(), null));
  for (const bad of [{ ...options(), extra: 1 }, options({ grids: [grid(), grid()] }), options({ grids: [grid({ lines: [{ index: 0, label: "A", unit: "visit", unit_price_cents: 1 }, { index: 0, label: "B", unit: "visit", unit_price_cents: 1 }] })] }), options({ grids: [grid({ lines: [{ index: 0, label: "A", unit: "day", unit_price_cents: 1 }] })] }), options({ grids: [grid({ lines: [] })] })])
    assert.equal(m.parseOptions(bad, null), null, JSON.stringify(bad).slice(0, 80));
  const body = m.buildApply(m.parseOptions(options(), null)!.grids[0], { 0: "1", 1: "" }, env, 8.5)!;
  same(body, { grid_id: GRID, grid_version: 3, selection: [{ index: 0, quantity: 1 }], expected_version: 4, assignment_token: TOKEN, base_quote_id: null, tax_rate: 8.5 });
  same([m.buildApply(m.parseOptions(options(), null)!.grids[0], {}, env, null), m.buildApply(m.parseOptions(options(), null)!.grids[0], { 0: "1001" }, env, null)], [null, null]);
  assert.ok(m.parseApplied(applied(), JOB, USER, body));
  for (const [o, d] of [[{ version: 6 }, {}], [{}, { version: 6 }], [{ assignment_token: "b".repeat(64) }, {}], [{}, { intervention_id: U("2", 9) }], [{}, { artisan_id: U("1", 9) }], [{}, { tax_rate: 7 }], [{ extra: 1 }, {}]] as const)
    assert.equal(m.parseApplied(applied(o, d), JOB, USER, body), null, JSON.stringify([o, d]));
  same(m.parseSource({ source: { grid_id: GRID, grid_version: 3, grid_label: "Contrat 2026" } }), { grid_id: GRID, grid_version: 3, grid_label: "Contrat 2026" });
  same([m.parseSource({ source: null }), m.parseSource({ source: null, extra: 1 })], [null, undefined]);
  assert.ok(m.parseAccess({ grid_id: GRID, version: 2, grids: [{ id: GRID, label: "Contrat 2026", version: 3 }], next_cursor: null }, null));
  same(m.parseAccess({ grid_id: GRID, version: null, grids: [], next_cursor: null }, null), null);
  assert.ok(m.pendingKey(USER, 0, JOB).startsWith("courant-private-quote-grid:"));
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0, JOB).startsWith(p)), "covered by the central purge");
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
const access = (over: Record<string, unknown> = {}) => ({ grid_id: null, version: null, grids: [{ id: GRID, label: "Contrat 2026", version: 3 }, { id: GRID2, label: "Contrat bureaux", version: 1 }], next_cursor: null, ...over });
const accessReceipt = (c: Model.AccessCommand, over: Record<string, unknown> = {}) => res(200, { grid_id: c.grid_id, version: (c.expected_version ?? 0) + 1, replayed: false, ...over });
function harness({ reads = [] as Model.Result[], posts = [] as ((c: Model.AccessCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [U("c", 1), U("c", 2)], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; cmd?: Model.AccessCommand; stored?: string | null }[] = [];
  let s: Model.AccessState = { ...m.ACCESS_INITIAL };
  const api = { options: async () => res(200), apply: async () => res(200), source: async () => res(200), access: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, access())), setAccess: async (_j: string, cmd: Model.AccessCommand) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen, JOB)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) };
  const c = m.createAccessController({ api: () => api, interventionId: JOB, store: () => store, newId: () => ids.shift() ?? null, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => s, set: (n) => (s = n) });
  return { c, calls, ctx, get: () => s };
}

test("propriétaire : autoriser (version null) puis retirer (version GET) ; écrit et relu AVANT le POST ; grille hors liste / stockage KO ⇒ 0 POST", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, reads: [res(200, access()), res(200, access({ grid_id: GRID, version: 1 })), res(200, access({ version: 2 }))], posts: [accessReceipt, accessReceipt] });
  await h.c.load();
  assert.equal(await h.c.attach(GRID), true);
  const p1 = h.calls.find((x) => x.kind === "POST")!;
  same([p1.cmd, JSON.parse(p1.stored!).command], [{ command_id: U("c", 1), grid_id: GRID, expected_version: null }, p1.cmd]);
  assert.equal(await h.c.detach(), true);
  same([h.calls.filter((x) => x.kind === "POST")[1].cmd, mem.map.size, h.get().notice], [{ command_id: U("c", 2), grid_id: null, expected_version: 1 }, 0, m.COPY.detached]);
  const x = harness();
  await x.c.load();
  same([await x.c.attach(U("6", 9)), await x.c.detach(), x.calls.map((c) => c.kind)], [false, false, ["GET"]]);
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const y = harness({ store });
    await y.c.load();
    same([await y.c.attach(GRID), y.calls.map((c) => c.kind), y.get().error], [false, ["GET"], m.COPY.storage]);
  }
});

test("propriétaire : 503 ⇒ même commande ; restauration stricte jamais envoyée seule ; 409 ⇒ relecture sans rejeu ; identité changée ⇒ aucun rejeu ; 401/403 ⇒ effacé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.QG_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.attach(GRID); await a.c.retry();
  same(a.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd)), Array(2).fill(JSON.stringify({ command_id: U("c", 1), grid_id: GRID, expected_version: null })));
  const b = harness({ store: mem.store, posts: [(c) => accessReceipt(c, { replayed: true })] });
  b.c.restorePending();
  await b.c.load();
  same([b.get().pending?.command_id, b.calls.map((x) => x.kind)], [U("c", 1), ["GET"]]);
  await b.c.retry();
  same([b.get().notice, mem.map.size], [m.COPY.replayed, 0]);
  const k = memStore();
  const c = harness({ store: k.store, posts: [() => res(409)], reads: [res(200, access()), res(200, access({ grid_id: GRID2, version: 1 }))] });
  await c.c.load(); await c.c.attach(GRID);
  same([c.get().error, c.get().pending, k.map.size, c.calls.map((x) => x.kind), c.get().data!.grid_id], [m.COPY.conflict, null, 0, ["GET", "POST", "GET"], GRID2]);
  same(await c.c.retry(), false);
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.attach(GRID);
  g.ctx.gen = 1;
  release(accessReceipt({ command_id: U("c", 1), grid_id: GRID, expected_version: null }));
  same([await p, g.get().notice], [false, ""]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.attach(GRID);
  r.ctx.uid = U("1", 2);
  same([await r.c.retry(), r.get().pending], [false, null]);
  for (const s of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, posts: [() => res(s)] });
    await f.c.load(); await f.c.attach(GRID);
    same([f.get().phase, f.get().data, mm.map.size], ["forbidden", null, 0], String(s));
  }
});

test("rendus : accès propriétaire seulement (sinon rien) ; source « Basé sur la grille X version N » seulement si le serveur le dit ; démo sans appel ; câblage", () => {
  const ctx = { generation: () => 0, userId: () => USER };
  same(renderToString(createElement(ui.QuoteGridAccessPanel, { interventionId: JOB, context: ctx, initial: { ...m.ACCESS_INITIAL, phase: "forbidden" } })), "");
  const owner = text(renderToString(createElement(ui.QuoteGridAccessPanel, { interventionId: JOB, context: ctx, initial: { ...m.ACCESS_INITIAL, phase: "ready", data: m.parseAccess(access({ grid_id: GRID, version: 2 }), null) } })));
  assert.match(owner, /Contrat 2026 \(version 3\) · autorisation version 2/);
  assert.match(owner, /voit uniquement la grille que vous autorisez ici/);
  assert.match(text(renderToString(createElement(ui.ContractSourceLine, { quoteId: QUOTE, initial: { grid_id: GRID, grid_version: 3, grid_label: "Contrat 2026" } }))), /Basé sur la grille Contrat 2026 version 3/);
  same(renderToString(createElement(ui.ContractSourceLine, { quoteId: QUOTE, initial: null })), "");
  let calls = 0;
  const api = { options: async () => (calls++, res(200)), apply: async () => (calls++, res(200)), source: async () => (calls++, res(200)), access: async () => (calls++, res(200)), setAccess: async () => (calls++, res(200)) };
  renderToString(createElement(ui.ContractSourceLine, { quoteId: QUOTE, demo: true, api }));
  assert.match(renderToString(createElement(ui.QuoteGridAccessPanel, { interventionId: JOB, context: ctx, demo: true, api })), /aucune grille contractuelle n’est lue ni autorisée/);
  same(renderToString(createElement(ui.QuoteGridPicker, { interventionId: JOB, artisanId: USER, envelope: { ...env, draft: null }, taxRate: null, dirty: false, disabled: false, demo: true, api, onApplied() {}, onCurrent() {}, onConflict() {} })), "");
  same(calls, 0);
  const picker = text(renderToString(createElement(ui.QuoteGridPicker, { interventionId: JOB, artisanId: USER, envelope: { ...env, draft: null }, taxRate: null, dirty: false, disabled: false, initial: m.parseOptions(options(), null), onApplied() {}, onCurrent() {}, onConflict() {} })));
  assert.match(picker, /Grille contractuelle du client : Contrat 2026 \(version 3\)/);
  assert.match(text(renderToString(createElement(ui.QuoteGridPicker, { interventionId: JOB, artisanId: USER, envelope: { ...env, draft: null }, taxRate: null, dirty: false, disabled: false, initial: null, onApplied() {}, onCurrent() {}, onConflict() {} }))), /Aucune grille contractuelle n’est autorisée pour ce dossier/);
  const draftSrc = readFileSync("components/role/artisan-quote-draft.tsx", "utf8");
  assert.match(draftSrc, /disabled=\{locked \|\| !saveValid \|\| gridLinked\}/);
  assert.match(draftSrc, /const gridLinked = !!gridLink && !!envelope && envelope\.version === gridLink\.version && !dirty;/);
  assert.match(draftSrc, /onApplied=\{\(env, source\) => \{\s*applyEnvelope\(env, true\);/);
  assert.match(draftSrc, /if \(dirty\) \{\s*const saved = await save\(envelope\);/, "send saves only when dirty");
  for (const f of ["components/role/client-space.tsx", "components/role/artisan-space.tsx", "components/role/enterprise-space.tsx"]) assert.match(readFileSync(f, "utf8"), /<ContractSourceLine key=\{\w+\.id\} quoteId=\{\w+\.id\} demo=/, f);
  assert.match(readFileSync("components/role/enterprise-space.tsx", "utf8"), /<QuoteGridAccessPanel interventionId=\{intervention\.id\} context=\{session\.mutationContext\} demo=\{demo\} \/>/);
});
