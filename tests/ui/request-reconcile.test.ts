// Unknown-outcome reconciliation of « create request »: never two POSTs for one send.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PENDING_CREATE_KEY, findCommittedRequest, outcomeUnknown, readPendingCreate, requestDigest, writePendingCreate } from "../../components/app/request-reconcile";
import type { Intervention, RequestValues } from "../../components/app/types";

const values: RequestValues = { category: "socket", description: "Prestation choisie : Plusieurs prises sans courant.\nCréneau souhaité : demain.", address: "2 rue Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
const SENT = Date.parse("2026-11-01T14:00:00Z");
const row = (over: Partial<Intervention> = {}): Intervention => ({ id: "i1", status: "requested", created_at: "2026-11-01T14:00:01Z", estimate_min_cents: 0, estimate_max_cents: 0, client_id: "u1", ...values, ...over });

test("finds the dossier the interrupted send created (whitespace/case normalised by the server)", () => {
  const stored = row({ description: "  Prestation choisie : Plusieurs prises sans courant. Créneau souhaité : demain. ", city: "FORT-DE-FRANCE" });
  assert.equal(findCommittedRequest([row({ id: "other", description: "Autre panne" }), stored], values, "u1", SENT)?.id, "i1");
});

test("never matches another client, an older dossier, or different content", () => {
  assert.equal(findCommittedRequest([row({ client_id: "u2" })], values, "u1", SENT), null);
  assert.equal(findCommittedRequest([row({ created_at: "2026-11-01T13:50:00Z" })], values, "u1", SENT), null, "older than the send");
  assert.equal(findCommittedRequest([row({ address: "3 rue Test" })], values, "u1", SENT), null);
});

test("unknown outcome = status 0 / 502 / 504 only; a 4xx or 503 is a known refusal", () => {
  for (const s of [0, 502, 504]) assert.equal(outcomeUnknown({ status: s }), true, String(s));
  for (const s of [400, 401, 403, 409, 422, 503]) assert.equal(outcomeUnknown({ status: s }), false, String(s));
});

test("the tab marker holds a digest, never the request content or contact", () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  writePendingCreate(st, { userId: "u1", sentAt: SENT, digest: requestDigest(values) });
  const raw = m.get(PENDING_CREATE_KEY)!;
  for (const leak of ["rue Test", "97200", "Fort-de-France", "prises"]) assert.ok(!raw.includes(leak), leak);
  assert.deepEqual(readPendingCreate(st, SENT + 1000), { userId: "u1", sentAt: SENT, digest: requestDigest(values) });
  assert.equal(readPendingCreate(st, SENT + 25 * 3600_000), null, "expires");
});

test("controller: verify BEFORE any resend; unknown verification never POSTs; known refusal clears the marker", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const create = src.slice(src.indexOf("// 1. Create the dossier exactly once."), src.indexOf("pendingCreate.current = null;\n      clearPendingCreate(storage);", src.indexOf("// 1. Create the dossier exactly once.")));
  const verifyFirst = create.indexOf("const found = await verify(previous.sentAt);");
  const post = create.indexOf('await api<{ intervention: Intervention }>("/api/interventions", values)');
  assert.ok(verifyFirst > 0 && post > verifyFirst, "a pending marker is verified before the POST");
  assert.match(create, /if \(found === "unknown"\) throw new Error\(VERIFY_FAILED_MESSAGE\);\s*if \(found\) result = \{ intervention: found \};/);
  assert.match(create, /if \(!outcomeUnknown\(e\)\) \{\s*pendingCreate\.current = null;\s*clearPendingCreate\(storage\);\s*throw e;/);
  assert.match(create, /if \(found === "unknown"\) throw new Error\(VERIFY_FAILED_MESSAGE\); \/\/ marker kept/);
  assert.equal((create.match(/"\/api\/interventions", values/g) || []).length, 1, "exactly one POST call site");
  assert.match(src, /pendingCreate\.current = null;\s*clearPendingCreate\(getDraftStorage\(\)\);/, "dropped on identity reset");
});
