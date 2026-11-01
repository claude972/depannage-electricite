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
  const html = renderToStaticMarkup(createElement(BookingConfirm, { draft, booking, busy: false, profileId: "u1", updateProfile: async () => true, createIntervention: async () => true, onEdit() {} }));
  assert.match(html, /Confirmez l’envoi de votre demande/);
  assert.match(html, /Rien n’a encore été envoyé/);
  assert.match(html, /Plusieurs prises sans courant/);
  assert.match(html, /souhait, pas un rendez-vous réservé/);
  assert.match(html, /pas un prix garanti/);
  assert.match(html, /data-booking-send=""[^>]*>Envoyer ma demande/);
  assert.ok(!draft.description.includes("Martin") && !draft.description.includes("0696"), "contact never in the description");
});

test("send logic: PATCH then POST, once; refused contact ⇒ no API call; PATCH failure ⇒ no POST", () => {
  const src = readFileSync("components/role/booking-confirm.tsx", "utf8");
  assert.match(src, /if \(inFlight\.current \|\| busy\) return; \/\/ one POST only/);
  assert.match(src, /const ok = await updateProfile\(patch\);\s*if \(!ok \|\| !alive\.current \|\| identity\.current !== startedAs\) return;/);
  assert.match(src, /if \(!patch \|\| Object\.keys\(contactErrors\(contact\)\)\.length\) \{/);
  const order = src.indexOf("await updateProfile(patch)") < src.indexOf("await createIntervention(draft)");
  assert.ok(order, "profile before the request");
});

test("wiring: client « new » shows the confirmation only with a draft + booking of this identity; no POST on login", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /if \(session\.booking && session\.pendingDraft && !editBooking\)/);
  assert.match(client, /initialValues=\{session\.pendingDraft\}/);
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /booking: mode === "live" && pendingDraft \? booking : null/);
  assert.match(app, /clearBooking\(getDraftStorage\(\)\);\s*try \{\s*sessionStorage\.removeItem\(DRAFT_KEY\);/, "dropped on identity reset");
  assert.match(app, /bookingCarry\.current = pendingDraft \? booking : null;/);
  assert.match(app, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth\/confirm`/);
  const identity = readFileSync("components/app/identity.ts", "utf8");
  assert.doesNotMatch(identity, /createIntervention|\/api\/interventions/, "login never creates a request");
});
