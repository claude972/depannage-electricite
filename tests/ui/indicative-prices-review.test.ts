// PUB-02 live review (9ff9009 + 8a2f9b6): reviewed_estimate_version is the version the user saw,
// re-read right before a NEW request; V1 may omit; V>1 exact or blocked; an unverified read never
// fabricates a version nor shows the static amount as current; a request-key replay keeps its frozen
// version; a 409 after a version change settles the key (re-confirmation = new key); demo unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/indicative-prices/model";
import type * as Keys from "../../components/app/request-key";

const m = loadModule("components/features/indicative-prices/model.ts") as unknown as typeof Model;
const k = loadModule("components/app/request-key.ts") as unknown as typeof Keys;
const R = { outage: { min_cents: 15000, max_cents: 25000 }, panel: { min_cents: 15000, max_cents: 35000 }, socket: { min_cents: 8000, max_cents: 18000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } };
const ready = (version: number) => ({ phase: "ready" as const, data: m.parsePrices({ version, currency: "eur", ranges: R, indicative: true, publication_available: false, source: version === 1 ? "existing_baseline" : "operator_version" }) });
const loading = { phase: "loading" as const, data: null };
const error = { phase: "error" as const, data: null };

test("décision de revue : version RENDUE envoyée ; V1 tolérée ; V>1 jamais non vue ; lecture invérifiable ⇒ aucune version fabriquée", () => {
  assert.equal(JSON.stringify(m.reviewDecision(3, ready(3))), JSON.stringify({ kind: "send", version: 3 }), "V>1: exact version");
  assert.equal(JSON.stringify(m.reviewDecision(1, ready(1))), JSON.stringify({ kind: "send", version: 1 }));
  assert.equal(JSON.stringify(m.reviewDecision(null, ready(1))), JSON.stringify({ kind: "send", version: 1 }), "V1 may proceed");
  assert.equal(m.reviewDecision(2, ready(3)).kind, "block", "an unseen V3 is never approved");
  assert.equal(m.reviewDecision(null, ready(3)).kind, "block", "never a version the user did not see");
  assert.equal(JSON.stringify(m.reviewDecision(null, error)), JSON.stringify({ kind: "omit" }), "unverified at V1 ⇒ omit (doc)");
  assert.equal(JSON.stringify(m.reviewDecision(1, error)), JSON.stringify({ kind: "omit" }));
  assert.equal(m.reviewDecision(3, error).kind, "block", "unverified while last rendered > 1 ⇒ blocked");
  assert.equal(m.ESTIMATE_REVIEW_CODE, "estimate_review_required");
  m.recordShown("x", 3);
  assert.equal(m.shownVersion("x"), 3);
  void loading;
});

test("rejeu de clé de demande : la charge figée (avec sa version) est renvoyée telle quelle, jamais repatchée", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, v: string) => void store.set(key, v), removeItem: (key: string) => void store.delete(key) };
  const base = { category: "panel", description: "Disjoncteur qui saute souvent", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
  const first = k.prepareRequestKey(storage, { ...base, reviewed_estimate_version: 2 } as never, () => "f0000000-0000-4000-8000-000000000001")!;
  assert.equal((first.payload as { reviewed_estimate_version?: number }).reviewed_estimate_version, 2);
  const replay = k.prepareRequestKey(storage, { ...base, reviewed_estimate_version: 3 } as never, () => "f0000000-0000-4000-8000-000000000002")!;
  assert.equal(replay.request_id, "f0000000-0000-4000-8000-000000000001", "same key");
  assert.equal((replay.payload as { reviewed_estimate_version?: number }).reviewed_estimate_version, 2, "frozen version kept");
  assert.equal(replay.replayed, true);
  // After estimate_review_required + explicit click: ONLY the frozen version of THIS key changes.
  const savedAt = JSON.parse(store.get(k.REQUEST_KEY_STORAGE)!).savedAt;
  assert.equal(k.updateFrozenVersion(storage, first.request_id, 3), false, "no confirmed refusal");
  assert.equal(k.markRequestEstimateReview(storage, first.request_id), true);
  assert.equal(JSON.parse(store.get(k.REQUEST_KEY_STORAGE)!).estimate_review_required, true);
  assert.equal(k.prepareRequestKey(storage, base as never), null, "reopen: no stale replay before reconfirmation");
  assert.equal(k.updateFrozenVersion(storage, "f0000000-0000-4000-8000-000000000002", 3), false, "another key is never touched");
  assert.equal(k.updateFrozenVersion(storage, "f0000000-0000-4000-8000-000000000001", 3), true);
  const after = JSON.parse(store.get(k.REQUEST_KEY_STORAGE)!);
  assert.equal(after.request_id, "f0000000-0000-4000-8000-000000000001", "same request_id");
  assert.equal(after.payload.reviewed_estimate_version, 3);
  assert.equal(after.payload.description, base.description, "same content");
  assert.equal(after.savedAt, savedAt, "same TTL anchor");
  assert.equal(after.estimate_review_required, undefined);
  // Read-back must match the EXACT frozen payload (only the version changed): a storage that alters
  // anything else on write ⇒ false (the caller then sends nothing).
  const lying = { getItem: storage.getItem, setItem: (key: string, v: string) => void store.set(key, v.replace("Disjoncteur", "Fusible")), removeItem: storage.removeItem };
  assert.equal(k.markRequestEstimateReview(storage, first.request_id), true);
  assert.equal(k.updateFrozenVersion(lying, "f0000000-0000-4000-8000-000000000001", 4), false);
});

