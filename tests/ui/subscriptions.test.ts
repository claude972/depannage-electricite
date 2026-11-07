// FIN-07 optional subscription, slice 1 (client + artisan « Mon profil »). Contract bf3cdc8 + portal_available
// (dec2594) + relayed correction (state ready|unavailable, currency strictly "eur").
// Real model + SSR + a Chromium mount of the real panel (fake api) + real-app demo wiring.
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
import type * as Model from "../../components/features/subscriptions/model";

const m = loadModule("components/features/subscriptions/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/subscriptions/subscriptions-panel.tsx") as Record<string, any>;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/[  ]/g, " ").replace(/\s+/g, " ");
const USER = "10000000-0000-4000-8000-000000000001";
const O1 = "33333333-3333-4333-8333-333333333333";
const O2 = "33333333-3333-4333-8333-333333333334";
const CID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (over: Record<string, unknown> = {}) => ({ id: O1, version: 1, label: "Offre QA", role: "client", amount_cents: 1234, currency: "eur", interval: "month", interval_count: 2, tax_behavior: "inclusive", ...over });
const overview = (over: Record<string, unknown> = {}) => ({ state: "ready", available: true, portal_available: false, offers: [offer()], checkout_pending: false, subscription: null, ...over });
const UNAVAILABLE = { state: "unavailable", available: false, portal_available: false, offers: [], checkout_pending: null, subscription: null };
const sub = (over: Record<string, unknown> = {}) => ({ status: "active", cancel_at_period_end: false, current_period_start: 1_788_000_000, current_period_end: 1_793_000_000, observed_at: "2026-11-07T20:00:00.000Z", offer: offer(), ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
const STRIPE_REAL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4#fidkdWxOYHwnPyd1blpxYHZxWjA0";
const ctx = { generation: () => 0, userId: () => USER };

test("lecture stricte du contrat gelé (bf3cdc8) ; marqueur de retour ; purge centrale", () => {
  assert.ok(m.parseOverview(overview()));
  assert.ok(m.parseOverview(overview({ available: false, offers: [], subscription: sub() })), "a verified account keeps reading its subscription with the gate closed");
  same(m.parseOverview(UNAVAILABLE), UNAVAILABLE, "the env-gate-off shape, exactly");
  for (const bad of [{ ...UNAVAILABLE, checkout_pending: false }, { ...UNAVAILABLE, subscription: sub() }, { ...UNAVAILABLE, available: true }, { ...UNAVAILABLE, portal_available: true }, { ...UNAVAILABLE, offers: [offer()] }, { ...UNAVAILABLE, extra: 1 }, overview({ state: "closed" }), overview({ checkout_pending: null }), (({ state: _s, ...x }) => x)(overview()), (({ portal_available: _p, ...x }) => x)(overview())])
    assert.equal(m.parseOverview(bad), null, JSON.stringify(bad).slice(0, 120));
  for (const bad of [
    overview({ extra: 1 }),
    { state: "ready", available: true, offers: [] },
    overview({ offers: [offer({ price_id: "price_x" })] }),
    overview({ offers: [offer({ amount_cents: 12.5 })] }),
    overview({ offers: [offer({ currency: "EUR" })] }),
    overview({ offers: [offer({ currency: "usd" })] }),
    overview({ subscription: sub({ offer: offer({ currency: "chf" }) }) }),
    overview({ offers: [offer({ id: "x" })] }),
    overview({ offers: [offer({ version: 0 })] }),
    overview({ offers: [offer(), offer()] }),
    overview({ available: false }),
    overview({ subscription: sub({ status: "open" }) }),
    overview({ subscription: sub({ customer: "cus_x" }) }),
    overview({ subscription: sub({ current_period_end: 1 }) }),
    overview({ subscription: sub({ observed_at: "hier" }) }),
    overview({ subscription: sub({ current_period_start: null }) }),
  ])
    assert.equal(m.parseOverview(bad), null, JSON.stringify(bad).slice(0, 120));
  same([m.returnMarker("?subscription=returned"), m.returnMarker("?a=1&subscription=cancelled"), m.returnMarker("?subscription=paid"), m.returnMarker("?subscription=managed"), m.returnMarker("")], ["returned", "cancelled", null, null, null]);
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0).startsWith(p)), "covered by the central purge");
  assert.ok(m.pendingKey(USER, 0).startsWith("courant-private-subscriptions:"));
});

