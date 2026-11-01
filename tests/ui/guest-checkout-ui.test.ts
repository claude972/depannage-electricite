// Guest checkout UI (docs/GUEST_CHECKOUT_CONTRACT.md): payment step (on site / card authorisation,
// card disabled until available, honest copy), drafts store the payment, inline phone check
// (PhoneAccess) with an injected fake API — never a real SMS — and the /suivi lookup page.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadModule } from "../documents/harness";
import * as draftModule from "../../components/app/booking-draft";
import { BOOKING_DRAFT_KEY, readBooking } from "../../components/app/booking-draft";
import type * as Booking from "../../components/role/public-booking";
import type * as Phone from "../../components/role/phone-access";

const tp = loadModule("components/app/theme-provider.tsx");
// vm harness has no `crypto`: the real booking-draft module (Node crypto.randomUUID) is injected.
const overrides = { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule };
const booking = loadModule("components/role/public-booking.tsx", overrides) as unknown as typeof Booking;
const phone = loadModule("components/role/phone-access.tsx", overrides) as unknown as typeof Phone;
const suivi = loadModule("app/suivi/page.tsx", overrides) as Record<string, any>;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES.find((s: { slug: string }) => s.slug === "prise-abimee-ou-qui-chauffe");
const render = (node: unknown) => renderToString(createElement(tp.ThemeProvider as never, null, node as never)).replaceAll("<!-- -->", "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const contact = { civility: "" as const, first_name: "Camille", last_name: "Durand", email: "camille@example.test", phone: "0696 12 34 56", company: false };
const state = (over: Partial<Booking.BookingState> = {}): Booking.BookingState => ({ ...booking.EMPTY_BOOKING, urgent: true, contact, address: { address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France" }, ...over });
const wizard = (props: Record<string, unknown>) => render(createElement(booking.BookingWizard as never, { service, range: "80 € – 180 €", onClose() {}, ...props } as never));
class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

// ---- Options serveur (GET /api/bookings/options) ---------------------------------------------
const OPTS = ({ phone = false, card = false, reason = "Le paiement par carte n’est pas encore activé." } = {}): Phone.OptionsState => ({
  status: "ready",
  options: {
    payment_methods: [
      { id: "on_site", available: true, label: "Sur place", description: "x" },
      { id: "card_hold", available: card, label: "Empreinte", description: "y", ...(card ? {} : { reason }) },
    ],
    phone_auth: { available: phone },
    currency: "eur",
  },
});
const radiosOf = (html: string) => {
  const step = html.slice(html.indexOf("data-booking-payment"), html.indexOf("</fieldset>", html.indexOf("data-booking-payment")));
  return { step, radios: [...step.matchAll(/<input type="radio"([^>]*)\/>/g)].map((m) => m[1]) };
};

test("paiement : 2 choix depuis les options ; carte indisponible désactivée avec la raison du serveur ; aucun « payé »", () => {
  const { step, radios } = radiosOf(wizard({ initial: state({ step: 4 }), initialOptions: OPTS() }));
  same(radios.map((a) => a.match(/value="([^"]+)"/)![1]), ["on_site", "card_hold"]);
  assert.doesNotMatch(radios[0], /disabled/);
  assert.match(radios[1], /disabled=""/);
  const t = text(step);
  assert.match(t, /Règlement sur place Vous réglez l’artisan après l’intervention\. La demande reste non payée jusque-là\./);
  assert.match(t, /Empreinte bancaire Une autorisation sur votre carte, sans débit à la réservation\. Seul le montant du devis accepté pourra être prélevé ensuite\./);
  assert.match(t, /Le paiement par carte n’est pas encore activé\./); // raison du serveur
  assert.doesNotMatch(t.replace("reste non payée", ""), /payé|garanti|numéro de carte|cvc|cryptogramme/i);
  assert.doesNotMatch(step, /autocomplete="cc-|name="card/i); // jamais de faux formulaire de carte
  // Sans raison serveur : copie honnête de repli.
  const fallback = OPTS();
  (fallback as { options: Phone.BookingOptions }).options.payment_methods[1] = { id: "card_hold", available: false };
  assert.match(text(radiosOf(wizard({ initial: state({ step: 4 }), initialOptions: fallback })).step), /Bientôt disponible\. En attendant, choisissez le règlement sur place\./);
  // Disponible côté serveur ⇒ sélectionnable.
  assert.doesNotMatch(radiosOf(wizard({ initial: state({ step: 4 }), initialOptions: OPTS({ card: true }) })).radios[1], /disabled/);
  // Règles : choix requis ; disponibilité = options serveur uniquement.
  const avail = booking.paymentAvailability(OPTS());
  same(Object.keys(booking.paymentErrors({ payment: null }, avail)), ["payment"]);
  same(booking.paymentErrors({ payment: "card_hold" }, avail), { payment: "Le paiement par carte n’est pas encore activé." });
  same(booking.paymentErrors({ payment: "card_hold" }, booking.paymentAvailability(OPTS({ card: true }))), {});
  same(booking.paymentErrors({ payment: "on_site" }, avail), {});
  same(booking.advanceBooking(state({ step: 4, payment: "card_hold" }), avail).state.step, 4);
  same(booking.advanceBooking(state({ step: 4, payment: "on_site" }), avail).state.step, 5);
});

test("options en échec ou en cours : les deux modes désactivés, « réessayez » + bouton, aucune avancée", () => {
  const failed = wizard({ initial: state({ step: 4 }), initialOptions: { status: "error" } });
  const { radios } = radiosOf(failed);
  assert.ok(radios.length === 2 && radios.every((r) => /disabled=""/.test(r)));
  assert.match(text(failed), /Options de paiement momentanément indisponibles, réessayez\. Réessayer/);
  assert.match(failed, /data-booking-options-error=""/);
  same(booking.paymentAvailability({ status: "error" }), {});
  // Rien n’avance, donc rien n’est enregistré (finishBooking n’est atteint qu’à l’étape 5).
  for (const payment of ["on_site", "card_hold"] as const) same(booking.advanceBooking(state({ step: 4, payment }), {}).state.step, 4);
  const loading = wizard({ initial: state({ step: 4 }), initialOptions: { status: "loading" } });
  assert.ok(radiosOf(loading).radios.every((r) => /disabled=""/.test(r)));
  assert.match(text(loading), /Chargement des options de paiement…/);
});

test("finishBooking : écrit les deux brouillons AVEC le paiement, sans naviguer", () => {
  const s = new Mem();
  let saved = 0;
  same(booking.finishBooking({ storage: s as unknown as Storage, service, state: state({ step: 5, payment: "on_site" }), onSaved: () => saved++ }), { ok: true });
  assert.equal(saved, 1);
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.payment, "on_site");
});

test("SMS désactivé : pas de PhoneAccess ; note honnête ; « Utiliser mon compte existant » enregistre puis /#auth", () => {
  const html = wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions: OPTS({ phone: false }) });
  assert.doesNotMatch(html, /data-phone-access/);
  assert.match(text(html), /La vérification par SMS n’est pas encore disponible\./);
  assert.match(html, /data-booking-inline-submit="5">Utiliser mon compte existant<\/button>/);
  assert.match(html, /form="booking-step-5"[^>]*data-booking-submit="5">Utiliser mon compte existant<\/button>/);
  assert.doesNotMatch(html, /Vérifier mon téléphone/);
  // Même en forçant la phase téléphone : jamais de formulaire SMS tant que le serveur ne l’a pas activé.
  for (const initialOptions of [OPTS({ phone: false }), { status: "error" }, { status: "loading" }]) assert.doesNotMatch(wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions, initialPhase: "phone" }), /data-phone-access/);
  // Chemin compte : brouillons enregistrés d’abord, puis /#auth ; échec ⇒ aucune navigation.
  const s = new Mem();
  const went: string[] = [];
  same(booking.completeBooking({ storage: s as unknown as Storage, service, state: state({ step: 5, payment: "on_site" }), mode: "account", go: (h) => went.push(h), openPhone: () => went.push("phone") }), { ok: true });
  same(went, ["/#auth"]);
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.payment, "on_site");
  const none: string[] = [];
  assert.equal(booking.completeBooking({ storage: null, service, state: state({ step: 5, payment: "on_site" }), mode: "account", go: (h) => none.push(h), openPhone: () => none.push("phone") }).ok, false);
  same(none, []);
});

