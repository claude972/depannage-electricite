// ADM-10 corrective dossier of a warranty case (backend ef31206; strict copies, injected api).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Model from "../../components/features/warranty-corrective/model";

const m = loadModule("components/features/warranty-corrective/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/warranty-corrective/warranty-corrective-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const USER = "10000000-0000-4000-8000-000000000001";
const CASE = "c1000000-0000-4000-8000-000000000001";
const JOB = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-11-07T10:00:00.000Z";
const dossier = (n: number, over: Record<string, unknown> = {}) => ({ id: JOB(n), category: "panel", status: "requested", created_at: AT, ...over });
const state = (over: Record<string, unknown> = {}) => ({ link: null, candidates: [dossier(2), dossier(3)], has_more: false, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
const kase = (status = "reviewing") => ({ id: CASE, intervention_id: JOB(1), status, created_at: AT });
function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ reads = [] as Model.Result[], posts = [] as ((t: string) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; target?: string; stored?: string | null }[] = [];
  let v: Model.CaseView = { ...m.CASE_INITIAL };
  const c = m.createCaseController({
    api: () => ({ cases: async () => res(200, { cases: [] }), read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, state())), link: async (_c, t) => (calls.push({ kind: "POST", target: t, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen, CASE)) ?? null }), (posts.shift() ?? (() => res(503)))(t)) }),
    caseId: CASE, store: () => store, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => v, set: (n) => (v = n),
  });
  return { c, calls, ctx, get: () => v };
}
const linked = (t: string, replayed = false) => res(200, { link: dossier(Number(t.slice(-2)), { id: t }), replayed });

test("lecture stricte (ef31206) : catégories / statuts du contrat, 30 candidats max, sans doublon ; reçu du POST pour la cible exacte", () => {
  assert.ok(m.parseCorrective(state()));
  assert.ok(m.parseCorrective(state({ link: dossier(2), candidates: [] })));
  for (const bad of [{}, { ...state(), extra: 1 }, state({ candidates: [dossier(2), dossier(2)] }), state({ candidates: Array.from({ length: 31 }, (_, i) => dossier(i + 10)) }), state({ link: dossier(2, { category: "plumbing" }) }), state({ candidates: [dossier(2, { status: "paid_out" })] }), state({ candidates: [{ ...dossier(2), total_cents: 100 }] })])
    assert.equal(m.parseCorrective(bad), null, JSON.stringify(bad).slice(0, 80));
  same(m.parseReceipt({ link: dossier(2), replayed: true }, JOB(2))?.replayed, true);
  assert.equal(m.parseReceipt({ link: dossier(3), replayed: false }, JOB(2)), null);
  assert.equal(m.parseReceipt({ link: dossier(2), replayed: false, price: 1 }, JOB(2)), null);
  same(m.parseCases({ cases: [{ ...kase(), description: "x", resolution: null, terms_version: 2 }], enabled: true }), [kase()]);
});

test("candidats pour super admin seulement ; « d’autres dossiers existent » ; bloqué hors « En cours d’examen » avec la raison ; jamais de prix", () => {
  const ready = { ...m.CASE_INITIAL, phase: "ready", data: m.parseCorrective(state({ has_more: true })) } as Model.CaseView;
  const props = (superAdmin: boolean, status = "reviewing") => ({ context: { generation: () => 0, userId: () => USER }, superAdmin, onOpenDossier: () => {}, initialCases: [kase(status)], initial: { [CASE]: ready } });
  const sa = renderToString(createElement(ui.WarrantyCorrectivePanel, props(true)));
  assert.match(sa, new RegExp(`data-corrective-candidate="${JOB(2)}"`));
  assert.match(text(sa), /D’autres dossiers existent : seuls les premiers sont affichés\./);
  assert.match(sa, /data-corrective-pick="[^"]+"(?![^>]*disabled)/);
  const other = renderToString(createElement(ui.WarrantyCorrectivePanel, props(false)));
  assert.doesNotMatch(other, /data-corrective-candidates|data-corrective-pick|data-corrective-other/);
  assert.match(text(other), /proposés aux super-administrateurs uniquement/);
  const blocked = renderToString(createElement(ui.WarrantyCorrectivePanel, props(true, "submitted")));
  assert.match(text(blocked), /Rattachement possible seulement quand la demande est « En cours d’examen »/);
  for (const b of blocked.match(/<button[^>]*data-corrective-(pick|other-pick)[^>]*>/g) ?? []) assert.match(b, /disabled=""/);
  assert.doesNotMatch(text(sa + other + blocked), /€|prix (du|de la)|Payer|payé/i);
  assert.match(m.COPY.confirm("ABC", "DEF"), /Aucun dossier ni devis n’est créé automatiquement, aucun prix ni paiement\./);
});

