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
  assert.match(onSite, /Aucun paiement n’a encore été confirmé/);
  assert.match(onSite, /sur la plateforme/);
  assert.match(onSite, /ne réglez jamais l’artisan directement/);
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

test("website account: nothing to convert — no phone-to-e-mail upgrade in the profile, on a dossier or on the send path", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  for (const file of ["components/role/client-space.tsx", "components/role/booking-confirm.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /AccountUpgrade|account-upgrade|api\/auth\/phone/, file);
  // The profile is the client's landing view and carries the requests itself.
  assert.match(src, /<ProfileView session=\{session\} rows=\{rows\} activeCount=\{activeCount\} \/>/);
  assert.match(src, /const view = session\.view === "overview" \? "profile" : session\.view;/);
});

test("settlement leaf: mounted only for a completed card-hold booking with an accepted quote, keyed by UID + job, with the session identity context", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /currentBookingStatus\?\.kind === "booking" && currentBookingStatus\.payment\.method === "card_hold" && \(i\.status === "completed" \|\| i\.status === "paid"\) && accepted && \(\s*<BookingSettlement\s*key=\{`\$\{session\.profileId\}\|\$\{i\.id\}`\}\s*interventionId=\{i\.id\}\s*context=\{session\.mutationContext\}/);
  assert.match(src, /onSettled=\{i\.status === "paid" \? undefined : \(\) => void session\.refresh\(\)\}/);
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /mutationContext: cardContext,/);
  assert.match(app, /const cardContext = \{ generation: \(\) => guard\.generation\(\), userId: \(\) => userId\.current \};/);
});

test("after-intervention: client widget on completed|paid replaces the generic line; NO artisan widget; refresh only while not paid", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /currentBookingStatus\.payment\.method === "on_site" && \(i\.status === "completed" \|\| i\.status === "paid"\) && \(\s*<OnsiteSettlement[\s\S]*?viewer="client"[\s\S]*?onSettled=\{i\.status === "paid" \? undefined : \(\) => void session\.refresh\(\)\}/);
  assert.match(client, /currentBookingStatus\?\.kind === "booking" && !\(currentBookingStatus\.payment\.method === "on_site" && \(i\.status === "completed" \|\| i\.status === "paid"\)\) && \(\s*<p className=\{styles\.paymentLine\}/, "no contradictory sentence next to the cash widget");
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.doesNotMatch(artisan, /<OnsiteSettlement/, "platform-only: no artisan declaration widget for new operations");
  assert.doesNotMatch(client, /viewer="artisan"/, "a client never gets the artisan declaration");
});

test("provenance: a payment declared received on site is never worded as a bank/Stripe confirmation", async () => {
  const { isDeclaredOnSite } = await import("../../components/app/booking-status");
  assert.equal(isDeclaredOnSite({ method: "on_site_declared" }), true);
  for (const p of [{ method: "card" }, {}, null, undefined]) assert.equal(isDeclaredOnSite(p as never), false);
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /payment\.status === "paid" && isDeclaredOnSite\(payment\)\s*\? `Règlement de \$\{money\(payment\.total_cents\)\} déclaré reçu sur place par l’artisan[\s\S]{0,120}?Ce n’est pas une confirmation bancaire\.`/);
  assert.doesNotMatch(client, /Le règlement est traité avec Stripe|via Stripe\./, "help texts no longer say every payment goes through Stripe");
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /isDeclaredOnSite\(payment\)\s*\? "Règlement déclaré reçu sur place\. Ce n’est pas une confirmation bancaire\."/);
});

test("FIN-04 : dossier annulé — plus de « pourra être prélevé » ; avis d’annulation selon l’issue vérifiée par le serveur", async () => {
  const { cancelHoldNotice, CANCELLED_HOLD_TEXT } = await import("../../components/app/booking-status");
  const hold = { method: "card_hold", status: "authorization_recorded", checked_at: "2026-11-01T15:00:00Z" } as const;
  const cancelled = bookingPaymentText(hold, (iso) => iso, true);
  assert.equal(cancelled, CANCELLED_HOLD_TEXT);
  assert.doesNotMatch(cancelled, /pourra être prélevé|Empreinte bancaire enregistrée/);
  assert.match(cancelled, /ne sera pas débitée/);
  assert.match(bookingPaymentText(hold, (iso) => iso), /Empreinte bancaire enregistrée/);
  assert.match(bookingPaymentText({ method: "on_site", status: "due_on_site" }, (iso) => iso, true), /aucun paiement n’est dû/);
  assert.match(cancelHoldNotice("released")!, /a été libérée/);
  assert.match(cancelHoldNotice("release_failed")!, /n’a pas pu être confirmée/);
  assert.doesNotMatch(cancelHoldNotice("release_failed")!, /a été libérée/);
  for (const other of [undefined, null, "none", "RELEASED", {}]) assert.equal(cancelHoldNotice(other), null);
});