test("SMS activé : « Vérifier mon téléphone » ouvre PhoneAccess (après enregistrement) ; compte existant en second choix", () => {
  const recap = wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions: OPTS({ phone: true }) });
  assert.match(recap, /data-booking-inline-submit="5">Vérifier mon téléphone<\/button>/);
  assert.match(recap, /data-booking-account="">Utiliser mon compte existant<\/button>/);
  const html = wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions: OPTS({ phone: true }), initialPhase: "phone" });
  assert.match(html, /<h2[^>]*>Vérifier mon téléphone<\/h2>/);
  assert.match(html, /data-phone-access="booking" data-phone-stage="form"/);
  assert.doesNotMatch(html, />Prénom</); // déjà saisis à l’étape 2
  assert.match(html, /type="tel"[^>]*value="0696 12 34 56"/);
  assert.match(html, /<button type="submit" form="booking-phone"[^>]*data-booking-submit="phone"[^>]*>Recevoir un code<\/button>/);
  assert.match(html, /data-booking-account="">Utiliser mon compte existant<\/button>/);
  const s = new Mem();
  const went: string[] = [];
  booking.completeBooking({ storage: s as unknown as Storage, service, state: state({ step: 5, payment: "on_site" }), mode: "phone", go: (h) => went.push(h), openPhone: () => went.push("phone") });
  same(went, ["phone"]);
  assert.ok(s.getItem(BOOKING_DRAFT_KEY)); // enregistré AVANT l’étape téléphone
});

