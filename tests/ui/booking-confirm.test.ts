// Post-login booking confirmation: explicit click only, PATCH profile then ONE POST, double click
// refused, failures keep the draft, an over-long contact never reaches the API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingConfirm } from "../../components/role/booking-confirm";
import type { BookingDraft } from "../../components/app/booking-draft";

const draft = { category: "socket" as const, description: "Prestation choisie : Plusieurs prises sans courant.\nCréneau souhaité : demain.", address: "2 rue Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" as const };
const booking: BookingDraft = { slug: "plusieurs-prises-sans-courant", urgent: false, slot: "tomorrow", notes: "", contact: { civility: "mme", first_name: "Léa", last_name: "Martin", email: "lea@example.test", phone: "0696 12 34 56", company: false } };

test("confirmation renders the recap, private contact apart from the description, and an explicit send button", () => {
  const html = renderToStaticMarkup(createElement(BookingConfirm, { draft, booking, busy: false, profileId: "u1", confirmBooking: async () => true, onEdit() {}, onContactChange() {} }));
  assert.match(html, /Confirmez l’envoi de votre demande/);
  assert.match(html, /Rien n’a encore été envoyé/);
  assert.match(html, /Plusieurs prises sans courant/);
  assert.match(html, /souhait, pas un rendez-vous réservé/);
  assert.match(html, /pas un prix garanti/);
  assert.match(html, /data-booking-send=""[^>]*>Envoyer ma demande/);
  assert.match(html, /Modifier mes coordonnées/);
  assert.match(html, /Modifier la demande/);
  assert.ok(!draft.description.includes("Martin") && !draft.description.includes("0696"), "contact never in the description");
});

test("un ancien brouillon déclaré entreprise ne peut pas être envoyé comme demande personnelle", () => {
  const html = renderToStaticMarkup(createElement(BookingConfirm, {
    draft,
    booking: { ...booking, contact: { ...booking.contact, company: true }, payment: "card_hold" },
    busy: false,
    profileId: "u1",
    confirmBooking: async () => { throw new Error("Envoi inattendu"); },
    onEdit() {},
    onContactChange() {},
    verifyCardHold: async () => { throw new Error("Vérification inattendue"); },
  }));
  assert.match(html, /href="\/#auth\/sites">Ouvrir l’espace entreprise/);
  assert.doesNotMatch(html, /data-booking-send|Vérifier mon empreinte|Modifier la demande/);
});

test("send logic: one confirmBooking call, double click refused, invalid contact or missing payment ⇒ no call", () => {
  const src = readFileSync("components/role/booking-confirm.tsx", "utf8");
  assert.match(src, /if \(inFlight\.current \|\| busy\) return; \/\/ one POST only/);
  const send = src.slice(src.indexOf("async function send()"));
  const checked = send.indexOf("contactErrors(contact, contactRule)");
  assert.ok(checked > 0 && checked < send.indexOf("await confirmBooking()"));
  assert.match(src, /const contactRule = \{ emailRequired: !demo \};/, "live: the contact e-mail is required before sending");
  assert.ok(send.indexOf("if (!booking.payment)") < send.indexOf("await confirmBooking()"));
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /updateProfile|createIntervention|\/api\/interventions/, "booking never uses the legacy create");
});

test("wiring: client « new » shows the confirmation only with a draft + booking of this identity; no POST on login", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /if \(session\.booking && session\.pendingDraft && !editBooking\)/);
  assert.match(client, /initialValues=\{session\.pendingDraft\}/);
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /booking: mode === "live" \? \(pendingDraft \? liveBooking : null\) : demoBooking\?\.booking \?\? null/);
  // liveBooking = the kept booking, with the account address as contact e-mail only when it has none.
  assert.match(app, /const liveBooking = booking && !booking\.contact\.email\.trim\(\) && accountEmail \? \{ \.\.\.booking, contact: \{ \.\.\.booking\.contact, email: accountEmail \} \} : booking;/);
  assert.match(app, /clearBooking\(getDraftStorage\(\)\);\s*try \{\s*sessionStorage\.removeItem\(DRAFT_KEY\);/, "dropped on identity reset");
  assert.match(app, /bookingCarry\.current = pendingDraft \? booking : null;/);
  // Account creation goes through the server route (fields required there, confirmation link sent there).
  assert.match(app, /api<\{ status: "signed_in"; user_id: string \} \| \{ status: "confirmation_required" \}>\("\/api\/auth\/signup", \{/);
  assert.doesNotMatch(app, /auth\.signUp\(|signInWithOtp|api\/auth\/phone/);
  assert.match(readFileSync("lib/features/auth/signup.ts", "utf8"), /emailRedirectTo: new URL\("\/auth\/confirm", url\.origin\)\.href/);
  const identity = readFileSync("components/app/identity.ts", "utf8");
  assert.doesNotMatch(identity, /createIntervention|\/api\/interventions/, "login never creates a request");
});

test("« Modifier »: contact edited inside the confirmation (bounded), request edit only replaces the kept draft", () => {
  const confirm = readFileSync("components/role/booking-confirm.tsx", "utf8");
  assert.match(confirm, /disabled=\{Object\.keys\(contactProblems\)\.length > 0\}/, "no save of an invalid / >120 contact");
  assert.match(confirm, /onContactChange\(contactDraft\)/);
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /if \(editBooking && session\.booking\) \{\s*(?:\/\/[^\n]*\n\s*)+session\.updatePendingDraft\(values, photos\);\s*setEditBooking\(false\);\s*return;/, "edit never POSTs");
});

test("return from the signup email (same tab, ?auth=confirmed) resumes the confirmation, never POSTs", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /const resume = mode === "live" && pendingDraft !== null;[\s\S]{0,500}if \(resume\) navigate\("new"\);/);
});