test("libellés fixes depuis les enums serveur ; valeur inconnue ⇒ offre non affichée", () => {
  same(
    [m.everyLabel("day", 1), m.everyLabel("week", 1), m.everyLabel("week", 2), m.everyLabel("month", 1), m.everyLabel("month", 3), m.everyLabel("year", 1), m.everyLabel("year", 2), m.everyLabel("fortnight", 1)],
    ["tous les jours", "toutes les semaines", "toutes les 2 semaines", "tous les mois", "tous les 3 mois", "tous les ans", "tous les 2 ans", null],
  );
  same([m.taxLabel("inclusive"), m.taxLabel("exclusive"), m.taxLabel("unspecified"), m.taxLabel("automatic")], ["taxes incluses", "hors taxes", "traitement des taxes non précisé", null]);
  same([m.formatAmount(1234, "eur"), m.formatAmount(0, "eur"), m.formatAmount(5, "eur"), m.formatAmount(123456789, "eur"), m.formatAmount(1234, "jpy"), m.formatAmount(1234, "usd")], ["12,34 €", "0,00 €", "0,05 €", "1 234 567,89 €", null, null]);
  const o = m.parseOverview(overview({ offers: [offer(), offer({ id: O2, interval: "quarter" }), offer({ id: "33333333-3333-4333-8333-333333333335", tax_behavior: "automatic" }), offer({ id: "33333333-3333-4333-8333-333333333337", role: "artisan" })] }));
  same(m.visibleOffers(o, "client").map((x) => x.id), [O1], "unknown interval / tax and the other role are hidden");
  same(m.visibleOffers(o, "artisan").map((x) => x.id), ["33333333-3333-4333-8333-333333333337"]);
  same(m.visibleOffers(m.parseOverview(overview({ available: false, offers: [] })), "client"), []);
});