test("options : GET same-origin no-store, analyse stricte ; échec / forme inattendue ⇒ null (jamais « disponible »)", async () => {
  const calls: RequestInit[] = [];
  const reply = (status: number, body: unknown) => (async (_u: string, init: RequestInit) => { calls.push(init); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const good = { payment_methods: [{ id: "on_site", available: true, label: "a", description: "b" }, { id: "card_hold", available: false, label: "c", description: "d", reason: "Pas encore activé." }], phone_auth: { available: false }, currency: "eur" };
  same(await phone.createOptionsApi(reply(200, good))(), good);
  same([calls[0].method, calls[0].credentials, calls[0].cache], ["GET", "same-origin", "no-store"]);
  assert.equal(await phone.createOptionsApi(reply(503, good))(), null);
  assert.equal(await phone.createOptionsApi(reply(200, { payment_methods: [{ id: "cash", available: true }], phone_auth: {} }))(), null);
  assert.equal(phone.parseBookingOptions({ ...good, phone_auth: { available: "yes" } })!.phone_auth.available, null);
  assert.equal(phone.phoneAuthOn({ status: "ready", options: { ...good, phone_auth: { available: null } } as Phone.BookingOptions }), false);
});

// ---- PhoneAccess : machine d’états --------------------------------------------------------
const ok = (body: unknown, status = 200, retryAfter: number | null = null) => ({ status, body, retryAfter });
const s0 = () => ({ ...phone.initialPhoneState({ phone: "0696123456", first_name: "Camille", last_name: "Durand" }) });

test("PhoneAccess : 200 code_requested (booking : suffixe ; lookup : générique), compte à rebours de renvoi", () => {
  const now = 1_000_000;
  const b = phone.applyStart(s0(), ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }), "booking", now);
  same([b.stage, b.kind, b.suffix, b.resendAt, b.message], ["code", "sms", "3456", now + 60_000, "Code envoyé au •••• 3456."]);
  const l = phone.applyStart(s0(), ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }), "lookup", now);
  assert.equal(l.message, "Si ce numéro est connu, un code vous a été envoyé.");
  assert.doesNotMatch(l.message, /envoyé au/);
  assert.equal(phone.phoneActionLabel(b), "Valider le code");
  const html = render(createElement(phone.PhoneAccess as never, { purpose: "booking", onVerified() {}, initial: b, clock: () => now } as never));
  assert.match(text(html), /Code envoyé au •••• 3456\./);
  assert.match(html, /autoComplete="one-time-code"/i);
  assert.match(text(html), /Renvoyer le code dans 60 s/);
});

