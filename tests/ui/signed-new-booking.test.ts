// Signed-in « Nouvelle demande » (ROOT decision): client ⇒ booking confirmation with the payment
// choice (POST /api/bookings, neutral slug), manager ⇒ POST /api/interventions with a request_id
// persisted BEFORE the POST and replayed identically after an uncertain outcome. Real functions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFINITIVE_REFUSAL, REQUEST_KEY_STORAGE, prepareRequestKey, readRequestKey, settleRequestKey } from "../../components/app/request-key";
import { bookingForEditedRequest, bookingFromSignedRequest, readPhotoCount, signedSlug, splitFullName, writePhotoCount } from "../../components/app/signed-booking";
import type { RequestValues } from "../../components/app/types";

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const values: RequestValues = { category: "socket", description: "La prise du salon ne fonctionne plus.", address: "8 rue Victor Hugo", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
function memory() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test("key is generated and PROVEN stored before any POST; no storage ⇒ null (nothing sent)", () => {
  const s = memory();
  const p = prepareRequestKey(s, values, () => K1)!;
  assert.equal(p.request_id, K1);
  assert.equal(readRequestKey(s.m.get(REQUEST_KEY_STORAGE) ?? null)!.request_id, K1, "persisted first");
  assert.equal(prepareRequestKey(null, values, () => K1), null);
  const broken = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(prepareRequestKey(broken, values, () => K1), null, "storage failure ⇒ no POST");
  const lying = { getItem: () => null, setItem: () => {} };
  assert.equal(prepareRequestKey(lying, values, () => K1), null, "write not readable back ⇒ no POST");
  assert.equal(prepareRequestKey(memory(), values, () => "00000000-0000-0000-0000-000000000000"), null, "never a constant/invalid UUID");
});

test("lost reply ⇒ retry/reload replays the SAME key; edited values ⇒ original frozen payload replayed, no new UUID", () => {
  const s = memory();
  let calls = 0;
  const gen = () => (calls++, calls === 1 ? K1 : K2);
  const first = prepareRequestKey(s, values, gen)!;
  // reply lost: nothing settled. Retry with same values:
  const retry = prepareRequestKey(s, values, gen)!;
  assert.equal(retry.request_id, first.request_id);
  assert.equal(retry.replayed, false);
  // user edits then resubmits while the outcome is still unknown:
  const edited = prepareRequestKey(s, { ...values, description: "Autre texte modifié après coup." }, gen)!;
  assert.equal(edited.request_id, K1, "same key");
  assert.equal(edited.payload.description, values.description, "original payload replayed");
  assert.equal(edited.replayed, true);
  assert.equal(calls, 1, "no new UUID generated");
});

test("settle drops only the known key; definitive refusals are 400/403/422 only", () => {
  const s = memory();
  prepareRequestKey(s, values, () => K1);
  settleRequestKey(s, K2);
  assert.ok(s.m.has(REQUEST_KEY_STORAGE), "another key is never removed");
  settleRequestKey(s, K1);
  assert.ok(!s.m.has(REQUEST_KEY_STORAGE));
  assert.deepEqual([...DEFINITIVE_REFUSAL].sort(), [400, 403, 422]);
  for (const uncertain of [0, 401, 409, 429, 500, 502, 503]) assert.equal(DEFINITIVE_REFUSAL.has(uncertain), false, String(uncertain));
});

test("booking draft: neutral slug, no catalogue service, no invented last name, payment left to choose", () => {
  assert.equal(signedSlug("socket"), "demande-socket");
  const b = bookingFromSignedRequest(values, { full_name: "Camille Dupont", phone: "0696 12 34 56" });
  assert.equal(b.slug, "demande-socket");
  assert.equal(b.contact.first_name, "Camille");
  assert.equal(b.contact.last_name, "Dupont");
  assert.equal(b.payment, undefined);
  assert.equal(b.request_id, undefined, "the key is created by confirmBooking, proven stored before the POST");
  assert.deepEqual(splitFullName("Camille"), { first_name: "Camille", last_name: "" });
  assert.deepEqual(splitFullName("  "), { first_name: "", last_name: "" });
  assert.equal(bookingFromSignedRequest(values, null).contact.first_name, "");
  const s = memory();
  writePhotoCount(s, 3);
  assert.equal(readPhotoCount(s), 3);
  writePhotoCount(s, 0);
  assert.equal(readPhotoCount(s), 0);
});

test("wiring: client #new never posts the legacy route in live; manager create sends the persisted key; confirm checks payment first", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  const reset = app.slice(app.indexOf("const clearSessionState"), app.indexOf("const navigate"));
  assert.match(reset, /bookingPhotos\.current = \[\];/);
  assert.match(reset, /writePhotoCount\(getDraftStorage\(\), 0\)/);
  assert.match(app, /async function uploadBookingPhotos\([^\n]+\n\s*if \(!ctx\.alive\(\)\) return;\s*const files = bookingPhotos\.current;/);
  const create = app.slice(app.indexOf("async function createIntervention("), app.indexOf("async function retryUploads("));
  // PUB-02: the prepared payload is the reviewed values (reviewed_estimate_version added only for a NEW key).
  const prep = create.indexOf("const prepared = prepareRequestKey(getDraftStorage(), reviewed);");
  assert.ok(prep > 0 && prep < create.indexOf('api<{ intervention: Intervention }>("/api/interventions", payload)'), "key prepared before the POST");
  assert.match(create, /if \(!prepared\)\s+throw new Error\(/);
  assert.match(create, /const payload: RequestValues & \{ request_id: string \} = \{ \.\.\.prepared\.payload, request_id: prepared\.request_id \};/);
  const start = app.slice(app.indexOf("function startBooking("), app.indexOf("async function", app.indexOf("function startBooking(")));
  assert.doesNotMatch(start, /api\(|api</, "startBooking sends nothing");
  assert.match(start, /if \(!saveBooking\(storage, next\) \|\| !savePublicDraft\(storage, values\)\.ok\) \{/);
  const confirm = app.slice(app.indexOf("async function confirmBooking("), app.indexOf("async function uploadBookingPhotos("));
  // PUB-02: the live path now goes through sendReviewedBooking (review + key + POST).
  const demoBranch = confirm.slice(confirm.indexOf("if (demo) {"), confirm.indexOf("sendReviewedBooking("));
  assert.doesNotMatch(demoBranch, /api\(|api</, "demo never posts");
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /if \(session\.startBooking\(values, photos\)\) return;\s+if \(session\.mode === "demo"\) await session\.createIntervention\(values, photos\);/);
  const bc = readFileSync("components/role/booking-confirm.tsx", "utf8");
  const send = bc.slice(bc.indexOf("async function send()"), bc.indexOf("return (", bc.indexOf("async function send()")));
  assert.ok(send.indexOf("if (!booking.payment)") < send.indexOf("contactErrors(contact)"), "payment choice checked before the contact");
});

test("editing a booking keeps the catalogue identity until the category changes", () => {
  const booking = { ...bookingFromSignedRequest(values, null), slug: "plusieurs-prises-sans-courant", request_id: K1, payment: "on_site" as const, slot: "tomorrow" as const };
  assert.deepEqual(bookingForEditedRequest(booking, "socket", { ...values, urgency: "scheduled" }), booking);
  const edited = bookingForEditedRequest(booking, "socket", { ...values, category: "panel", urgency: "urgent" });
  assert.deepEqual(edited, { ...booking, slug: "demande-panel", urgent: true, slot: null });
});

test("wording: the client booking path never shows « Enregistrer » before the payment choice; managers keep their direct creation", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /label: "Continuer vers le règlement", note: "Rien n’est encore envoyé/);
  assert.match(client, /label: "Revenir à la confirmation"/);
  const forms = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(forms, /: finalStep\s+\? finalStep\.label\s+: "Enregistrer la demande"/);
  const ent = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.doesNotMatch(ent, /finalStep=/, "manager flow unchanged (direct, idempotent creation)");
});