test("consentement : renouvellement automatique tous les {intervalle serveur} au même montant + arrêt indisponible ici (assistance) ; case décochée, bouton désactivé", () => {
  const html = renderToString(createElement(ui.SubscriptionsPanel, { role: "client", context: ctx, initial: { ...m.SUB_INITIAL, phase: "ready", overview: m.parseOverview(overview()) } }));
  const t = text(html);
  assert.match(t, /Je souscris à l’offre « Offre QA » : 12,34 € \(taxes incluses\), débité une première fois après ma confirmation sur la page sécurisée de Stripe, puis renouvelé automatiquement tous les 2 mois au même montant, jusqu’à la fin de l’abonnement\./);
  assert.match(t, /L’arrêt de l’abonnement n’est pas encore disponible depuis cet écran : pour l’arrêter, contactez l’assistance\./);
  assert.match(t, /12,34 € tous les 2 mois · taxes incluses/);
  assert.match(html, /<input type="checkbox" data-subscriptions-consent=""\/>/, "unchecked by default");
  assert.match(html, /disabled=""[^>]*data-subscriptions-checkout=""/, "CTA disabled until consent");
  const yearly = text(renderToString(createElement(ui.SubscriptionsPanel, { role: "client", context: ctx, initial: { ...m.SUB_INITIAL, phase: "ready", overview: m.parseOverview(overview({ offers: [offer({ amount_cents: 9900, interval: "year", interval_count: 1, tax_behavior: "exclusive", label: "Annuel" })] })) } })));
  assert.match(yearly, /« Annuel » : 99,00 € \(hors taxes\), .* renouvelé automatiquement tous les ans au même montant/);
  assert.doesNotMatch(t + yearly, /résilier|Résilier|annuler l’abonnement|Gérer mon abonnement|sans engagement|avantage/i, "no cancel / portal / invented benefit");
  assert.doesNotMatch(html, /data-subscriptions-cancel|data-subscriptions-portal/);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ reads = [] as Model.Result[], posts = [] as ((c: Model.SubCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [CID(1), CID(2)], ctx: who = { uid: USER as string | null, gen: 0 }, role = "client" as "client" | "artisan" } = {}) {
  const calls: { kind: string; cmd?: Model.SubCommand; stored?: string | null }[] = [];
  let drawn = 0;
  let s: Model.SubState = { ...m.SUB_INITIAL };
  const c = m.createSubscriptionsController({
    api: () => ({ read: async () => (calls.push({ kind: "GET" }), reads.shift() ?? res(200, overview())), post: async (cmd) => (calls.push({ kind: "POST", cmd, stored: store?.get(m.pendingKey(who.uid, who.gen)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) }),
    store: () => store,
    newId: () => (drawn++, ids.shift() ?? null),
    context: { generation: () => who.gen, userId: () => who.uid },
    role: () => role,
    get: () => s,
    set: (n) => (s = n),
  });
  return { c, calls, ctx: who, get: () => s, drawn: () => drawn };
}

test("souscription : consentement requis ; préconditions avant l’identifiant ; commande écrite et relue AVANT le POST ; URL en mémoire seulement, usage unique, fragment gardé ; mauvais hôte ⇒ rien d’ouvert", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, posts: [() => res(200, { url: STRIPE_REAL })] });
  await h.c.load();
  same([await h.c.checkout(O1, false), await h.c.checkout(O2, true), h.drawn(), h.calls.map((x) => x.kind)], [false, false, 0, ["GET"]], "no consent / unknown offer ⇒ no id drawn, no POST");
  same(await h.c.checkout(O1, true), true);
  const post = h.calls.find((x) => x.kind === "POST")!;
  same(post.cmd, { action: "checkout", offer_id: O1, offer_version: 1, command_id: CID(1), consent: true });
  same(JSON.parse(post.stored!).command, post.cmd, "persisted before the POST");
  same([h.get().checkoutUrl, mem.map.size, [...mem.map.values()].some((v) => v.includes("stripe"))], [STRIPE_REAL, 0, false]);
  same([h.c.takeCheckoutUrl(), h.c.takeCheckoutUrl()], [STRIPE_REAL, null], "single use, exact string with the #fid fragment");
  for (const url of ["https://billing.stripe.com/p/session/x", "http://checkout.stripe.com/c/pay/x", "https://checkout.stripe.com.evil.example/x", "https://user:pw@checkout.stripe.com/x", "https://checkout.stripe.com:8443/x", "javascript:alert(1)"]) {
    const e = harness({ posts: [() => res(200, { url })] });
    await e.c.load(); await e.c.checkout(O1, true);
    same([e.get().checkoutUrl, e.get().error, e.get().pending], [null, m.COPY.badUrl, null], url);
  }
  same(m.safeCheckoutUrl("https://checkout.stripe.com:443/c/pay/cs_x?a=1#fidX"), "https://checkout.stripe.com:443/c/pay/cs_x?a=1#fidX");
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = harness({ store });
    await x.c.load();
    same([await x.c.checkout(O1, true), x.calls.map((c) => c.kind), x.get().error], [false, ["GET"], m.COPY.storage]);
  }
  for (const state of [overview({ checkout_pending: true }), overview({ subscription: sub() }), overview({ subscription: sub({ status: "past_due" }) }), overview({ available: false, offers: [] })]) {
    const g = harness({ reads: [res(200, state)] });
    await g.c.load();
    same([await g.c.checkout(O1, true), g.drawn(), g.calls.length], [false, 0, 1], JSON.stringify(state).slice(0, 90));
  }
  const after = harness({ reads: [res(200, overview({ subscription: sub({ status: "canceled" }) }))], posts: [() => res(200, { url: STRIPE_REAL })] });
  await after.c.load();
  same(await after.c.checkout(O1, true), true, "a terminal subscription lets the server's offers be used again");
  const art = harness({ role: "artisan" });
  await art.c.load();
  same([await art.c.checkout(O1, true), art.drawn()], [false, 0], "a client offer is never sent from the artisan panel");
});

test("réponse incertaine ⇒ même commande ; restauration jamais envoyée seule ; identité changée ⇒ aucun rejeu ; 409 ⇒ relecture sans rejeu ; 401/403 ⇒ tout effacé", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.SUB_TIMEOUT), () => res(503), () => res(200, { url: STRIPE_REAL })] });
  await a.c.load(); await a.c.checkout(O1, true); await a.c.retry();
  const sent = JSON.stringify({ action: "checkout", offer_id: O1, offer_version: 1, command_id: CID(1), consent: true });
  same(a.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.cmd)), [sent, sent]);
  same(await a.c.checkout(O1, true), false, "no new command while one is uncertain");
  const b = harness({ store: mem.store, reads: [res(200, overview({ checkout_pending: true }))], posts: [() => res(200, { url: STRIPE_REAL })] });
  b.c.restorePending();
  await b.c.load();
  same([b.get().pending?.command_id, b.calls.map((x) => x.kind)], [CID(1), ["GET"]], "restored, never sent by itself");
  same(await b.c.retry(), true, "the same command may be resent even while the server reports a pending Checkout");
  same(JSON.stringify(b.calls.find((x) => x.kind === "POST")!.cmd), sent, "original JSON replayed");
  mem.map.set(m.pendingKey(USER, 1), JSON.stringify({ uid: USER, gen: 0, command: JSON.parse(sent) }));
  const other = harness({ store: mem.store, ctx: { uid: USER, gen: 1 } });
  other.c.restorePending();
  same([other.get().pending, mem.map.has(m.pendingKey(USER, 1))], [null, false]);
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.checkout(O1, true);
  g.ctx.gen = 1;
  release(res(200, { url: STRIPE_REAL }));
  same([await p, g.get().checkoutUrl, g.get().notice], [false, null, ""]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.checkout(O1, true);
  r.ctx.uid = "10000000-0000-4000-8000-000000000002";
  same([await r.c.retry(), r.get().pending], [false, null]);
  const conflict = harness({ reads: [res(200, overview()), res(200, overview({ offers: [offer({ version: 2 })] }))], posts: [() => res(409, { error: "x" })] });
  await conflict.c.load(); await conflict.c.checkout(O1, true);
  same([conflict.get().error, conflict.get().pending, conflict.calls.map((x) => x.kind), conflict.get().overview?.offers[0].version], [m.COPY.conflict, null, ["GET", "POST", "GET"], 2]);
  for (const st of [422, 429]) {
    const x = harness({ posts: [() => res(st)] });
    await x.c.load(); await x.c.checkout(O1, true);
    same([x.get().pending, x.calls.length], [null, 2], String(st));
  }
  for (const st of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, posts: [() => res(st)] });
    await f.c.load(); await f.c.checkout(O1, true);
    same([f.get().phase, f.get().overview, mm.map.size], ["forbidden", null, 0], String(st));
  }
});

