import test from "node:test";
import assert from "node:assert/strict";
import { BOOKING_DRAFT_KEY, bookingDescription, clearBooking, contactErrors, parseBooking, profilePatch, readBooking, saveBooking, type BookingDraft } from "../../components/app/booking-draft";

const NOW = 1_800_000_000_000;
const contact = { civility: "mme" as const, first_name: "Léa", last_name: "Martin", email: "lea@example.test", phone: "0696 12 34 56", company: false };
const booking: BookingDraft = { slug: "plusieurs-prises-sans-courant", urgent: false, slot: "tomorrow", notes: "Trois prises du salon.", contact };
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

test("booking: save → read round-trip, TTL 30 min, cleared explicitly", () => {
  const s = memory();
  assert.equal(saveBooking(s, booking, NOW), true);
  assert.deepEqual(readBooking(s.getItem(BOOKING_DRAFT_KEY), NOW + 60_000)?.booking, booking);
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY), NOW + 30 * 60_000), null);
  clearBooking(s);
  assert.equal(s.getItem(BOOKING_DRAFT_KEY), null);
});

test("booking: strict parse (slug, slot, urgent/slot coherence, civility, sizes, garbage)", () => {
  assert.equal(parseBooking({ ...booking, slug: "../x" }), null);
  assert.equal(parseBooking({ ...booking, slot: "sunday" }), null);
  assert.equal(parseBooking({ ...booking, urgent: true, slot: "tomorrow" }), null, "urgent never carries a slot");
  assert.deepEqual(parseBooking({ ...booking, urgent: true, slot: null })?.slot, null);
  assert.equal(parseBooking({ ...booking, contact: { ...contact, civility: "dr" } }), null);
  assert.equal(parseBooking({ ...booking, notes: "x".repeat(1501) }), null);
  assert.equal(readBooking("{oops", NOW), null);
  assert.equal(readBooking(JSON.stringify({ savedAt: NOW + 120_000, booking }), NOW), null, "future timestamp");
  assert.equal(saveBooking({ setItem() { throw new Error("quota"); } }, booking, NOW), false);
  assert.equal(saveBooking(null, booking, NOW), false);
});

test("description: non-personal parts only — never name, email or phone", () => {
  const d = bookingDescription("Plusieurs prises sans courant", booking);
  assert.match(d, /Prestation choisie : Plusieurs prises sans courant\./);
  assert.match(d, /Créneau souhaité : demain\./);
  assert.match(d, /Trois prises du salon\./);
  for (const secret of ["Léa", "Martin", "lea@example.test", "0696"]) assert.ok(!d.includes(secret), secret);
  assert.match(bookingDescription("Disjoncteur qui saute", { urgent: true, slot: null, notes: "" }), /urgence/);
  assert.ok(bookingDescription("Disjoncteur qui saute", { urgent: false, slot: null, notes: "" }).length >= 15, "meets the 15-char minimum");
});

test("profile patch and contact checks", () => {
  assert.deepEqual(profilePatch(contact), { full_name: "Léa Martin", phone: "0696 12 34 56" });
  assert.equal(profilePatch({ ...contact, first_name: " ", last_name: "" }), null);
  assert.deepEqual(contactErrors(contact), {});
  assert.deepEqual(Object.keys(contactErrors({ ...contact, first_name: "", email: "x", phone: "12" })).sort(), ["email", "first_name", "phone"]);
});