test("PhoneAccess : {status:\"verified\"} court-circuite ; verify 200 ⇒ vérifié ; 422 garde le code", () => {
  assert.equal(phone.applyStart(s0(), ok({ status: "verified" }), "booking", 0).stage, "verified");
  const code = { ...phone.applyStart(s0(), ok({ status: "code_requested", kind: "phone_change", retry_after: 60, phone_suffix: "3456" }), "booking", 0), code: "123456" };
  assert.equal(code.kind, "phone_change");
  assert.equal(phone.applyVerify(code, ok({ verified: true }), "booking", 0).stage, "verified");
  const wrong = phone.applyVerify(code, ok({ error: "x" }, 422), "booking", 0);
  same([wrong.stage, wrong.code, wrong.error], ["code", "123456", phone.PHONE_COPY.wrongCode]);
  // Jamais de faux succès : 200 sans verified:true n’est pas une vérification.
  assert.notEqual(phone.applyVerify(code, ok({}), "booking", 0).stage, "verified");
  assert.notEqual(phone.applyStart(s0(), ok({ status: "weird" }), "booking", 0).stage, "verified");
});

test("PhoneAccess : 429 Retry-After, 503 « service SMS indisponible, réessayez ; ou… », 409 rôle refusé", () => {
  const t = phone.applyStart(s0(), ok({ error: "x" }, 429, 45), "booking", 1000);
  same([t.stage, t.blockedUntil, t.error], ["form", 1000 + 45_000, "Trop de tentatives. Réessayez dans 45 s."]);
  const u = phone.applyStart(s0(), ok({ error: "x" }, 503, 2), "booking", 0);
  assert.match(u.error, /^Service SMS indisponible, réessayez dans un instant ; ou /);
  assert.match(phone.applyStart(s0(), ok(null, 503), "lookup", 0).error, /^Service SMS indisponible, réessayez dans un instant ; ou connectez-vous/);
  assert.equal(phone.applyStart(s0(), ok(null, 409), "booking", 0).error, phone.PHONE_COPY.refused);
  const code = { ...phone.applyStart(s0(), ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }), "booking", 0), code: "111111" };
  assert.equal(phone.applyVerify(code, ok(null, 429, 30), "booking", 0).blockedUntil, 30_000);
  assert.match(phone.applyVerify(code, ok(null, 503), "booking", 0).error, /Service SMS indisponible/);
  assert.equal(phone.applyStart(s0(), ok(null, 0), "booking", 0).error, phone.PHONE_COPY.failed); // transport
});

