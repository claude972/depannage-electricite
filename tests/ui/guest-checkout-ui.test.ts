// Guest checkout UI (docs/GUEST_CHECKOUT_CONTRACT.md): payment step (on site / card authorisation,
// card disabled until available, honest copy), drafts store the payment, the last step leads to the
// e-mail account (create or sign in) with the request kept — no SMS code anywhere — and /suivi.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadModule } from "../documents/harness";
import * as draftModule from "../../components/app/booking-draft";
import { BOOKING_DRAFT_KEY, readBooking } from "../../components/app/booking-draft";
import { PUBLIC_DRAFT_KEY } from "../../lib/shared/request-draft";
import type * as Booking from "../../components/role/public-booking";
import type * as Options from "../../components/role/booking-options";

const tp = loadModule("components/app/theme-provider.tsx");
// vm harness has no `crypto`: the real booking-draft module (Node crypto.randomUUID) is injected.
const overrides = { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule };
const booking = loadModule("components/role/public-booking.tsx", overrides) as unknown as typeof Booking;
const options = loadModule("components/role/booking-options.ts", overrides) as unknown as typeof Options;
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
const OPTS = ({ card = false, reason = "Le paiement par carte n’est pas encore activé." } = {}): Options.OptionsState => ({
  status: "ready",
  options: {
    payment_methods: [
      { id: "on_site", available: true, label: "Sur place", description: "x" },
      { id: "card_hold", available: card, label: "Empreinte", description: "y", ...(card ? {} : { reason }) },
    ],
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
  assert.match(t, /Après intervention, sur la plateforme Réglez après les travaux sur notre plateforme, par carte via votre suivi, un lien sécurisé ou un QR code\. Aucun paiement direct à l’artisan\./);
  assert.match(t, /Empreinte bancaire Une autorisation sur votre carte, sans débit à la réservation\. Seul le montant du devis accepté pourra être prélevé ensuite\./);
  assert.match(t, /Le paiement par carte n’est pas encore activé\./); // raison du serveur
  assert.doesNotMatch(t.replace("reste non payée", ""), /payé|garanti|numéro de carte|cvc|cryptogramme/i);
  assert.doesNotMatch(step, /autocomplete="cc-|name="card/i); // jamais de faux formulaire de carte
  // Sans raison serveur : copie honnête de repli.
  const fallback = OPTS();
  (fallback as { options: Options.BookingOptions }).options.payment_methods[1] = { id: "card_hold", available: false };
  assert.match(text(radiosOf(wizard({ initial: state({ step: 4 }), initialOptions: fallback })).step), /Bientôt disponible\. En attendant, choisissez le paiement après intervention sur la plateforme\./);
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

test("dernière étape : « Créer mon compte » puis « J’ai déjà un compte » ; aucune étape SMS, quelles que soient les options", () => {
  for (const initialOptions of [OPTS(), OPTS({ card: true }), { status: "error" }, { status: "loading" }]) {
    const html = wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions });
    assert.match(html, /data-booking-inline-submit="5">Créer mon compte<\/button>/);
    assert.match(html, /form="booking-step-5"[^>]*data-booking-submit="5">Créer mon compte<\/button>/);
    assert.match(html, /data-booking-account="">J’ai déjà un compte<\/button>/);
    const t = text(html);
    assert.match(t, /Rien n’est encore envoyé\. Votre demande est conservée dans cet onglet pendant 30 minutes\./);
    assert.match(t, /adresse e-mail et un mot de passe.*lien de confirmation reçu par e-mail.*connectez-vous dans cet onglet/);
    assert.match(t, /camille@example\.test · 0696 12 34 56/); // les deux coordonnées sont relues
    assert.doesNotMatch(html, /data-phone-access|one-time-code|data-booking-submit="phone"/);
    assert.doesNotMatch(t, /SMS|Recevoir un code|Valider le code|Vérifier mon téléphone|code à 6 chiffres/i);
  }
  // Une ancienne réponse d’options (clé phone_auth des binaires mobiles) ne rouvre rien sur le site.
  const legacy = { status: "ready", options: { ...OPTS().options, phone_auth: { available: true } } };
  assert.doesNotMatch(wizard({ initial: state({ step: 5, payment: "on_site" }), initialOptions: legacy, initialPhase: "phone" }), /data-phone-access|Recevoir un code|Vérifier mon téléphone/);
});

test("passage au compte e-mail : brouillons enregistrés AVANT de partir ; création ⇒ /#auth/signup, connexion ⇒ /#auth", () => {
  same(booking.ACCOUNT_HREF, { signup: "/#auth/signup", login: "/#auth" });
  for (const [mode, href] of [["signup", "/#auth/signup"], ["login", "/#auth"]] as const) {
    const s = new Mem();
    const went: string[] = [];
    let stored = false;
    same(booking.completeBooking({ storage: s as unknown as Storage, service, state: state({ step: 5, payment: "on_site" }), mode, go: (h) => { stored = !!s.getItem(BOOKING_DRAFT_KEY); went.push(h); } }), { ok: true });
    same(went, [href]);
    assert.equal(stored, true); // la demande est déjà en mémoire quand la navigation part
    const kept = readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking;
    same([kept.payment, kept.contact.email, kept.contact.phone], ["on_site", "camille@example.test", "0696 12 34 56"]);
    assert.match(String(s.getItem(PUBLIC_DRAFT_KEY)), /12 rue des Lilas.*97200.*Fort-de-France/); // l’adresse suit aussi
    // Enregistrement impossible ⇒ aucune navigation : on ne quitte jamais l’écran en perdant la saisie.
    const none: string[] = [];
    assert.equal(booking.completeBooking({ storage: null, service, state: state({ step: 5, payment: "on_site" }), mode, go: (h) => none.push(h) }).ok, false);
    same(none, []);
  }
});

test("coordonnées (étape 2) : e-mail ET téléphone obligatoires avant d’avancer ; +596, +590 ou +33", () => {
  const avail = booking.paymentAvailability(OPTS());
  const at2 = (over: Partial<typeof contact>) => booking.advanceBooking(state({ step: 2, contact: { ...contact, ...over } }), avail);
  assert.equal(at2({}).state.step, 3);
  for (const over of [{ email: "" }, { email: "camille@" }, { phone: "" }, { phone: "+447700900123" }, { phone: "0692 12 34 56" }, { first_name: " " }, { last_name: "" }]) assert.equal(at2(over).state.step, 2, JSON.stringify(over));
  for (const value of ["0696 12 34 56", "0690 12 34 56", "06 12 34 56 78", "+596 696 12 34 56", "+590 690 12 34 56", "+33 6 12 34 56 78"]) assert.equal(at2({ phone: value }).state.step, 3, value);
  const html = wizard({ initial: state({ step: 2 }), initialOptions: OPTS() });
  assert.match(html, /type="email"[^>]*required=""|required=""[^>]*type="email"/);
  assert.match(html, /type="tel"[^>]*required=""|required=""[^>]*type="tel"/);
  assert.doesNotMatch(text(html), /facultatif.{0,40}e-mail|e-mail.{0,40}facultatif/i);
});

test("options : GET same-origin no-store, analyse stricte ; échec / forme inattendue ⇒ null (jamais « disponible »)", async () => {
  const calls: RequestInit[] = [];
  const reply = (status: number, body: unknown) => (async (_u: string, init: RequestInit) => { calls.push(init); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const methods = [{ id: "on_site", available: true, label: "a", description: "b" }, { id: "card_hold", available: false, label: "c", description: "d", reason: "Pas encore activé." }];
  const good = { payment_methods: methods, currency: "eur" };
  // La réponse du serveur garde la clé phone_auth pour les binaires mobiles livrés : le site ne la lit pas.
  same(await options.createOptionsApi(reply(200, { ...good, phone_auth: { available: true } }))(), good);
  same([calls[0].method, calls[0].credentials, calls[0].cache], ["GET", "same-origin", "no-store"]);
  same(await options.createOptionsApi(reply(200, good))(), good);
  assert.equal(await options.createOptionsApi(reply(503, good))(), null);
  assert.equal(await options.createOptionsApi(reply(200, { payment_methods: [{ id: "cash", available: true }] }))(), null);
  assert.equal(await options.createOptionsApi(reply(200, { payment_methods: [{ id: "on_site", available: "yes" }] }))(), null);
  assert.equal(options.parseBookingOptions(null), null);
  const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  assert.equal(await options.createOptionsApi(never, { timeoutMs: 20 })(), null); // délai : jamais de chargement infini
  const src = readFileSync(path.join(ROOT, "components/role/booking-options.ts"), "utf8");
  assert.doesNotMatch(src, /console\.\w+\(|localStorage\.|sessionStorage\.|api\/auth\/phone|phoneAuthOn|PhoneAccess/);
});

// ---- /suivi ----------------------------------------------------------------------------------
// ---- /suivi ----------------------------------------------------------------------------------
test("/suivi : retrouve une intervention par connexion e-mail, sans demander de numéro ni de code SMS", () => {
  const page = render(createElement(suivi.default as never));
  assert.match(page, /class="ui-v2 /);
  assert.match(page, /<h1>Suivre ma demande<\/h1>/);
  assert.doesNotMatch(page, /data-phone-access|type="tel"|suivi par SMS|data-request|INT-[a-f0-9]{6}/i);
  assert.match(page, /href="\/#auth\/requests">Me connecter à mon compte<\/a>/);
  assert.match(text(page), /par e-mail.*Mes demandes.*numéro de commande/);
  assert.equal(suivi.metadata.title, "Suivre ma demande — Dépannage électrique");
});

test("site : plus aucun écran, composant ni appel de vérification par SMS", () => {
  for (const gone of ["components/role/phone-access.tsx", "components/role/phone-access.module.css", "components/role/account-upgrade.tsx", "components/role/account-upgrade.module.css"]) assert.equal(existsSync(path.join(ROOT, gone)), false, gone);
  for (const file of ["components/role/public-booking.tsx", "components/role/booking-confirm.tsx", "components/role/account-lookup-page.tsx", "components/role/client-space.tsx", "components/app/forms.tsx", "components/courant-app.tsx"]) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(src, /api\/auth\/phone|PhoneAccess|AccountUpgrade|phone-access|account-upgrade|one-time-code|signInWithOtp|phone_change|code_requested/, file);
  }
});