test("guest checkout: payment line shown; card hold not available ⇒ honest refusal before any call + switch to on site", () => {
  const onSite = renderToStaticMarkup(createElement(BookingConfirm, { draft, booking: { ...booking, payment: "on_site" }, busy: false, profileId: "u1", confirmBooking: async () => true, onEdit() {}, onContactChange() {} }));
  assert.match(onSite, /data-booking-payment="on_site"/);
  assert.match(onSite, /Rien n’est payé à l’envoi de la demande/);
  assert.doesNotMatch(onSite, /\bpayé\b(?! à l’envoi de la demande)/, "never « payé »");
  const card = renderToStaticMarkup(createElement(BookingConfirm, { draft, booking: { ...booking, payment: "card_hold" }, busy: false, profileId: "u1", confirmBooking: async () => true, onEdit() {}, onContactChange() {}, onPaymentChange() {} }));
  assert.match(card, /Une empreinte n’est pas un débit/);
  assert.match(card, /Choisir le paiement après intervention sur la plateforme/);
  const src = readFileSync("components/role/booking-confirm.tsx", "utf8");
  const send = src.slice(src.indexOf("async function send()"));
  assert.ok(send.indexOf('booking.payment === "card_hold" && !cardAvailable') < send.indexOf("await confirmBooking()"), "refused before the POST");
});

test("card hold with a key: « Vérifier mon empreinte » (server finalize) and server cancel, no direct switch of mode", () => {
  const card = renderToStaticMarkup(createElement(BookingConfirm, { draft, booking: { ...booking, payment: "card_hold", request_id: "11111111-1111-4111-8111-111111111111" }, busy: false, profileId: "u1", confirmBooking: async () => true, onEdit() {}, onContactChange() {}, onPaymentChange() {}, verifyCardHold: async () => true, cancelCardHold: async () => true }));
  assert.match(card, /data-booking-card-actions=""/);
  assert.match(card, /Vérifier mon empreinte/);
  assert.match(card, /Annuler la demande d’empreinte bancaire/);
  assert.doesNotMatch(card, /Choisir le paiement après intervention sur la plateforme/, "the mode/key change only after a server « cancelled »");
});


test("récapitulatif : étape 3 explicite, description vide honnête et besoin choisi conservé", () => {
  const html = renderToStaticMarkup(createElement(BookingConfirm, { draft: { ...draft, description: "", urgency: "scheduled" }, booking: { ...booking, slot: null }, busy: false, profileId: "u1", confirmBooking: async () => true, onEdit() {}, onContactChange() {}, onPaymentChange() {} }));
  assert.match(html, /aria-label="Étapes de la demande"/);
  assert.match(html, /<strong>Étape 1<\/strong>/);
  assert.match(html, /<strong>Étape 2<\/strong>/);
  assert.doesNotMatch(html, /Le problème|Le lieu et le besoin/, "confirmation does not invent the order of the public address-first journey");
  assert.match(html, /aria-current="step"[\s\S]*Règlement et confirmation/);
  assert.match(html, /Aucune description ajoutée/);
  assert.match(html, /Intervention à planifier/);
  assert.doesNotMatch(html, /Sans préférence|Dernière étape/);
  assert.match(html, /class="button outline booking-payment-option" aria-pressed="false"/);
});