test("PhoneAccess : validation locale (numéro, noms, code 6 chiffres) et requêtes exactes du contrat", async () => {
  same(Object.keys(phone.phoneFormErrors(phone.initialPhoneState({ phone: "12" }))).sort(), ["first_name", "last_name", "phone"]);
  same(phone.phoneFormErrors(s0()), {});
  assert.ok(phone.codeError("12345"));
  assert.equal(phone.codeError("123456"), "");
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }), { status: 429, headers: { "Retry-After": "12" } });
  }) as unknown as typeof fetch;
  const api = phone.createPhoneApi(fake);
  const r = await api.start({ phone: "+596696123456", first_name: "Camille", last_name: "Durand", purpose: "lookup" });
  same([r.status, r.retryAfter], [429, 12]);
  await api.verify({ phone: "+596696123456", token: "123456", kind: "sms" });
  same(calls.map((c) => c.url), ["/api/auth/phone/start", "/api/auth/phone/verify"]);
  for (const c of calls) same([c.init.method, c.init.credentials, c.init.cache], ["POST", "same-origin", "no-store"]);
  same(Object.keys(JSON.parse(String(calls[0].init.body))), ["phone", "first_name", "last_name", "purpose"]);
  same(Object.keys(JSON.parse(String(calls[1].init.body))), ["phone", "token", "kind"]);
  // Aucun numéro/code journalisé ni stocké ; aucun jeton manipulé.
  const src = readFileSync(path.join(ROOT, "components/role/phone-access.tsx"), "utf8");
  assert.doesNotMatch(src, /console\.\w+\(|localStorage\.|sessionStorage\.|access_token|refresh_token|setItem\(/);
});

// ---- /suivi ----------------------------------------------------------------------------------
test("/suivi : SMS désactivé ⇒ aucun formulaire téléphone, message honnête + « Me connecter à mon compte »", () => {
  const off = render(createElement(phone.PhoneLookupPage as never, { initialOptions: OPTS({ phone: false }), go() {} } as never));
  assert.match(off, /class="ui-v2 /);
  assert.match(off, /<h1>Suivre ma demande<\/h1>/);
  assert.doesNotMatch(off, /data-phone-access|type="tel"/);
  assert.match(text(off), /Le suivi par SMS sera disponible prochainement\./);
  assert.match(off, /<a class="submit" href="\/#auth">Me connecter à mon compte<\/a>/);
  for (const initialOptions of [{ status: "error" }, { status: "loading" }]) assert.doesNotMatch(render(createElement(phone.PhoneLookupPage as never, { initialOptions, go() {} } as never)), /data-phone-access/);
  // La page réelle (chargement initial) n’affiche aucun formulaire avant la réponse du serveur.
  const page = render(createElement(suivi.default as never));
  assert.doesNotMatch(page, /data-phone-access/);
  assert.equal(suivi.metadata.title, "Suivre ma demande — Courant");
});

test("/suivi : SMS activé ⇒ PhoneAccess « lookup » (téléphone + nom + prénom), rien de listé avant vérification", () => {
  const went: string[] = [];
  const on = render(createElement(phone.PhoneLookupPage as never, { initialOptions: OPTS({ phone: true }), go: (h: string) => went.push(h) } as never));
  assert.match(on, /data-phone-access="lookup" data-phone-stage="form"/);
  for (const label of ["Prénom", "Nom", "Téléphone mobile"]) assert.match(on, new RegExp(`>${label}<`), label);
  assert.doesNotMatch(on, /data-request|Mes demandes|INT-/);
  same(went, []);
});

// ---- Robustesse PhoneAccess (revue ROOT) : délai, vol unique, réponses tardives -------------------
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function controllerHarness(api: Phone.PhoneApi, initial = s0()) {
  let current = initial;
  const sets: Phone.PhoneState[] = [];
  let verified = 0;
  const ctrl = phone.createPhoneController({ api: () => api, purpose: "booking", clock: () => 0, get: () => current, set: (s) => { current = s; sets.push(s); }, onVerified: () => verified++ });
  return { ctrl, get: () => current, sets, verified: () => verified };
}

test("délai : requête sans réponse ⇒ « Délai dépassé, réessayez » ; saisies conservées", async () => {
  const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const api = phone.createPhoneApi(never, { timeoutMs: 20 });
  const r = await api.start({ phone: "+596696123456", first_name: "Camille", last_name: "Durand", purpose: "booking" });
  assert.equal(r.status, phone.TIMEOUT_STATUS);
  const h = controllerHarness(api);
  await h.ctrl.start();
  same([h.get().stage, h.get().error, h.get().phone, h.get().first_name, h.get().last_name], ["form", phone.PHONE_COPY.timeout, "0696123456", "Camille", "Durand"]);
  const code = { ...phone.applyStart(s0(), ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }), "booking", 0), code: "123456" };
  const v = phone.applyVerify(code, { status: phone.TIMEOUT_STATUS, body: null, retryAfter: null }, "booking", 0);
  same([v.stage, v.code, v.error], ["code", "123456", phone.PHONE_COPY.timeout]);
});

