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

// ---- Paiement ------------------------------------------------------------------------------
test("paiement : exactement 2 choix, carte désactivée « Bientôt disponible » (sur place suggéré), aucun « payé »", () => {
  const html = wizard({ initial: state({ step: 4 }) });
  const step = html.slice(html.indexOf("data-booking-payment"), html.indexOf("</fieldset>", html.indexOf("data-booking-payment")));
  const radios = [...step.matchAll(/<input type="radio"([^>]*)\/>/g)].map((m) => m[1]);
  same(radios.map((a) => a.match(/value="([^"]+)"/)![1]), ["on_site", "card_hold"]);
  assert.doesNotMatch(radios[0], /disabled/);
  assert.match(radios[1], /disabled=""/);
  const t = text(step);
  assert.match(t, /Règlement sur place Vous réglez l’artisan après l’intervention\. La demande reste non payée jusque-là\./);
  assert.match(t, /Empreinte bancaire Une autorisation sur votre carte, sans débit à la réservation\. Seul le montant du devis accepté pourra être prélevé ensuite\./);
  assert.match(t, /Bientôt disponible\. En attendant, choisissez le règlement sur place\./);
  // Seule occurrence admise : « non payée » (constat honnête), jamais un état « payé ».
  assert.doesNotMatch(t.replace("reste non payée", ""), /payé|garanti|numéro de carte|cvc|cryptogramme/i);
  assert.doesNotMatch(html, /autocomplete="cc-|name="card/); // jamais de faux formulaire de carte
  // Disponible ⇒ sélectionnable.
  const on = wizard({ initial: state({ step: 4 }), cardAvailable: true });
  assert.doesNotMatch(on.match(/<input type="radio"[^>]*value="card_hold"[^>]*\/>/)![0], /disabled/);
  // Règles : choix requis ; carte refusée tant qu’indisponible.
  same(Object.keys(booking.paymentErrors({ payment: null })), ["payment"]);
  same(booking.paymentErrors({ payment: "card_hold" }), { payment: booking.CARD_UNAVAILABLE });
  same(booking.paymentErrors({ payment: "card_hold" }, true), {});
  same(booking.paymentErrors({ payment: "on_site" }), {});
  same(booking.advanceBooking(state({ step: 4, payment: "card_hold" })).state.step, 4);
  same(booking.advanceBooking(state({ step: 4, payment: "on_site" })).state.step, 5);
  same(Object.values(booking.STEP_ACTION), ["Continuer", "Continuer", "Continuer", "Continuer", "Vérifier mon téléphone"]);
});

test("finishBooking : écrit les deux brouillons AVEC le paiement, sans naviguer (le téléphone vient ensuite)", () => {
  const s = new Mem();
  let saved = 0;
  same(booking.finishBooking({ storage: s as unknown as Storage, service, state: state({ step: 5, payment: "on_site" }), onSaved: () => saved++ }), { ok: true });
  assert.equal(saved, 1);
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.payment, "on_site");
});

test("étape téléphone : PhoneAccess « booking » en ligne, nom/prénom/téléphone repris, barre = même formulaire", () => {
  const html = wizard({ initial: state({ step: 5, payment: "on_site" }), initialPhase: "phone" });
  assert.match(html, /<h2[^>]*>Vérifier mon téléphone<\/h2>/);
  assert.match(html, /data-phone-access="booking" data-phone-stage="form"/);
  assert.doesNotMatch(html, />Prénom</); // déjà saisis à l’étape 2
  assert.match(html, /type="tel"[^>]*value="0696 12 34 56"/);
  assert.match(html, /<form id="booking-phone"/);
  assert.match(html, /<button type="submit" form="booking-phone"[^>]*data-booking-submit="phone"[^>]*>Recevoir un code<\/button>/);
  assert.match(text(html), /aucun compte ni mot de passe n’est nécessaire/);
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
test("/suivi : page thémée, PhoneAccess « lookup » (téléphone + nom + prénom), rien de listé avant vérification", () => {
  const html = render(createElement(suivi.default as never));
  assert.match(html, /class="ui-v2 /);
  assert.match(html, /<h1>Suivre ma demande<\/h1>/);
  assert.match(html, /data-phone-access="lookup" data-phone-stage="form"/);
  for (const label of ["Prénom", "Nom", "Téléphone mobile"]) assert.match(html, new RegExp(`>${label}<`), label);
  assert.doesNotMatch(html, /data-request|Mes demandes|INT-/);
  assert.equal(suivi.metadata.title, "Suivre ma demande — Courant");
  const went: string[] = [];
  const page = render(createElement(phone.PhoneLookupPage as never, { go: (h: string) => went.push(h) } as never));
  assert.match(page, /data-phone-access="lookup"/);
  same(went, []); // aucune navigation avant vérification
});