test("brouillon de réservation : la version revue est stockée à côté de la clé (même stockage / TTL), relue au rechargement", () => {
  const d = loadModule("components/app/booking-draft.ts") as Record<string, (...a: unknown[]) => unknown>;
  const draft = { slug: "panne-tableau-electrique", urgent: true, slot: null, notes: "", contact: { civility: "", first_name: "A", last_name: "B", email: "a@b.fr", phone: "+596696000001", company: false }, request_id: "f0000000-0000-4000-8000-000000000009", payment: "on_site", reviewed_estimate_version: 3 };
  const parsed = d.parseBooking(draft) as { reviewed_estimate_version?: number };
  assert.equal(parsed.reviewed_estimate_version, 3);
  assert.equal(d.parseBooking({ ...draft, reviewed_estimate_version: 0 }), null);
  assert.equal(d.parseBooking({ ...draft, request_id: undefined }), null, "a version only exists next to its key");
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, v: string) => void store.set(key, v), removeItem: (key: string) => void store.delete(key) };
  assert.equal(d.saveBooking(storage, draft), true);
  const back = d.readBooking(storage.getItem("courant-booking-draft")) as { booking: { reviewed_estimate_version?: number } } | null;
  assert.equal(back?.booking.reviewed_estimate_version, 3, "reload ⇒ version restored");
});

test("câblage : création = version rendue + relecture forcée ; rejeu = charge figée ; 409 estimate_review_required ⇒ même clé, version changée seulement après un nouveau clic ; démo inchangée", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  const create = app.slice(app.indexOf("async function createIntervention"), app.indexOf("const replayNote"));
  assert.match(create, /if \(modeRef\.current === "demo"\) \{\s*demoCreate/, "demo unchanged");
  assert.match(create, /const rendered = shownVersion\(REVIEW_SCOPES\.requestForm\);\s*await loadPrices\(undefined, true\);\s*if \(!ctx\.alive\(\)\) return;/);
  assert.match(create, /if \(!stored \|\| stored\.estimate_review_required\)/);
  assert.match(create, /updateFrozenVersion\(storageNow, stored\.request_id, decision\.version\)/);
  assert.match(create, /e\.status === 409 && e\.code === ESTIMATE_REVIEW_CODE\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*markRequestEstimateReview\(storageNow, prepared\.request_id\);/);
  assert.doesNotMatch(create, /settleRequestKey\(getDraftStorage\(\), prepared\.request_id\);\s*throw new Error\(REVIEW_COPY/, "never a new key after the code");
  assert.doesNotMatch(app, /bookingReviewed/, "no unbounded in-memory map");
  const booking = app.slice(app.indexOf("async function confirmBooking"), app.indexOf("async function uploadBookingPhotos"));
  assert.match(booking, /result = await sendReviewedBooking\(\{/);
  assert.match(booking, /if \(result === undefined\) return;/);
  const forms = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(forms, /<ReviewEstimate category=\{values\.category\} scope="request-form" \/>/);
  const confirm = readFileSync("components/role/booking-confirm.tsx", "utf8");
  assert.match(confirm, /\{demo \? \(\s*<>\{money\(c\.min\)\} – \{money\(c\.max\)\}<\/>/);
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /cancelCardHold=\{session\.cancelBooking\}\s+demo=\{session\.mode === "demo"\}/);
  assert.equal(m.REVIEW_COPY.unverified, "estimation non vérifiée");
});
