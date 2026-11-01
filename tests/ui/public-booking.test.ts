// FASTSPLIT-SERVICE-BOOKING-FLOW-001 — booking wizard on the service pages: fixed bar « Confirmer »
// sharing the main CTA's action, urgency/slot step, private contact validation, address rules,
// summary on every step, and the final local save (two drafts, no personal data in the
// description, honest failure without navigation). SSR + pure; no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { BOOKING_DRAFT_KEY, SLOT_LABEL, readBooking } from "../../components/app/booking-draft";
import { PUBLIC_DRAFT_KEY, readPublicDraft } from "../../lib/shared/request-draft";
import type * as Booking from "../../components/role/public-booking";

const tp = loadModule("components/app/theme-provider.tsx");
const overrides = { "@/components/app/theme-provider": tp };
const booking = loadModule("components/role/public-booking.tsx", overrides) as unknown as typeof Booking;
const servicePage = loadModule("components/role/public-service-page.tsx", overrides) as Record<string, any>;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES.find((s: { slug: string }) => s.slug === "prise-abimee-ou-qui-chauffe");
const render = (node: unknown) => renderToString(createElement(tp.ThemeProvider as never, null, node as never)).replaceAll("<!-- -->", "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const contact = { civility: "mme" as const, first_name: "Camille", last_name: "Durand", email: "camille.durand@example.test", phone: "06 12 34 56 78", company: true };
const address = { address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France" };
const filled = (over: Partial<Booking.BookingState> = {}): Booking.BookingState => ({ ...booking.EMPTY_BOOKING, urgent: false, slot: "day_after", notes: "La prise noircit autour d’une broche.", contact, address, ...over });
const wizard = (over: Partial<Booking.BookingState> = {}) => render(createElement(booking.BookingWizard as never, { service, range: "80 € – 180 €", onClose() {}, initial: { ...booking.EMPTY_BOOKING, ...over } } as never));
class MemoryStorage {
  data = new Map<string, string>();
  fail = new Set<string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail.has(k)) throw new Error("QuotaExceededError"); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

test("page : barre fixe « Confirmer » = même action que le CTA principal (ouvre l’assistant sur place)", () => {
  const html = render(createElement(servicePage.PublicServicePage, { service }));
  assert.match(html, /data-booking-bar=""/);
  const bar = html.slice(html.indexOf("data-booking-bar"));
  assert.match(bar, new RegExp(service.title));
  assert.match(text(bar), /Estimation indicative : 80/);
  const opens = [...html.matchAll(/<button type="button" class="([^"]*)"[^>]*data-booking-open=""[^>]*>([^<]*)/g)].map((m) => m[2].trim());
  same(opens, ["Décrire ma panne", "Décrire ma panne", "Confirmer"]);
  assert.match(bar, /data-booking-open="">Confirmer<\/button>/); // libellé exact
  assert.doesNotMatch(html, /href="\/#new/); // jamais le formulaire générique
  // Réserve basse sur le conteneur ThemeSurface ENTIER (en-tête, main ET pied de page) : la barre
  // fixe ne masque jamais les derniers boutons du pied de page.
  const root = html.match(/<div class="(ui-v2 [^"]*)"/)![1];
  assert.match(root, /\bwithBar\b/);
  const footer = html.indexOf("<footer"), rootEnd = html.lastIndexOf("</div>");
  assert.ok(html.indexOf(`class="${root}"`) < footer && footer < rootEnd);
  // Ouvert : l’assistant remplace le contenu, la catégorie n’est jamais redemandée.
  const opened = render(createElement(servicePage.PublicServicePage, { service, initialOpen: true }));
  assert.match(opened, /data-booking-wizard="" data-step="1"/);
  assert.doesNotMatch(opened, /Type de problème|name="category"/);
});

test("étape 1 : Oui masque les créneaux, Non affiche exactement les 3 souhaits ; barre = « Continuer » soumettant l’étape", () => {
  const none = wizard();
  assert.match(none, /Est-ce urgent \?/);
  assert.doesNotMatch(none, /data-booking-slots/);
  assert.doesNotMatch(wizard({ urgent: true }), /data-booking-slots/);
  const no = wizard({ urgent: false });
  const slots = no.slice(no.indexOf("data-booking-slots"), no.indexOf("</fieldset>", no.indexOf("data-booking-slots")));
  same([...slots.matchAll(/type="radio" name="slot"[^>]*\/>([^<]+)</g)].map((m) => m[1]), ["Demain", "Après-demain", "Dans les prochains jours"]);
  same(Object.values(SLOT_LABEL), ["Demain", "Après-demain", "Dans les prochains jours"]);
  assert.match(text(slots), /pas un rendez-vous réservé/);
  assert.match(no, /<button type="submit" form="booking-step-1"[^>]*>Continuer<\/button>/);
  same(booking.urgencyErrors({ urgent: null, slot: null }), { urgent: "Indiquez si l’intervention est urgente." });
  same(booking.urgencyErrors({ urgent: false, slot: null }), { slot: "Choisissez un créneau souhaité." });
  same(booking.urgencyErrors({ urgent: true, slot: null }), {});
  same(booking.urgencyErrors({ urgent: false, slot: "tomorrow" }), {});
});

test("étape 2 : coordonnées privées, civilité, entreprise informative, validation contactErrors", () => {
  const html = wizard({ step: 2, urgent: true });
  for (const label of ["Madame", "Monsieur", "Non précisé", "Prénom", "Nom", "Adresse email", "Téléphone", "Je fais cette demande pour une entreprise"]) assert.match(html, new RegExp(label), label);
  assert.match(text(html), /restent privées : elles ne figurent pas dans la demande proposée aux artisans/);
  const errors = booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact: { ...contact, first_name: " ", email: "pas-un-email", phone: "12" } });
  same(Object.keys(errors).sort(), ["email", "first_name", "phone"]);
  same(booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact }), {});
});

