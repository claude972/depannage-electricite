// Card hold front: strict Checkout URL, provider return is a hint (finalize/status decides), cancel
// waits for the server, key dropped only after « cancelled ».
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeCheckoutUrl } from "../../components/app/booking-status";
import { parseReturnParams } from "../../components/app/session";

test("checkout URL: https on checkout.stripe.com only", () => {
  assert.equal(safeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_abc#x"), "https://checkout.stripe.com/c/pay/cs_test_abc#x");
  for (const bad of ["http://checkout.stripe.com/c", "https://checkout.stripe.com.evil.test/c", "https://evil.test/c", "https://u:p@checkout.stripe.com/c", "javascript:alert(1)", 42, null])
    assert.equal(safeCheckoutUrl(bad), null, String(bad));
});

test("return params: strict UUID + success|cancel; anything else ignored", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseReturnParams(`?booking_request_id=${id}&booking_return=success`), { kind: "booking", state: "success", requestId: id });
  assert.deepEqual(parseReturnParams(`?booking_request_id=${id.toUpperCase()}&booking_return=cancel`), { kind: "booking", state: "cancel", requestId: id });
  assert.equal(parseReturnParams(`?booking_request_id=nope&booking_return=success`), null);
  assert.equal(parseReturnParams(`?booking_request_id=${id}&booking_return=paid`), null);
});

test("controller: return ⇒ finalize (server), never a status from the URL; cancel waits for « cancelled » before dropping the key", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const effect = src.slice(src.indexOf('if (returnContext.kind === "booking")'), src.indexOf('if (returnContext.kind === "auth")'));
  assert.match(effect, /if \(mode !== "live"\) \{[\s\S]*?return;\s*\}/, "kept until an identified session");
  assert.match(effect, /if \(back\.state === "success"\) void finalizeBooking\(back\.requestId\);/);
  assert.doesNotMatch(effect, /setBooking|clearBooking|confirmed/, "the URL never changes the booking state");
  const fin = src.slice(src.indexOf("async function finalizeBooking("), src.indexOf("async function cancelBooking("));
  assert.match(fin, /api<BookingReceipt>\("\/api\/bookings\/finalize", \{ request_id: requestId \}\)/);
  assert.match(fin, /result\?\.status !== "confirmed"/);
  const cancel = src.slice(src.indexOf("async function cancelBooking("), src.indexOf("async function createIntervention("));
  assert.ok(cancel.indexOf('r?.status !== "cancelled"') < cancel.indexOf("ctx.when(setBooking)(rest)"), "key dropped only after the server says cancelled");
  const confirm = src.slice(src.indexOf("async function confirmBooking()"), src.indexOf("async function finalizeBooking("));
  assert.match(confirm, /const url = safeCheckoutUrl\(result\.url\);\s*if \(!url\) throw/);
  assert.match(confirm, /window\.location\.assign\(url\);\s*return;/, "card: redirect, the draft/booking/key stay");
});