test("vol unique : deux envois dans le même tick ⇒ UN appel ; idem pour la vérification", async () => {
  const d = deferred<Phone.ApiResult>();
  let starts = 0;
  let verifies = 0;
  const api: Phone.PhoneApi = { start: () => (starts++, d.promise), verify: () => (verifies++, d.promise) };
  const h = controllerHarness(api);
  const first = h.ctrl.start();
  const second = h.ctrl.start();
  assert.equal(second, false);
  assert.equal(starts, 1);
  d.resolve(ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" }));
  await first;
  assert.equal(h.get().stage, "code");
  const v = deferred<Phone.ApiResult>();
  const api2: Phone.PhoneApi = { start: () => v.promise, verify: () => (verifies++, v.promise) };
  const h2 = controllerHarness(api2, { ...h.get(), code: "123456" });
  const a = h2.ctrl.verify();
  assert.equal(h2.ctrl.verify(), false);
  assert.equal(verifies, 1);
  v.resolve(ok({ verified: true }));
  await a;
  same([h2.get().stage, h2.verified()], ["verified", 1]);
});

test("réponses tardives ignorées : après démontage, ou après « Modifier le numéro » (nouvelle requête)", async () => {
  const d = deferred<Phone.ApiResult>();
  const h = controllerHarness({ start: () => d.promise, verify: () => d.promise }, { ...s0(), stage: "code", kind: "sms", code: "123456" });
  const pending = h.ctrl.verify();
  h.ctrl.detach(); // démontage
  d.resolve(ok({ verified: true }));
  await pending;
  assert.equal(h.verified(), 0);
  assert.notEqual(h.get().stage, "verified");
  // Nouvelle requête après « Modifier le numéro » : la réponse de l’ancienne est ignorée.
  const old = deferred<Phone.ApiResult>();
  const fresh = deferred<Phone.ApiResult>();
  const queue = [old, fresh];
  const h2 = controllerHarness({ start: () => queue.shift()!.promise, verify: () => old.promise });
  const p1 = h2.ctrl.start();
  h2.ctrl.reset();
  const p2 = h2.ctrl.start();
  old.resolve(ok({ status: "verified" }));
  await p1;
  assert.equal(h2.verified(), 0);
  fresh.resolve(ok({ status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "9999" }));
  await p2;
  same([h2.get().stage, h2.get().suffix], ["code", "9999"]);
});

// ---- Historique vérifié (GET /api/auth/phone/history) -------------------------------------------
const row = (id: string, over: Record<string, unknown> = {}) => ({ id, category: "socket", status: "requested", city: "Fort-de-France", created_at: "2026-10-30T10:00:00Z", estimate_min_cents: 8000, estimate_max_cents: 18000, ...over });
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function historyHarness(replies: Phone.ApiResult[]) {
  let current = { ...phone.HISTORY_INITIAL };
  const calls: { cursor?: string; limit: number }[] = [];
  let expired = 0;
  const api: Phone.HistoryApi = async (p) => (calls.push(p), replies.shift()!);
  const ctrl = phone.createHistoryController({ api: () => api, get: () => current, set: (s) => (current = s), onExpired: () => expired++ });
  ctrl.identity("INITIAL_SESSION", "user-a"); // identity PROVEN before any read
  return { ctrl, get: () => current, calls, expired: () => expired };
}

test("historique : 2 pages, curseur renvoyé tel quel, dédoublonnage, liens /#detail/<id>", async () => {
  const cursor = "opaque+/=cursor==";
  const h = historyHarness([
    ok({ interventions: [row(ID(1)), row(ID(2), { status: "quoted", category: "panel" })], page: { limit: 20, has_more: true, next_cursor: cursor } }),
    ok({ interventions: [row(ID(2)), row(ID(3), { estimate_min_cents: null, estimate_max_cents: null })], page: { limit: 20, has_more: false, next_cursor: null } }),
  ]);
  await h.ctrl.load();
  same([h.get().status, h.get().items.length, h.get().hasMore], ["ready", 2, true]);
  await h.ctrl.more();
  same(h.calls, [{ limit: 20 }, { cursor, limit: 20 }]);
  same(h.get().items.map((i) => i.id), [ID(1), ID(2), ID(3)]);
  assert.equal(h.get().hasMore, false);
  const html = render(createElement(phone.PhoneHistory as never, { initial: h.get(), onExpired() {}, watchIdentity: () => () => {} } as never));
  same([...html.matchAll(/href="([^"]+)" data-history-id/g)].map((m) => m[1]), [ID(1), ID(2), ID(3)].map((id) => `/#detail/${id}`));
  const t = text(html);
  for (const part of ["Prise ou interrupteur", "Recherche d’un artisan", "Tableau électrique", "Devis à valider", "Fort-de-France", "Estimation indicative : 80,00"]) assert.ok(t.replace(/\s/g, " ").includes(part.replace(/\s/g, " ")), part);
  // URL réelle : curseur encodé une fois, jamais modifié.
  const urls: string[] = [];
  await phone.createHistoryApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch)({ cursor, limit: 20 });
  same(urls, [`/api/auth/phone/history?limit=20&cursor=${encodeURIComponent(cursor)}`]);
});

test("historique : vide, 401 ⇒ « vérification expirée » + retour au téléphone, 503 honnête, délai", async () => {
  const empty = historyHarness([ok({ interventions: [], page: { limit: 20, has_more: false, next_cursor: null } })]);
  await empty.ctrl.load();
  assert.match(text(render(createElement(phone.PhoneHistory as never, { initial: empty.get(), onExpired() {}, watchIdentity: () => () => {} } as never))), /Aucune demande n’est associée à ce numéro\./);
  const expired = historyHarness([ok(null, 401)]);
  await expired.ctrl.load();
  same([expired.get().status, expired.get().items, expired.expired()], ["expired", [], 1]);
  const down = historyHarness([ok(null, 503)]);
  await down.ctrl.load();
  same([down.get().status, down.get().error], ["unavailable", phone.HISTORY_COPY.unavailable]);
  assert.match(render(createElement(phone.PhoneHistory as never, { initial: down.get(), onExpired() {}, watchIdentity: () => () => {} } as never)), />Réessayer</);
  const late = historyHarness([{ status: phone.TIMEOUT_STATUS, body: null, retryAfter: null }]);
  await late.ctrl.load();
  same([late.get().status, late.get().error], ["error", phone.PHONE_COPY.timeout]);
});

// Harness with a manual reply per call (deferred) and full control over auth events.
function identityHarness() {
  let current = { ...phone.HISTORY_INITIAL };
  let expired = 0;
  const pending: { resolve: (r: Phone.ApiResult) => void }[] = [];
  const api: Phone.HistoryApi = () => new Promise((resolve) => pending.push({ resolve }));
  const ctrl = phone.createHistoryController({ api: () => api, get: () => current, set: (s) => (current = s), onExpired: () => expired++ });
  const page = (id: string) => ok({ interventions: [row(id)], page: { limit: 20, has_more: false, next_cursor: null } });
  return { ctrl, get: () => current, expired: () => expired, pending, page };
}

test("vie privée (repro Codex 1) : lecture de A en vol → SIGNED_OUT → SIGNED_IN B → A répond ⇒ rien sous B, « expirée »", async () => {
  const h = identityHarness();
  h.ctrl.identity("INITIAL_SESSION", "user-a");
  const a = h.ctrl.load();
  assert.equal(h.pending.length, 1);
  h.ctrl.identity("SIGNED_OUT", null);
  h.ctrl.identity("SIGNED_IN", "user-b");
  h.pending[0].resolve(h.page(ID(1)));
  await a;
  same([h.get().status, h.get().items, h.expired()], ["expired", [], 1]);
});

test("vie privée (repro Codex 2) : identité inconnue/nulle d’abord ⇒ aucune lecture ; une réponse ne remplit jamais la liste", async () => {
  const h = identityHarness();
  const first = h.ctrl.load(); // identité inconnue : différé, AUCUNE requête
  await first;
  same([h.pending.length, h.get().status, h.get().items], [0, "loading", []]);
  h.ctrl.identity("INITIAL_SESSION", null); // pas de session : jamais autorisé
  same([h.pending.length, h.get().status, h.get().items, h.expired()], [0, "expired", [], 1]);
  // Même si l’identité arrive ensuite, la vue terminée ne lit plus rien.
  h.ctrl.identity("SIGNED_IN", "user-a");
  await h.ctrl.load();
  same(h.pending.length, 0);
  // Une lecture différée part UNIQUEMENT quand l’uid est prouvé, liée à cet uid.
  const g = identityHarness();
  await g.ctrl.load();
  assert.equal(g.pending.length, 0);
  g.ctrl.identity("INITIAL_SESSION", "user-a");
  assert.equal(g.pending.length, 1);
  g.pending[0].resolve(g.page(ID(1)));
  await new Promise((r) => setTimeout(r, 0));
  same(g.get().items.map((i) => i.id), [ID(1)]);
});

test("vie privée : SIGNED_OUT avec uid précédent inconnu ⇒ vidé ; autre uid ⇒ vidé ; réponse tardive ignorée", async () => {
  const h = identityHarness();
  void h.ctrl.load();
  h.ctrl.identity("SIGNED_OUT", null);
  same([h.get().status, h.expired(), h.pending.length], ["expired", 1, 0]);
  const k = identityHarness();
  k.ctrl.identity("INITIAL_SESSION", "user-a");
  const pa = k.ctrl.load();
  k.ctrl.identity("TOKEN_REFRESHED", "user-b"); // autre compte
  k.pending[0].resolve(k.page(ID(1)));
  await pa;
  same([k.get().status, k.get().items, k.expired()], ["expired", [], 1]);
  // Indisponibilité du client d’authentification : rien n’est lu, message honnête.
  const u = identityHarness();
  u.ctrl.identity("UNAVAILABLE", null);
  await u.ctrl.load();
  same([u.get().status, u.pending.length], ["unavailable", 0]);
});

test("vie privée : revalidation au focus sous le MÊME uid ⇒ liste remplacée ; aucun cache privé", async () => {
  const h = identityHarness();
  h.ctrl.identity("INITIAL_SESSION", "user-a");
  const first = h.ctrl.load();
  h.pending[0].resolve(h.page(ID(1)));
  await first;
  const again = h.ctrl.revalidate();
  h.ctrl.identity("TOKEN_REFRESHED", "user-a"); // même uid : rien n’est invalidé
  h.pending[1].resolve(h.page(ID(2)));
  await again;
  same([h.get().status, h.get().items.map((i) => i.id), h.expired()], ["ready", [ID(2)], 0]);
  const src = readFileSync(path.join(ROOT, "components/role/phone-access.tsx"), "utf8");
  assert.doesNotMatch(src, /localStorage\.|sessionStorage\.|setItem\(/); // aucun cache privé
});