test("étape 3 : AddressField réutilisé et mêmes contraintes que la demande (adresse 5+, CP 5 chiffres, commune 2+)", () => {
  const html = wizard({ step: 3, urgent: true, contact });
  assert.match(html, /Adresse d’intervention/);
  assert.match(html, /Utiliser ma position|autocomplete="street-address"|role="combobox"/);
  same(Object.keys(booking.addressErrors({ address: "1 r", postal_code: "972", city: "F" })).sort(), ["address", "city", "postal_code"]);
  same(booking.addressErrors(address), {});
});

test("résumé visible à chaque étape ; récapitulatif complet et rien d’envoyé avant connexion", () => {
  for (const step of [1, 2, 3, 4] as const) {
    const html = wizard({ ...filled(), step });
    const summary = html.slice(html.indexOf("data-booking-summary"), html.indexOf("</aside>"));
    assert.match(summary, new RegExp(service.title), `étape ${step}`);
    assert.match(text(summary), /Estimation indicative : 80 € – 180 €/);
    assert.match(text(summary), /Urgence : Après-demain \(créneau souhaité\)/);
  }
  const recap = wizard({ ...filled(), step: 4 });
  const t = text(recap);
  for (const part of [service.title, "80 € – 180 €", "Après-demain", "12 rue des Lilas", "97200 Fort-de-France", "Vos coordonnées (privées)", "Camille Durand", "Demande pour une entreprise"]) assert.ok(t.includes(part), part);
  assert.match(t, /Rien n’est encore envoyé\. À l’étape suivante, vous vous connectez ou créez votre compte, puis vous confirmez l’envoi/);
  assert.match(recap, /form="booking-step-4"[^>]*>Continuer vers la connexion<\/button>/);
});

test("fin : les deux brouillons sont écrits, description sans nom/email/téléphone, puis /#auth", () => {
  const storage = new MemoryStorage();
  const went: string[] = [];
  const result = booking.finishBooking({ storage: storage as unknown as Storage, service, state: filled({ step: 4 }), go: (h) => went.push(h) });
  same(result, { ok: true });
  same(went, ["/#auth"]);
  const draft = readPublicDraft(storage.getItem(PUBLIC_DRAFT_KEY));
  assert.ok(draft);
  same({ ...draft!.values, description: undefined }, { category: "socket", address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", description: undefined });
  assert.match(draft!.values.description, /Prestation choisie : Prise abîmée ou qui chauffe\./);
  assert.match(draft!.values.description, /Créneau souhaité : après-demain\./);
  for (const personal of ["Camille", "Durand", "camille.durand@example.test", "06 12 34 56 78", "Madame"]) assert.ok(!draft!.values.description.includes(personal), personal);
  const stored = readBooking(storage.getItem(BOOKING_DRAFT_KEY));
  assert.ok(stored);
  same(stored!.booking.contact, contact);
  same([stored!.booking.slug, stored!.booking.urgent, stored!.booking.slot], [service.slug, false, "day_after"]);
  // Urgent : pas de créneau, urgence « urgent ».
  const s2 = new MemoryStorage();
  booking.finishBooking({ storage: s2 as unknown as Storage, service, state: filled({ step: 4, urgent: true, slot: "tomorrow" }), go: () => {} });
  assert.equal(readPublicDraft(s2.getItem(PUBLIC_DRAFT_KEY))!.values.urgency, "urgent");
  assert.equal(readBooking(s2.getItem(BOOKING_DRAFT_KEY))!.booking.slot, null);
});

test("échec d’enregistrement : aucune navigation, message honnête (stockage absent, brouillon refusé, extras refusés)", () => {
  for (const make of [() => null, () => Object.assign(new MemoryStorage(), { fail: new Set([PUBLIC_DRAFT_KEY]) }), () => Object.assign(new MemoryStorage(), { fail: new Set([BOOKING_DRAFT_KEY]) })]) {
    const went: string[] = [];
    const result = booking.finishBooking({ storage: make() as unknown as Storage | null, service, state: filled({ step: 4 }), go: (h) => went.push(h) });
    assert.equal(result.ok, false);
    same(went, []);
    assert.match((result as { message: string }).message, /n’a pas pu être conservée dans ce navigateur.*Rien n’a été envoyé/);
  }
});