test("états : abonnement attesté (statut fixe, période, fin programmée, arrêt ⇒ assistance), en attente, aucune offre, offres masquées, 503, 403, démo sans appel ; retour ⇒ relecture seulement", async () => {
  const view = (o: unknown, role: "client" | "artisan" = "client", over: Partial<Model.SubState> = {}) => text(renderToString(createElement(ui.SubscriptionsPanel, { role, context: ctx, initial: { ...m.SUB_INITIAL, phase: "ready", overview: m.parseOverview(o), ...over } })));
  const active = view(overview({ subscription: sub({ cancel_at_period_end: true }) }));
  assert.match(active, /Offre QA Actif/);
  assert.match(active, /Période en cours : du \d{1,2} \S+ 2026 au \d{1,2} \S+ 2026\./);
  assert.match(active, /Fin programmée au terme de la période en cours, le/);
  assert.match(active, /État relu auprès de Stripe le .*pas une facture encaissée/);
  assert.match(active, /L’arrêt de l’abonnement n’est pas encore disponible depuis cet écran : pour l’arrêter, contactez l’assistance\./);
  assert.match(active, /aucune autre offre n’est proposée/);
  assert.doesNotMatch(active, /Souscrire sur Stripe|Je souscris/);
  for (const [st, label] of Object.entries(m.STATUS_LABEL)) assert.match(view(overview({ subscription: sub({ status: st }) })), new RegExp(label.replace(/[()]/g, "\\$&")), st);
  const ended = view(overview({ subscription: sub({ status: "canceled" }) }));
  assert.match(ended, /Terminé/);
  assert.doesNotMatch(ended, /Période en cours|aucune autre offre/);
  assert.match(ended, /Je souscris à l’offre/, "the server's offers come back after a terminal subscription");
  assert.match(view(overview({ checkout_pending: true })), /Une souscription est en cours de confirmation/);
  assert.doesNotMatch(view(overview({ checkout_pending: true })), /Je souscris/);
  assert.match(view(overview({ available: false, offers: [] })), /Aucune offre d’abonnement disponible pour votre compte\./);
  assert.match(view(overview({ offers: [] })), /Aucune offre d’abonnement disponible/);
  const hidden = view(overview({ offers: [offer({ interval: "quarter" })] }));
  assert.match(hidden, /Aucune offre d’abonnement disponible/);
  assert.match(hidden, /Certaines offres ne sont pas affichées/);
  assert.match(view(overview(), "artisan"), /Aucune offre d’abonnement disponible/, "the artisan panel ignores a client offer");
  assert.match(view(overview({ offers: [offer({ role: "artisan" })] }), "artisan"), /Je souscris à l’offre « Offre QA »/);
  const two = renderToString(createElement(ui.SubscriptionsPanel, { role: "client", context: ctx, initial: { ...m.SUB_INITIAL, phase: "ready", overview: m.parseOverview(overview({ offers: [offer(), offer({ id: O2, label: "Autre" })] })) } }));
  assert.match(two, /data-subscription-pick=/, "several offers ⇒ an explicit choice");
  assert.doesNotMatch(two, /data-subscriptions-consent=/, "no consent before a choice");
  const down = harness({ reads: [res(503), res(200, overview())] });
  await down.c.load();
  same(down.get().phase, "unavailable");
  await down.c.load();
  same(down.get().phase, "ready");
  const forb = harness({ reads: [res(403)] });
  await forb.c.load();
  same(forb.get().phase, "forbidden");
  const junk = harness({ reads: [res(200, { available: true })] });
  const off = harness({ reads: [res(200, UNAVAILABLE)] });
  await off.c.load();
  same([off.get().phase, await off.c.checkout(O1, true), off.calls.length], ["ready", false, 1], "env gate off ⇒ no command at all");
  const offHtml = renderToString(createElement(ui.SubscriptionsPanel, { role: "client", context: ctx, initial: off.get() }));
  assert.match(text(offHtml), /Les abonnements sont indisponibles pour le moment : votre abonnement éventuel n’a pas pu être lu ici\./);
  assert.doesNotMatch(text(offHtml), /non abonné|aucun abonnement|Aucune offre|Je souscris|Souscrire|Gérer mon abonnement|Actif|Terminé/i, "subscription NOT read ⇒ no « non abonné », no CTA, no portal");
  assert.doesNotMatch(offHtml, /data-subscriptions-checkout|data-subscriptions-consent|data-subscriptions-portal|data-subscription-status/);
  await junk.c.load();
  same(junk.get().phase, "error");
  let calls = 0;
  const api = { read: async () => (calls++, res(200)), post: async () => (calls++, res(200)) };
  for (const role of ["client", "artisan"]) assert.match(text(renderToString(createElement(ui.SubscriptionsPanel, { role, context: ctx, demo: true, api }))), /aucune offre n’est lue ni souscrite et aucun paiement n’est demandé/);
  same(calls, 0);
  assert.doesNotMatch(m.COPY.returned + m.COPY.cancelled, /souscrit avec succès|abonnement actif|confirmé/);
  assert.match(m.COPY.returned, /Un retour ne prouve pas qu’un abonnement a été souscrit/);
});

