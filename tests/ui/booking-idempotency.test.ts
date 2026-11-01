// Booking idempotency key (front): one UUID per tab draft, proven stored before any POST, carried
// unchanged through back/finish again/login/reload/errors, never regenerated; replaying the same
// key after a lost reply gives ONE dossier. No cloud, no Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { api, ApiRequestError } from "../../components/app/api";
import * as draftModule from "../../components/app/booking-draft";
import { BOOKING_DRAFT_KEY, REQUEST_ID, ensureRequestId, parseBooking, readBooking, saveBooking, type BookingDraft } from "../../components/app/booking-draft";
import { loadModule } from "../documents/harness";
import type * as Booking from "../../components/role/public-booking";

const tp = loadModule("components/app/theme-provider.tsx");
// The vm harness has no `crypto`: inject the real booking-draft module (Node has crypto.randomUUID).
const booking = loadModule("components/role/public-booking.tsx", { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule }) as unknown as typeof Booking;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES.find((s: { slug: string }) => s.slug === "prise-abimee-ou-qui-chauffe");
const contact = { civility: "mme" as const, first_name: "Camille", last_name: "Durand", email: "camille@example.test", phone: "06 12 34 56 78", company: false };
const state = { ...booking.EMPTY_BOOKING, urgent: false, slot: "day_after" as const, notes: "", contact, address: { address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France" } };
class Mem {
  data = new Map<string, string>();
  failWrites = false;
  lie = false; // setItem "succeeds" but stores nothing
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error("QuotaExceededError"); if (!this.lie) this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const base: BookingDraft = { slug: "prise-abimee-ou-qui-chauffe", urgent: false, slot: "tomorrow", notes: "", contact };
const NOW = Date.now();

test("parse: request_id must be a UUID; legacy booking without key still accepted", () => {
  assert.equal(parseBooking({ ...base, request_id: "nope" }), null);
  assert.equal(parseBooking({ ...base, request_id: 42 }), null);
  assert.equal(parseBooking(base)?.request_id, undefined);
  const id = crypto.randomUUID();
  assert.equal(parseBooking({ ...base, request_id: id })?.request_id, id);
});

test("ensureRequestId: existing key proven in storage, never replaced; lost from storage ⇒ SAME key re-written", () => {
  const id = crypto.randomUUID();
  const s = new Mem();
  assert.ok(saveBooking(s, { ...base, request_id: id }, NOW));
  assert.equal(ensureRequestId(s, { ...base, request_id: id }, NOW)?.request_id, id);
  s.data.clear(); // storage lost it (e.g. cleared by the login chain before re-adoption)
  assert.equal(ensureRequestId(s, { ...base, request_id: id }, NOW)?.request_id, id, "same key re-written");
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY), NOW)?.booking.request_id, id, "persisted for reload");
});

test("ensureRequestId: no storage / refused write / write not read back ⇒ null (caller sends nothing), never a fresh key", () => {
  const id = crypto.randomUUID();
  assert.equal(ensureRequestId(null, { ...base, request_id: id }, NOW), null);
  const refused = new Mem();
  refused.failWrites = true;
  assert.equal(ensureRequestId(refused, { ...base, request_id: id }, NOW), null);
  const liar = new Mem();
  liar.lie = true;
  assert.equal(ensureRequestId(liar, base, NOW), null, "legacy key not provable ⇒ refused");
});

test("ensureRequestId: legacy booking gets ONE key, stored, then reused on retry", () => {
  const s = new Mem();
  assert.ok(saveBooking(s, base, NOW));
  const first = ensureRequestId(s, base, NOW)!;
  assert.match(first.request_id, REQUEST_ID);
  const again = ensureRequestId(s, first.booking, NOW)!;
  assert.equal(again.request_id, first.request_id, "no new key per retry");
});

test("finishBooking: generates a UUID once; going back and finishing again keeps the SAME key", () => {
  const s = new Mem();
  assert.equal(booking.finishBooking({ storage: s as unknown as Storage, service, state: { ...state, step: 5, payment: "on_site" } as never, onSaved: () => {} }).ok, true);
  const first = readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.request_id!;
  assert.match(first, REQUEST_ID);
  assert.equal(booking.finishBooking({ storage: s as unknown as Storage, service, state: { ...state, step: 5, payment: "on_site", notes: "Ajout" } as never, onSaved: () => {} }).ok, true);
  assert.equal(readBooking(s.getItem(BOOKING_DRAFT_KEY))!.booking.request_id, first, "same request, same key");
});

test("replay of the same key after a lost reply ⇒ ONE dossier (local idempotent server, real api())", async () => {
  const rows = new Map<string, { id: string }>();
  let drop = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body) as { request_id?: string };
      const key = payload.request_id!;
      if (!rows.has(key)) rows.set(key, { id: `row-${rows.size + 1}` }); // commit (idempotent by key)
      if (drop) {
        drop = false;
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ intervention: rows.get(key) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/interventions`;
  const payload = { category: "socket", description: "Prestation choisie : Prise abîmée.", address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", request_id: crypto.randomUUID() };
  try {
    await assert.rejects(api(url, payload), (e: unknown) => e instanceof ApiRequestError && e.status === 0);
    const replay = await api<{ intervention: { id: string } }>(url, payload);
    assert.equal(replay.intervention.id, "row-1");
    assert.equal(rows.size, 1, "one dossier for one booking");
  } finally {
    server.close();
  }
});

test("controller: booking ⇒ POST /api/bookings (flat contract body, key proven first, 409 ⇒ « Mes demandes »), never the legacy route", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const fn = src.slice(src.indexOf("async function confirmBooking()"), src.indexOf("async function createIntervention("));
  assert.ok(fn.indexOf("ensureRequestId(getDraftStorage(), current)") < fn.indexOf('api<BookingReceipt>("/api/bookings", body)'));
  assert.match(fn, /if \(!keyed\)\s*throw new Error\(/, "not provable ⇒ local refusal, no POST");
  for (const field of ["request_id: keyed.request_id", "service_slug: current.slug", "category: draft.category", "description: draft.description", "address: draft.address", "postal_code: draft.postal_code", "city: draft.city", "urgency: draft.urgency", "payment_choice: current.payment"])
    assert.ok(fn.includes(field), field);
  assert.match(fn, /contact: \{ first_name: c\.first_name\.trim\(\), last_name: c\.last_name\.trim\(\), email: c\.email\.trim\(\), phone: c\.phone\.trim\(\) \}/);
  assert.match(fn, /e\.status === 409/);
  assert.match(fn, /result\?\.status !== "confirmed"/, "only a « confirmed » receipt consumes the draft");
  assert.doesNotMatch(fn, /\/api\/interventions|newRequestId/, "no silent fallback, no key minted here");
  // Legacy create is unchanged and keyless (no booking context any more).
  const create = src.slice(src.indexOf("async function createIntervention("), src.indexOf("const id = result.intervention?.id;"));
  assert.doesNotMatch(create, /ensureRequestId|request_id: keyed/, "legacy create sends no booking key");
  assert.match(src, /revenez dans CET onglet et connectez-vous/);
  assert.doesNotMatch(readFileSync("lib/shared/request-draft.ts", "utf8") + readFileSync("public/offline-request.js", "utf8"), /request_id/);
});
