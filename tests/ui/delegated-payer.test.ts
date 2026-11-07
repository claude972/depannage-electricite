// ENT-16 delegated B2B payer (backend 3612a10; strict copy). Real model + SSR of the real leaf and
// of the EXISTING PlatformPayAction; real-app enterprise wiring in demo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Model from "../../components/features/delegated-payer/model";

const m = loadModule("components/features/delegated-payer/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/delegated-payer/delegated-payer.tsx") as Record<string, any>;
const pay = loadModule("components/app/platform-pay.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { purgePrivateStorage: (s: unknown) => string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const U = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = U("1", 1), JOB = U("2", 1), MEMBER = U("1", 7), OTHER = U("1", 8);
const status = (over: Record<string, unknown> = {}) => ({ intervention_id: JOB, payer_id: null, version: null, can_manage: true, can_checkout: false, delegate_current: false, external_session_pending: false, link: `/#detail/${JOB}`, ...over });
const res = (s: number, body: unknown = null) => ({ status: s, body });
const receipt = (c: Model.PayerCommand, over: Record<string, unknown> = {}) => res(200, { intervention_id: JOB, payer_id: c.payer_id, version: (c.expected_version ?? 0) + 1, replayed: false, ...over });
function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ reads = [] as Model.Result[], posts = [] as ((c: Model.PayerCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [U("c", 1), U("c", 2)], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; cmd?: Model.PayerCommand; stored?: string | null }[] = [];
  let v: Model.View = { ...m.VIEW_INITIAL };
  const c = m.createPayerController({
    api: () => ({ read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, status())), write: async (_j, cmd) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen, JOB)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) }),
    interventionId: JOB, store: () => store, newId: () => ids.shift() ?? null, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => v, set: (n) => (v = n),
  });
  return { c, calls, ctx, get: () => v };
}
const ctx = { generation: () => 0, userId: () => USER };

test("lecture stricte : portée exacte (dossier, lien sans secret, version / payeur cohérents) ; reçu de la commande exacte", () => {
  assert.ok(m.parseStatus(status(), JOB));
  for (const bad of [{ ...status(), extra: 1 }, status({ link: `/#detail/${JOB}?token=x` }), status({ link: "https://checkout.stripe.com/x" }), status({ intervention_id: U("2", 9) }), status({ payer_id: MEMBER, version: null }), status({ amount_cents: 1 })])
    assert.equal(m.parseStatus(bad, JOB), null, JSON.stringify(bad).slice(0, 80));
  const c = { command_id: U("c", 1), payer_id: MEMBER, expected_version: 2 };
  assert.ok(m.parseReceipt(receipt(c).body, JOB, c));
  for (const over of [{ version: 2 }, { payer_id: OTHER }, { intervention_id: U("2", 9) }, { extra: 1 }]) assert.equal(m.parseReceipt(receipt(c, over).body, JOB, c), null, JSON.stringify(over));
  same([m.delegatedCheckout(m.parseStatus(status({ delegate_current: true, can_checkout: true, payer_id: MEMBER, version: 1 }), JOB)), m.delegatedCheckout(m.parseStatus(status({ delegate_current: true, payer_id: MEMBER, version: 1 }), JOB)), m.delegatedCheckout(null)], [true, false, false]);
});

test("propriétaire : désigner (version null puis version GET), retirer (payer_id null) ; commande écrite et relue AVANT le POST, clé courant-private-payer: purgée", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, reads: [res(200, status()), res(200, status({ payer_id: MEMBER, version: 1 })), res(200, status({ payer_id: null, version: 2 }))], posts: [receipt, receipt] });
  await h.c.load();
  assert.equal(await h.c.grant(MEMBER), true);
  const first = h.calls.find((x) => x.kind === "POST")!;
  same([first.cmd, JSON.parse(first.stored!).command], [{ command_id: U("c", 1), payer_id: MEMBER, expected_version: null }, first.cmd]);
  assert.ok(m.pendingKey(USER, 0, JOB).startsWith("courant-private-payer:"));
  same(h.get().notice, m.COPY.granted);
  assert.equal(await h.c.revoke(), true);
  same(h.calls.filter((x) => x.kind === "POST")[1].cmd, { command_id: U("c", 2), payer_id: null, expected_version: 1 });
  same([mem.map.size, h.get().notice, h.get().status!.version], [0, m.COPY.revoked, 2]);
  const fake = new Map([[m.pendingKey(USER, 0, JOB), "x"], ["other", "y"]]);
  same(priv.purgePrivateStorage({ get length() { return fake.size; }, key: (i: number) => [...fake.keys()][i] ?? null, removeItem: (k: string) => void fake.delete(k) }), [m.pendingKey(USER, 0, JOB)]);
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.c.load();
    same([await x.c.grant(MEMBER), x.calls.map((c) => c.kind), x.get().error], [false, ["GET"], m.COPY.storage]);
  }
});