test("montages : profil client après les moyens de paiement, profil artisan après les données du compte ; aucun bouton d’arrêt", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /<SavedPaymentMethodsPanel [^\n]*\/>\n\s*<SubscriptionsPanel key=\{`\$\{session\.mode\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\} role="client" demo=\{demo\} context=\{session\.mutationContext\} \/>/);
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /onOpenTicket=\{\(id\) => session\.go\("support", id\)\}\n\s*\/>\n\s*<SubscriptionsPanel\n\s*key=\{`\$\{session\.mode\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}\n\s*role="artisan"\n\s*demo=\{session\.mode === "demo"\}\n\s*context=\{session\.mutationContext\}\n\s*\/>\n\s*<div className=\{styles\.profileActions\}>/);
  const src = readFileSync("components/features/subscriptions/subscriptions-panel.tsx", "utf8") + readFileSync("components/features/subscriptions/model.ts", "utf8");
  assert.doesNotMatch(src, /billing\.stripe\.com|\/portal|cancel_subscription|action: "cancel"|Gérer mon abonnement|data-subscriptions-portal/i, "no management action in slice 1");
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SubscriptionsPanel } from "./components/features/subscriptions/subscriptions-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const offer = { id: "${O1}", version: 1, label: "Offre QA", role: "artisan", amount_cents: 1234, currency: "eur", interval: "month", interval_count: 1, tax_behavior: "inclusive" };
w.run = async (search) => {
  const calls = [], navigated = [];
  const api = {
    read: async () => (calls.push("GET"), { status: 200, body: { state: "ready", available: true, portal_available: false, offers: [offer], checkout_pending: false, subscription: null } }),
    post: async (cmd) => (calls.push("POST:" + cmd.action + ":" + cmd.consent), { status: 200, body: { url: "${STRIPE_REAL}" } }),
  };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(SubscriptionsPanel, { role: "artisan", context: { generation: () => 0, userId: () => "${USER}" }, api, store, search, navigate: (u) => navigated.push(u), newId: () => crypto.randomUUID() })));
  await tick(300);
  const notice = div.querySelector("[data-subscriptions-notice]")?.textContent ?? null;
  const consentText = div.querySelector("[data-subscriptions-consent-text]")?.textContent ?? null;
  const disabledBefore = div.querySelector("[data-subscriptions-checkout]").disabled;
  div.querySelector("[data-subscriptions-checkout]").click(); await tick(80);
  const postsWithoutConsent = calls.filter((c) => c.startsWith("POST")).length;
  div.querySelector("[data-subscriptions-consent]").click(); await tick(50);
  div.querySelector("[data-subscriptions-checkout]").click(); await tick(200);
  const navigatedBeforeClick = navigated.length;
  const heights = [...div.querySelectorAll("button, label")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  div.querySelector("[data-subscriptions-open]").click(); await tick(50);
  return { notice, consentText, disabledBefore, postsWithoutConsent, calls, navigatedBeforeClick, navigated, heights, stored: [...map.values()], overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
`;
test("panneau monté (Chromium, StrictMode) : aucun POST sans consentement, Stripe ouvert seulement au clic (URL exacte), retour ⇒ relecture, 44 px, 390 px", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const r = (await page.evaluate((s: string) => (window as unknown as { run: (x: string) => Promise<unknown> }).run(s), "?subscription=returned")) as { notice: string; consentText: string; disabledBefore: boolean; postsWithoutConsent: number; calls: string[]; navigatedBeforeClick: number; navigated: string[]; heights: number[]; stored: string[]; overflow: number };
    assert.match(r.notice, /Un retour ne prouve pas qu’un abonnement a été souscrit/);
    assert.match(r.consentText.replace(/[  ]/g, " "), /12,34 € \(taxes incluses\).*renouvelé automatiquement tous les mois au même montant, jusqu’à la fin de l’abonnement\. L’arrêt de l’abonnement n’est pas encore disponible depuis cet écran : pour l’arrêter, contactez l’assistance\./);
    same([r.disabledBefore, r.postsWithoutConsent], [true, 0]);
    same(r.calls.filter((c) => c.startsWith("POST")), ["POST:checkout:true"]);
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

test("app réelle (démo, profils client ET artisan) : note honnête, aucun appel /api, pas de débordement à 390, cibles 44 px", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-profile", "artisan-profile"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ note: document.querySelector('[data-subscriptions="demo"]')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      assert.match(r.note ?? "", /aucune offre n’est lue ni souscrite/, route);
      same([r.overflow <= 0, api, errors], [true, [], []], route);
      await page.context().close();
    }
  });
});