test("route du dossier : « Ouvrir » appelle onOpenDossier avec l’id exact, câblé sur la vue admin « detail » (#detail/<id>)", () => {
  const ready = { ...m.CASE_INITIAL, phase: "ready", data: m.parseCorrective(state({ link: dossier(4), candidates: [] })) } as Model.CaseView;
  const html = renderToString(createElement(ui.WarrantyCorrectivePanel, { context: { generation: () => 0, userId: () => USER }, superAdmin: true, onOpenDossier: () => {}, initialCases: [kase()], initial: { [CASE]: ready } }));
  assert.match(html, new RegExp(`data-corrective-open="${JOB(4)}"`));
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /<WarrantyCorrectivePanel[\s\S]{0,300}onOpenDossier=\{\(id\) => go\("detail", id\)\}/);
  assert.match(admin, /case "detail":\s*content = renderDossier\(session\.param\);/);
  assert.doesNotMatch(admin, /"admin-intervention"/, "no such admin route: the dossier view is #detail/<id>");
  const session = loadModule("components/app/session.ts") as { buildHash: (v: string, p?: string) => string };
  same(session.buildHash("detail", JOB(4)), `detail/${JOB(4)}`);
});

test("rattachement : commande écrite et relue AVANT le POST, puis relecture ; autre dossier éligible envoyé tel quel ; déjà lié", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, reads: [res(200, state()), res(200, state({ link: dossier(2), candidates: [] }))], posts: [(t) => linked(t)] });
  await h.c.load();
  assert.equal(await h.c.link(true, "reviewing", JOB(2)), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same([post.target, JSON.parse(post.stored!)], [JOB(2), { uid: USER, gen: 0, case_id: CASE, intervention_id: JOB(2) }]);
  same([h.calls.map((c) => c.kind), mem.map.size, h.get().notice], [["GET", "POST", "GET"], 0, m.COPY.saved]);
  const other = harness({ reads: [res(200, state()), res(200, state({ link: dossier(9), candidates: [] }))], posts: [(t) => linked(t, true)] });
  await other.c.load();
  await other.c.link(true, "reviewing", JOB(9)); // not a listed candidate: the server decides
  same([other.calls[1].target, other.get().notice], [JOB(9), m.COPY.replayed]);
  for (const [sa, status, data] of [[false, "reviewing", state()], [true, "submitted", state()], [true, "resolved", state()], [true, "reviewing", state({ link: dossier(2), candidates: [] })]] as const) {
    const x = harness({ reads: [res(200, data)] });
    await x.c.load();
    assert.equal(await x.c.link(sa, status, JOB(2)), false, `${sa} ${status}`);
    same(x.calls.map((c) => c.kind), ["GET"]);
  }
  const bad = harness();
  await bad.c.load();
  assert.equal(await bad.c.link(true, "reviewing", "pas-un-uuid"), false);
  for (const store of [null, { get: () => null, set: () => { throw new Error("quota"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.c.load();
    assert.equal(await x.c.link(true, "reviewing", JOB(2)), false);
    same([x.calls.map((c) => c.kind), x.get().error], [["GET"], m.COPY.storage]);
  }
});

test("réponse perdue / 503 / reçu non conforme ⇒ même commande ; 409 ⇒ relecture sans rejeu ; identité changée ⇒ aucun rejeu ; 401/403 ⇒ tout effacé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.WC_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.link(true, "reviewing", JOB(2)); await a.c.retry();
  same(a.calls.filter((c) => c.kind === "POST").map((c) => c.target), [JOB(2), JOB(2)]);
  const b = harness({ store: mem.store, reads: [res(200, state()), res(200, state({ link: dossier(2), candidates: [] }))], posts: [(t) => linked(t)] });
  b.c.restorePending();
  await b.c.load();
  same([b.get().pending, b.calls.map((c) => c.kind)], [JOB(2), ["GET"]], "restored, never sent by itself");
  await b.c.retry();
  same([b.calls[1].target, mem.map.size], [JOB(2), 0]);
  const odd = harness({ posts: [() => res(200, { link: dossier(3), replayed: false })] });
  await odd.c.load(); await odd.c.link(true, "reviewing", JOB(2));
  same([odd.get().pending, odd.get().error], [JOB(2), m.COPY.retry]);
  const k = memStore();
  const c = harness({ store: k.store, posts: [() => res(409)], reads: [res(200, state()), res(200, state({ link: dossier(3), candidates: [] }))] });
  await c.c.load(); await c.c.link(true, "reviewing", JOB(2));
  same([c.get().error, c.get().pending, k.map.size, c.calls.map((x) => x.kind), c.get().data!.link!.id], [m.COPY.conflict, null, 0, ["GET", "POST", "GET"], JOB(3)]);
  assert.equal(await c.c.retry(), false);
  const u = harness({ posts: [() => res(422)] });
  await u.c.load(); await u.c.link(true, "reviewing", JOB(9));
  same([u.get().error, u.get().pending], [m.COPY.invalid, null]);
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.link(true, "reviewing", JOB(2));
  g.ctx.gen = 1;
  release(res(503));
  assert.equal(await p, false);
  same([g.get().pending, g.get().notice], [null, ""]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.link(true, "reviewing", JOB(2));
  r.ctx.uid = "10000000-0000-4000-8000-000000000002";
  assert.equal(await r.c.retry(), false);
  same([r.get().pending, r.calls.filter((x) => x.kind === "POST").length], [null, 1]);
  mem.map.set(m.pendingKey(USER, 1, CASE), JSON.stringify({ uid: USER, gen: 0, case_id: CASE, intervention_id: JOB(2) }));
  const other = harness({ store: mem.store, ctx: { uid: USER, gen: 1 } });
  other.c.restorePending();
  same([other.get().pending, mem.map.has(m.pendingKey(USER, 1, CASE))], [null, false]);
  for (const status of [401, 403]) {
    const s = memStore();
    const f = harness({ store: s.store, posts: [() => res(status)] });
    await f.c.load(); await f.c.link(true, "reviewing", JOB(2));
    same([f.get().phase, f.get().data, f.get().pending, s.map.size], ["forbidden", null, null, 0], String(status));
  }
});

test("POST seulement après confirmation explicite (source) ; démo zéro appel ; jetons, 44px", async () => {
  const view = readFileSync("components/features/warranty-corrective/warranty-corrective-panel.tsx", "utf8");
  const calls = view.match(/ctrl\.current\?\.link\(/g) ?? [];
  same(calls.length, 1, "a single link call site");
  assert.match(view, /data-corrective-confirm=\{confirm\}[\s\S]{0,700}onClick=\{\(\) => void ctrl\.current\?\.link\(superAdmin, kase\.status, confirm\)/);
  assert.match(view, /onClick=\{\(\) => setConfirm\(c\.id\)\} data-corrective-pick/);
  let called = 0;
  const api = { cases: async () => (called++, res(200)), read: async () => (called++, res(200)), link: async () => (called++, res(200)) };
  const demo = renderToString(createElement(ui.WarrantyCorrectivePanel, { demo: true, context: { generation: () => 0, userId: () => USER }, superAdmin: true, onOpenDossier: () => {}, api }));
  assert.match(text(demo), /En démonstration, aucun dossier correctif n’est lu ni rattaché\./);
  same(called, 0);
  const css = readFileSync("components/features/warranty-corrective/warranty-corrective.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.button \{[^}]*min-height: 44px;/);
});

test("app réelle (démo admin « Garantie ») : panneau correctif honnête, aucun appel /api", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-admin-warranty", 390);
    const r = await page.evaluate(() => ({ hash: location.hash, demo: document.querySelector('[data-warranty-corrective="demo"]')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    same(r.hash, "#admin-warranty");
    assert.match(r.demo ?? "", /aucun dossier correctif n’est lu ni rattaché/);
    assert.ok(r.overflow <= 0);
    same([api, errors], [[], []]);
    await page.context().close();
  });
});
