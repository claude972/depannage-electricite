// Booking dossier status (GET /api/bookings/status): on site ⇒ planned, nothing collected; card ⇒
// recorded at a date, not a charge, not forever; 404 ⇒ legacy dossier; the legacy Stripe checkout
// is never offered on a booking dossier.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiRequestError } from "../../components/app/api";
import { bookingPaymentText, fetchBookingStatus, parseBookingStatus } from "../../components/app/booking-status";

test("parse: only the contract's confirmed shapes; anything else is « unavailable », never invented", () => {
  assert.deepEqual(parseBookingStatus({ status: "confirmed", payment: { method: "on_site", status: "due_on_site" } }), { kind: "booking", payment: { method: "on_site", status: "due_on_site" } });
  assert.deepEqual(parseBookingStatus({ status: "confirmed", payment: { method: "card_hold", status: "authorization_recorded", checked_at: "2026-11-01T15:00:00Z" } }), { kind: "booking", payment: { method: "card_hold", status: "authorization_recorded", checked_at: "2026-11-01T15:00:00Z" } });
  for (const bad of [null, {}, { status: "prepared", payment: { method: "on_site", status: "pending" } }, { status: "confirmed", payment: { method: "on_site", status: "paid" } }])
    assert.deepEqual(parseBookingStatus(bad), { kind: "unavailable" });
});

test("fetch: intervention_id only, 404 ⇒ legacy, other errors ⇒ unavailable", async () => {
  const urls: string[] = [];
  const ok = await fetchBookingStatus("11111111-1111-4111-8111-111111111111", (async (u: string) => { urls.push(u); return { status: "confirmed", payment: { method: "on_site", status: "due_on_site" } }; }) as never);
  assert.equal(ok.kind, "booking");
  assert.deepEqual(urls, ["/api/bookings/status?intervention_id=11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(await fetchBookingStatus("x", (async () => { throw new ApiRequestError(404, "x"); }) as never), { kind: "legacy" });
  assert.deepEqual(await fetchBookingStatus("x", (async () => { throw new ApiRequestError(503, "x"); }) as never), { kind: "unavailable" });
});

test("wording: on site never « payé »; card dated, not a charge, not forever", () => {
  const onSite = bookingPaymentText({ method: "on_site", status: "due_on_site" }, (d) => d);
  assert.match(onSite, /Aucun encaissement n’a été confirmé/);
  assert.doesNotMatch(onSite, /\bpayé\b/);
  const card = bookingPaymentText({ method: "card_hold", status: "authorization_recorded", checked_at: "2026-11-01" }, (d) => `le ${d}`.replace("le ", ""));
  assert.match(card, /vérifiée le 2026-11-01/);
  assert.match(card, /pas un débit/);
  assert.match(card, /pas valable indéfiniment/);
});

test("client detail: legacy checkout ONLY for a proven legacy dossier (404); loading/503/malformed/booking ⇒ never", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /if \(i\.status === "completed" && !demo && currentBookingStatus\?\.kind !== "legacy"\) \{/);
  assert.match(src, /Statut de règlement momentanément indisponible/);
  assert.match(src, /data-booking-payment-status=\{currentBookingStatus\.payment\.method\}/);
});

test("client detail: booking-status hooks run BEFORE any early return (deep link absent → present), keyed by UID + job", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  const view = src.slice(src.indexOf("function DetailView("));
  const firstReturn = view.search(/\n\s*if \(!i\)/);
  for (const hook of ["useState<{ key: string; value: BookingStatus } | null>(null)", "useEffect(() => {\n    if (!statusKey) return;"])
    assert.ok(view.indexOf(hook) > 0 && view.indexOf(hook) < firstReturn, hook);
  assert.match(view, /const statusKey = i && !demo \? `\$\{session\.profileId\}\|\$\{i\.id\}` : "";/);
  assert.match(view, /bookingStatus && bookingStatus\.key === statusKey \? bookingStatus\.value : null/, "stale key ⇒ null at once");
});

test("optional account: offered in the profile and on a booking dossier only, never a step", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /\{session\.mode === "live" && <AccountUpgrade \/>\}\s*<ProfileView session=\{session\} \/>/);
  assert.match(src, /\{currentBookingStatus\?\.kind === "booking" && <AccountUpgrade \/>\}/);
  assert.doesNotMatch(readFileSync("components/role/booking-confirm.tsx", "utf8"), /AccountUpgrade/, "not part of the send path");
});

test("settlement leaf: mounted only for a completed card-hold booking with an accepted quote, keyed by UID + job, with the session identity context", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /currentBookingStatus\?\.kind === "booking" && currentBookingStatus\.payment\.method === "card_hold" && \(i\.status === "completed" \|\| i\.status === "paid"\) && accepted && \(\s*<BookingSettlement\s*key=\{`\$\{session\.profileId\}\|\$\{i\.id\}`\}\s*interventionId=\{i\.id\}\s*context=\{session\.mutationContext\}/);
  assert.match(src, /onSettled=\{i\.status === "paid" \? undefined : \(\) => void session\.refresh\(\)\}/);
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /mutationContext: cardContext,/);
  assert.match(app, /const cardContext = \{ generation: \(\) => guard\.generation\(\), userId: \(\) => userId\.current \};/);
});
