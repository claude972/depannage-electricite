// FASTSPLIT-SERVICE-BOOKING-FLOW-001 — booking wizard on the service pages: fixed bar « Demander cette intervention »
// sharing the main CTA's action, urgency/slot step, private contact validation, address rules,
// summary on every step, and the final local save (two drafts, no personal data in the
// description, honest failure without navigation). SSR + pure; no browser.
import test from "node:test";
import * as draftModule from "../../components/app/booking-draft";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadModule } from "../documents/harness";
import { canAccess, loginLanding, protectedLink } from "../../components/app/session";
import { BOOKING_DRAFT_KEY, SLOT_LABEL, readBooking } from "../../components/app/booking-draft";
import { PUBLIC_DRAFT_KEY, readPublicDraft } from "../../lib/shared/request-draft";
import type * as Booking from "../../components/role/public-booking";

const tp = loadModule("components/app/theme-provider.tsx");
// vm harness has no `crypto`: the real booking-draft module (Node crypto.randomUUID) is injected.
const overrides = { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule };
const booking = loadModule("components/role/public-booking.tsx", overrides) as unknown as typeof Booking;
const servicePage = loadModule("components/role/public-service-page.tsx", overrides) as Record<string, any>;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES.find((s: { slug: string }) => s.slug === "prise-abimee-ou-qui-chauffe");
const render = (node: unknown) => renderToString(createElement(tp.ThemeProvider as never, null, node as never)).replaceAll("<!-- -->", "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const contact = { civility: "mme" as const, first_name: "Camille", last_name: "Durand", email: "camille.durand@example.test", phone: "06 12 34 56 78", company: false };
const address = { address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France" };
const filled = (over: Partial<Booking.BookingState> = {}): Booking.BookingState => ({ ...booking.EMPTY_BOOKING, urgent: false, slot: "day_after", notes: "La prise noircit autour d’une broche.", contact, address, payment: "on_site", ...over });
// Server options (GET /api/bookings/options) as a fake: on-site available.
const OPTIONS = { status: "ready", options: { payment_methods: [{ id: "on_site", available: true }, { id: "card_hold", available: false }], currency: "eur" } } as const;
const AVAILABLE = { on_site: { available: true } };
const wizard = (over: Partial<Booking.BookingState> = {}) => render(createElement(booking.BookingWizard as never, { service, range: "80 € – 180 €", onClose() {}, initial: { ...booking.EMPTY_BOOKING, ...over }, initialOptions: OPTIONS } as never));
class MemoryStorage {
  data = new Map<string, string>();
  fail = new Set<string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail.has(k)) throw new Error("QuotaExceededError"); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

test("page : barre fixe « Demander cette intervention » = même action que le CTA principal (ouvre l’assistant sur place)", () => {
  const html = render(createElement(servicePage.PublicServicePage, { service }));
  // Page fermée : barre COMPACTE (fourchette + légende + « Demander cette intervention », sans titre long).
  assert.match(html, /data-booking-bar="compact"/);
  const bar = html.slice(html.indexOf("data-booking-bar"));
  assert.doesNotMatch(bar, new RegExp(service.title));
  // PUB-02: the bar's range comes from GET /api/public/indicative-prices at runtime (fallback in SSR).
  assert.match(text(bar), /lecture en cours.*Estimation indicative/);
  assert.doesNotMatch(text(bar), /\d+,\d{2}\s?€/);
  const opens = [...html.matchAll(/<button type="button" class="([^"]*)"[^>]*data-booking-open=""[^>]*>([^<]*)/g)].map((m) => m[2].trim());
  same(opens, ["Demander cette intervention", "Demander cette intervention"]); // héros + barre : même action
  assert.match(bar, /data-booking-open="">Demander cette intervention<\/button>/); // libellé exact
  assert.doesNotMatch(html, /href="\/#new/); // jamais le formulaire générique
  // Réserve basse sur le conteneur ThemeSurface ENTIER (en-tête, main ET pied de page) : la barre
  // fixe ne masque jamais les derniers boutons du pied de page.
  const root = html.match(/<div class="(ui-v2 [^"]*)"/)![1];
  assert.match(root, /\bwithBar\b/);
  assert.match(root, /\bwithCompactBar\b/);
  const footer = html.indexOf("<footer"), rootEnd = html.lastIndexOf("</div>");
  assert.ok(html.indexOf(`class="${root}"`) < footer && footer < rootEnd);
  // Hauteur de barre = UNE propriété (--booking-bar-h) partagée par la barre, la réserve et la
  // marge de défilement des champs : 88 px (réserve 112 px) ; 152 px empilée en étroit (réserve 176 px).
  const serviceCss = readFileSync(path.join(ROOT, "components/role/public-service.module.css"), "utf8");
  const bookingCss = readFileSync(path.join(ROOT, "components/role/public-booking.module.css"), "utf8");
  const summaryStyle = bookingCss.match(/\.summary \{([^}]*)\}/)![1];
  assert.match(summaryStyle, /border: 1px solid var\(--ui-border\);/);
  assert.doesNotMatch(summaryStyle, /border-(?:left|inline-start)|box-shadow/);
  const wide = Number(serviceCss.match(/\.withBar \{\s*--booking-bar-h: (\d+)px;/)![1]);
  const narrowH = Number(serviceCss.match(/@media \(max-width: 480px\) \{\s*\.withBar \{\s*--booking-bar-h: (\d+)px;/)![1]);
  assert.match(serviceCss, /\.withBar \{[^}]*padding-bottom: calc\(var\(--booking-bar-h\) \+ 24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.equal(wide + 24, 112, "réserve large = 112 px + safe-area");
  assert.ok(narrowH + 24 >= 176, "réserve étroite ≥ 176 px + safe-area");
  assert.match(bookingCss, /\.bar \{[^}]*min-height: calc\(var\(--booking-bar-h, 88px\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(bookingCss, /scroll-margin-bottom: calc\(var\(--booking-bar-h, 88px\) \+ 24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  const button = Number(bookingCss.match(/\.barButton \{[^}]*min-height: (\d+)px/)![1]);
  assert.ok(button >= 44);
  const row = 12 + button + 12 + 1; // contenu en ligne : padding + bouton + bordure
  const stacked = 10 + Math.ceil(14 * 1.35) + 2 + Math.ceil(13 * 1.35) + 8 + button + 10 + 1; // texte au-dessus, bouton pleine largeur
  assert.ok(wide >= row, `hauteur déclarée ${wide} ≥ contenu en ligne ${row}`);
  assert.ok(narrowH >= stacked, `hauteur déclarée ${narrowH} ≥ contenu empilé ${stacked}`);
  // Barre compacte (page fermée) : sa propre hauteur, une seule ligne même à 360.
  const compactH = Number(serviceCss.match(/\.withBar\.withCompactBar \{\s*--booking-bar-h: (\d+)px;/)![1]);
  const compactContent = 8 + button + 8 + 1;
  assert.ok(compactH >= compactContent && compactH <= 80, `compacte ${compactH} ≥ contenu ${compactContent}, ≤ 80`);
  assert.ok(compactH + 24 >= compactContent + 24, "réserve compacte = hauteur + 24 px + safe-area");
  assert.match(bookingCss, /\.bar\.barCompact \{\s*padding-top: 8px;/);
  const compactNarrow = bookingCss.slice(bookingCss.lastIndexOf("@media (max-width: 480px)"));
  assert.match(compactNarrow, /\.barCompact \.barInner \{\s*flex-direction: row;/);
  // L’assistant garde sa barre 88 / 152 px (pas de classe compacte une fois ouvert).
  const wizardPage = render(createElement(servicePage.PublicServicePage, { service, initialOpen: true }));
  assert.doesNotMatch(wizardPage.match(/<div class="(ui-v2 [^"]*)"/)![1], /withCompactBar/);
  assert.match(wizardPage, /data-booking-bar=""/);
  const narrowBar = bookingCss.slice(bookingCss.indexOf("/* Narrow screens"), bookingCss.indexOf("/* Compact bar"));
  assert.match(narrowBar, /\.barInner \{\s*flex-direction: column;/);
  assert.match(narrowBar, /\.barButton \{\s*width: 100%;/);
  assert.match(bookingCss, /\.barButton \{[^}]*white-space: nowrap;/);
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

test("une réservation entreprise ouvre la liste des sites du compte professionnel sans soumettre le formulaire", () => {
  const html = wizard();
  const href = html.match(/href="([^"]+)">Ouvrir l’espace entreprise/)?.[1];
  assert.equal(href, "/#sites");
  assert.match(text(html), /créez la demande pour un site auquel vous avez accès/);
  const hash = new URL(href!, "https://app.example").hash;
  const pending = protectedLink(hash);
  assert.equal(pending?.view, "sites");
  assert.equal(canAccess("sites", null, "public"), false);
  assert.equal(canAccess("sites", "client", "live"), false);
  assert.equal(loginLanding("", pending, "client"), null);
  assert.equal(loginLanding("", pending, "manager")?.view, "sites");
});

test("étape 2 : coordonnées privées, civilité, validation contactErrors", () => {
  const html = wizard({ step: 2, urgent: true });
  for (const label of ["Madame", "Monsieur", "Non précisé", "Prénom", "Nom", "Adresse e-mail", "Téléphone"]) assert.match(html, new RegExp(label), label);
  assert.doesNotMatch(html, /Je fais cette demande pour une entreprise/);
  assert.match(text(html), /restent privées : elles ne figurent pas dans la demande proposée aux artisans/);
  const errors = booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact: { ...contact, first_name: " ", email: "pas-un-email", phone: "12" } });
  same(Object.keys(errors).sort(), ["email", "first_name", "phone"]);
  same(booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact }), {});
  // Site : l’adresse e-mail est obligatoire (elle devient le compte), le téléphone en +596, +590 ou +33.
  assert.doesNotMatch(text(html), /Facultatif/);
  assert.match(text(html), /Elle servira à créer votre compte et à suivre la demande\./);
  assert.match(text(html), /Indicatif \+596, \+590 ou \+33\./);
  same(Object.keys(booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact: { ...contact, email: "" } })), ["email"]);
  same(Object.keys(booking.stepErrors({ ...booking.EMPTY_BOOKING, step: 2, contact: { ...contact, phone: "+44 7700 900123" } })), ["phone"]);
});

test("étape 3 : AddressField réutilisé et mêmes contraintes que la demande (adresse 5+, CP 5 chiffres, commune 2+)", () => {
  const html = wizard({ step: 3, urgent: true, contact });
  assert.match(html, /Adresse d’intervention/);
  assert.match(html, /Utiliser ma position|autocomplete="street-address"|role="combobox"/);
  same(Object.keys(booking.addressErrors({ address: "1 r", postal_code: "972", city: "F" })).sort(), ["address", "city", "postal_code"]);
  same(booking.addressErrors(address), {});
});

test("résumé visible à chaque étape ; récapitulatif complet et rien d’envoyé avant le compte e-mail confirmé", () => {
  for (const step of [1, 2, 3, 4, 5] as const) {
    const html = wizard({ ...filled(), step });
    const summary = html.slice(html.indexOf("data-booking-summary"), html.indexOf("</aside>"));
    assert.match(summary, new RegExp(service.title), `étape ${step}`);
    // PUB-02: the live range is read at runtime (fallback in the server HTML), never the static amount.
    assert.match(text(summary), /Estimation indicative : lecture en cours/);
    assert.match(text(summary), /Urgence : Après-demain \(créneau souhaité\)/);
  }
  const recap = wizard({ ...filled(), step: 5 });
  const t = text(recap);
  for (const part of [service.title, "lecture en cours", "Après-demain", "12 rue des Lilas", "97200 Fort-de-France", "Vos coordonnées (privées)", "Camille Durand", "Règlement", "Après intervention — paiement sur la plateforme"]) assert.ok(t.includes(part), part);
  assert.match(t, /Rien n’est encore envoyé\. Votre demande est conservée dans cet onglet pendant 30 minutes\. Créez votre compte avec votre adresse e-mail et un mot de passe, ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous dans cet onglet : vous relirez la demande avant de confirmer son envoi\./);
  assert.match(recap, /form="booking-step-5"[^>]*>Créer mon compte<\/button>/);
  assert.match(recap, /data-booking-inline-submit="5">Créer mon compte<\/button>/);
  assert.match(recap, /data-booking-account="">J’ai déjà un compte<\/button>/);
  assert.doesNotMatch(t, /SMS|code à|Vérifier mon téléphone/);
});

test("fin : les deux brouillons sont écrits, description sans nom/email/téléphone, puis /#auth", () => {
  const storage = new MemoryStorage();
  const went: string[] = [];
  const result = booking.finishBooking({ storage: storage as unknown as Storage, service, state: filled({ step: 4 }), onSaved: () => went.push("saved") });
  same(result, { ok: true });
  same(went, ["saved"]);
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
  booking.finishBooking({ storage: s2 as unknown as Storage, service, state: filled({ step: 4, urgent: true, slot: "tomorrow" }) });
  assert.equal(readPublicDraft(s2.getItem(PUBLIC_DRAFT_KEY))!.values.urgency, "urgent");
  assert.equal(readBooking(s2.getItem(BOOKING_DRAFT_KEY))!.booking.slot, null);
});

test("échec d’enregistrement : aucune navigation, message honnête (stockage absent, brouillon refusé, extras refusés)", () => {
  for (const make of [() => null, () => Object.assign(new MemoryStorage(), { fail: new Set([PUBLIC_DRAFT_KEY]) }), () => Object.assign(new MemoryStorage(), { fail: new Set([BOOKING_DRAFT_KEY]) })]) {
    const went: string[] = [];
    const result = booking.finishBooking({ storage: make() as unknown as Storage | null, service, state: filled({ step: 4 }), onSaved: () => went.push("saved") });
    assert.equal(result.ok, false);
    same(went, []);
    assert.match((result as { message: string }).message, /n’a pas pu être conservée dans ce navigateur.*Rien n’a été envoyé/);
  }
});

// ---- Paire tout-ou-rien (revue indépendante de 35a07bd) -----------------------------------------
const OLD_DRAFT = JSON.stringify({ savedAt: Date.now() - 60_000, values: { category: "socket", description: "Ancien brouillon de prise", address: "1 rue Ancienne", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" } });
const OLD_BOOKING = JSON.stringify({ savedAt: Date.now() - 60_000, booking: { slug: "prise-qui-ne-fonctionne-plus", urgent: true, slot: null, notes: "", contact: { civility: "m", first_name: "Ancien", last_name: "Contact", email: "ancien@example.test", phone: "0600000000", company: false } } });
const oldPair = (s: MemoryStorage) => { s.data.set(PUBLIC_DRAFT_KEY, OLD_DRAFT); s.data.set(BOOKING_DRAFT_KEY, OLD_BOOKING); return s; };
const panel = () => catalog.SERVICES.find((x: { slug: string }) => x.slug === "panne-tableau-electrique");
const finish = (storage: MemoryStorage) => {
  const went: string[] = [];
  const result = booking.finishBooking({ storage: storage as unknown as Storage, service: panel(), state: filled({ step: 4, address: { address: "9 avenue Nouvelle", postal_code: "97232", city: "Le Lamentin" } }), onSaved: () => went.push("saved") });
  return { result, went };
};

test("paire : 2e écriture refusée ⇒ les DEUX entrées reviennent exactement à l’ancienne paire, aucune navigation", () => {
  const s = oldPair(new MemoryStorage());
  s.fail.add(BOOKING_DRAFT_KEY);
  const { result, went } = finish(s);
  assert.equal(result.ok, false);
  same(went, []);
  assert.equal(s.getItem(PUBLIC_DRAFT_KEY), OLD_DRAFT);
  assert.equal(s.getItem(BOOKING_DRAFT_KEY), OLD_BOOKING);
  assert.equal((result as { message: string }).message, booking.SAVE_FAILED_MESSAGE);
});

test("paire : 1re écriture refusée ⇒ ancienne paire intacte ; sans paire préalable ⇒ rien ne reste", () => {
  const s = oldPair(new MemoryStorage());
  s.fail.add(PUBLIC_DRAFT_KEY);
  const a = finish(s);
  assert.equal(a.result.ok, false);
  same(a.went, []);
  assert.equal(s.getItem(PUBLIC_DRAFT_KEY), OLD_DRAFT);
  assert.equal(s.getItem(BOOKING_DRAFT_KEY), OLD_BOOKING);
  const empty = new MemoryStorage();
  empty.fail.add(BOOKING_DRAFT_KEY);
  const b = finish(empty);
  assert.equal(b.result.ok, false);
  same(b.went, []);
  same([...empty.data.keys()], []); // le brouillon public écrit est retiré : pas de demi-paire
});

test("paire : relecture différente de l’écriture ⇒ restauration de l’ancienne paire, aucune navigation", () => {
  class Lossy extends MemoryStorage {
    setItem(k: string, v: string) { super.setItem(k, k === BOOKING_DRAFT_KEY && !v.includes("ancien@") ? v.replace("Camille", "Autre") : v); }
  }
  const s = oldPair(new Lossy());
  const { result, went } = finish(s);
  assert.equal(result.ok, false);
  same(went, []);
  assert.equal(s.getItem(PUBLIC_DRAFT_KEY), OLD_DRAFT);
  assert.equal(s.getItem(BOOKING_DRAFT_KEY), OLD_BOOKING);
});

test("paire : restauration impossible à prouver ⇒ message honnête « votre saisie reste sur cette page », aucune navigation", () => {
  class Stuck extends MemoryStorage {
    writes = 0;
    setItem(k: string, v: string) { this.writes++; if (this.writes > 1) throw new Error("QuotaExceededError"); super.setItem(k, v); }
    removeItem() { throw new Error("SecurityError"); }
  }
  const s = oldPair(new Stuck());
  const { result, went } = finish(s);
  assert.equal(result.ok, false);
  same(went, []);
  assert.equal((result as { message: string }).message, booking.ROLLBACK_FAILED_MESSAGE);
  assert.match(booking.ROLLBACK_FAILED_MESSAGE, /Rien n’a été envoyé ; votre saisie reste sur cette page/);
  // Lecture initiale impossible ⇒ aucune écriture du tout.
  class Blind extends MemoryStorage { getItem(): string | null { throw new Error("SecurityError"); } }
  const blind = new Blind();
  const r = finish(blind);
  assert.equal(r.result.ok, false);
  same(r.went, []);
  same([...blind.data.keys()], []);
});

test("paire : succès ⇒ les deux nouvelles entrées remplacent l’ancienne paire, puis /#auth", () => {
  const s = oldPair(new MemoryStorage());
  const { result, went } = finish(s);
  same(result, { ok: true });
  same(went, ["saved"]);
  assert.equal(readPublicDraft(s.getItem(PUBLIC_DRAFT_KEY))!.values.category, "panel");
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.slug, "panne-tableau-electrique");
});

// ---- Barre stable : aucun changement de position piloté par le focus ---------------------------
test("barre toujours fixe : aucun basculement focus/blur dans le source ; bouton = submit natif du formulaire de l’étape", () => {
  const tsx = readFileSync(path.join(ROOT, "components/role/public-booking.tsx"), "utf8");
  const css = readFileSync(path.join(ROOT, "components/role/public-booking.module.css"), "utf8");
  assert.doesNotMatch(tsx, /data-typing|focusin|focusout|onFocus|onBlur/);
  assert.doesNotMatch(css, /data-typing/);
  // Toute règle visant la barre elle-même (.bar, hors .barInner/.barText/.barButton) garde position: fixed.
  const barRules = [...css.matchAll(/([^{}]*\.bar(?![A-Za-z])[^{}]*)\{([^}]*)\}/g)];
  assert.ok(barRules.length >= 2);
  for (const [, , body] of barRules) for (const m of body.matchAll(/position:\s*([a-z]+)/g)) assert.equal(m[1], "fixed");
  for (const step of [1, 2, 3, 4] as const) {
    const html = wizard({ ...filled(), step });
    assert.match(html, new RegExp(`<form id="booking-step-${step}"`));
    assert.match(html, new RegExp(`<button type="submit" form="booking-step-${step}"[^>]*data-booking-submit="${step}"`));
  }
});

test("« Continuer » après saisie des notes, du téléphone et de l’adresse fait avancer (logique pure du clic)", () => {
  // Prouvé ici : la règle appliquée par le submit (advanceBooking) avance avec ces saisies, et le
  // bouton de barre est un submit natif lié au formulaire de l’étape. NON prouvé ici : le tap réel
  // sur mobile (événements tactiles, clavier virtuel) — rejoué par ROOT en navigateur.
  let s1: Booking.BookingState = { ...booking.EMPTY_BOOKING, urgent: false, slot: "tomorrow", notes: "Odeur de chaud près de la prise du salon." };
  let r = booking.advanceBooking(s1);
  same([r.state.step, r.errors, r.finish], [2, {}, false]);
  s1 = { ...r.state, contact: { ...contact, phone: "0696 12 34 56" } };
  r = booking.advanceBooking(s1);
  same([r.state.step, r.errors, r.finish], [3, {}, false]);
  r = booking.advanceBooking({ ...r.state, address });
  same([r.state.step, r.errors, r.finish], [4, {}, false]);
  r = booking.advanceBooking({ ...r.state, payment: "on_site" }, AVAILABLE);
  same([r.state.step, r.errors, r.finish], [5, {}, false]);
  r = booking.advanceBooking(r.state);
  same([r.state.step, r.finish], [5, true]);
  // Erreurs : pas d’avancée, saisies conservées.
  const bad = { ...booking.EMPTY_BOOKING, step: 2 as const, notes: "gardé", contact: { ...contact, phone: "12" } };
  const kept = booking.advanceBooking(bad);
  same([kept.state.step, Object.keys(kept.errors), kept.state.notes, kept.state.contact.first_name], [2, ["phone"], "gardé", "Camille"]);
});