test("non-propriétaire : aucune gestion (0 POST, aucun bloc) ; révoquer sans payeur ⇒ rien ; identifiant invalide ⇒ rien", async () => {
  const h = harness({ reads: [res(200, status({ can_manage: false }))] });
  await h.c.load();
  same([await h.c.grant(MEMBER), await h.c.revoke(), h.calls.map((c) => c.kind)], [false, false, ["GET"]]);
  const html = renderToString(createElement(ui.DelegatedPayerManager, { interventionId: JOB, context: ctx, initial: { ...m.VIEW_INITIAL, phase: "ready", status: m.parseStatus(status({ can_manage: false }), JOB) } }));
  same(html, "");
  assert.equal(renderToString(createElement(ui.DelegatedPayerManager, { interventionId: JOB, context: ctx, initial: { ...m.VIEW_INITIAL, phase: "forbidden" } })), "");
  const o = harness();
  await o.c.load();
  same([await o.c.revoke(), await o.c.grant("pas-un-uuid"), o.calls.map((c) => c.kind)], [false, false, ["GET"]]);
  const owner = text(renderToString(createElement(ui.DelegatedPayerManager, { interventionId: JOB, context: ctx, initial: { ...m.VIEW_INITIAL, phase: "ready", status: m.parseStatus(status({ payer_id: MEMBER, version: 3, external_session_pending: true }), JOB) } })));
  assert.match(owner, /Payeur délégué actuel : Membre 10000000/);
  assert.match(owner, /une révocation dans l’application n’annule pas une session bancaire déjà émise/);
  assert.match(owner, /aucune approbation, modification ni document supplémentaire/);
});

test("réponse perdue / 503 ⇒ même commande ; 409 ⇒ relecture sans rejeu ; identité changée ⇒ aucun rejeu ; 401/403 ⇒ tout effacé ; rejeu ⇒ relu", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.DP_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.grant(MEMBER); await a.c.retry();
  same(a.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd)), Array(2).fill(JSON.stringify({ command_id: U("c", 1), payer_id: MEMBER, expected_version: null })));
  same(await a.c.grant(OTHER), false);
  const b = harness({ store: mem.store, posts: [(c) => receipt(c, { replayed: true })] });
  b.c.restorePending();
  await b.c.load();
  same([b.get().pending?.command_id, b.calls.map((x) => x.kind)], [U("c", 1), ["GET"]], "restored, never sent by itself");
  await b.c.retry();
  same([b.get().notice, mem.map.size], [m.COPY.replayed, 0]);
  const k = memStore();
  const c = harness({ store: k.store, posts: [() => res(409)], reads: [res(200, status()), res(200, status({ payer_id: OTHER, version: 1 }))] });
  await c.c.load(); await c.c.grant(MEMBER);
  same([c.get().error, c.get().pending, k.map.size, c.calls.map((x) => x.kind), c.get().status!.payer_id], [m.COPY.conflict, null, 0, ["GET", "POST", "GET"], OTHER]);
  same(await c.c.retry(), false);
  for (const [s, copy] of [[422, m.COPY.invalid], [404, m.COPY.notFound], [429, m.COPY.limited]] as const) {
    const x = harness({ posts: [() => res(s)] });
    await x.c.load(); await x.c.grant(MEMBER);
    same([x.get().error, x.get().pending], [copy, null], String(s));
  }
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.grant(MEMBER);
  g.ctx.gen = 1;
  release(receipt({ command_id: U("c", 1), payer_id: MEMBER, expected_version: null }));
  same([await p, g.get().notice, g.get().pending], [false, "", null]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.grant(MEMBER);
  r.ctx.uid = U("1", 2);
  same([await r.c.retry(), r.get().pending, r.calls.filter((x) => x.kind === "POST").length], [false, null, 1]);
  for (const s of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, posts: [() => res(s)] });
    await f.c.load(); await f.c.grant(MEMBER);
    same([f.get().phase, f.get().status, f.get().pending, mm.map.size], ["forbidden", null, null, 0], String(s));
  }
});

test("membre délégué : CTA Checkout EXISTANT seulement si mandat courant + can_checkout ; révoqué / absent / non ouvert ⇒ aucun CTA ; aucun montant ; démo sans appel", () => {
  const cta = () => createElement(pay.PlatformPayAction, { demo: false, busy: false, busyLabel: "Redirection…", className: "button primary full", onPay: () => {} });
  const render = (s: Record<string, unknown> | "forbidden") => renderToString(createElement(ui.DelegatedPayerCheckout, { interventionId: JOB, context: ctx, renderCheckout: cta, initial: s === "forbidden" ? { ...m.VIEW_INITIAL, phase: "forbidden" } : { ...m.VIEW_INITIAL, phase: "ready", status: m.parseStatus(status(s), JOB) } }));
  const yes = render({ can_manage: false, payer_id: MEMBER, version: 2, delegate_current: true, can_checkout: true });
  assert.match(yes, /data-pay-cta=""/);
  assert.match(text(yes), /Vous êtes le payeur délégué de ce dossier\./);
  assert.doesNotMatch(text(yes), /€|\d+,\d{2}/, "no amount on the CTA");
  for (const s of [{ can_manage: false, payer_id: MEMBER, version: 3, delegate_current: false }, { can_manage: false }, { can_manage: false, payer_id: MEMBER, version: 2, delegate_current: true, can_checkout: false }, "forbidden"] as const) {
    const html = render(s as Record<string, unknown>);
    assert.doesNotMatch(html, /data-pay-cta/, JSON.stringify(s));
  }
  assert.match(text(render({ can_manage: false, payer_id: MEMBER, version: 2, delegate_current: true })), /le règlement n’est pas ouvert pour l’instant/);
  assert.match(text(render({ can_manage: false })), /réservé au demandeur du dossier ou au payeur délégué/);
  let calls = 0;
  const api = { read: async () => (calls++, res(200)), write: async () => (calls++, res(200)) };
  renderToString(createElement(ui.DelegatedPayerCheckout, { interventionId: JOB, context: ctx, demo: true, api, renderCheckout: cta }));
  assert.match(renderToString(createElement(ui.DelegatedPayerManager, { interventionId: JOB, context: ctx, demo: true, api })), /aucune délégation de paiement n’est lue ni modifiée/);
  same(calls, 0);
});

test("câblage entreprise : même CTA PlatformPayAction pour le payeur délégué ; gestion du propriétaire dans « Règlement » ; app réelle démo sans appel /api", { skip }, async () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /<DelegatedPayerCheckout\s+interventionId=\{intervention\.id\}\s+context=\{session\.mutationContext\}\s+renderCheckout=\{\(\) => \(\s+<PlatformPayAction\s+demo=\{false\}\s+busy=\{session\.busy\}\s+busyLabel="Redirection…"\s+className="button primary full"\s+onPay=\{\(\) => void session\.checkout\(acceptedQuote\.id\)\}/);
  assert.match(src, /<DelegatedPayerManager\s+interventionId=\{intervention\.id\}\s+context=\{session\.mutationContext\}\s+demo=\{demo\}/);
  assert.doesNotMatch(src, /la délégation de payeur n’est pas définie/);
  assert.equal((src.match(/<PlatformPayAction/g) ?? []).length, 2, "the requester CTA and the delegated one: the same component");
  await withApp(async (open) => {
    const { page, errors, api } = await open("manager-detail.demo-001", 390);
    const r = await page.evaluate(() => ({ manager: document.querySelector('[data-payer-manager="demo"]')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.match(r.manager ?? "", /aucune délégation de paiement n’est lue ni modifiée/);
    same([r.overflow <= 0, api, errors], [true, [], []]);
    await page.context().close();
  });
});
