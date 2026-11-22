// SYS-06 — validity and versions of artisan credentials: an expired credential is never counted as
// valid, « expire bientôt » covers the last 30 days, replaced versions never count.
import test from "node:test";
import assert from "node:assert/strict";
import { EXPIRING_SOON_DAYS, REQUIRED_CREDENTIAL_KINDS, credentialVersions, validityOf, validitySummary } from "../components/features/credential-reviews/credential-validity";
const today = "2026-11-22";
const row = (id: string, kind: string, expires_on: string | null, created_at: string) => ({ id, kind, expires_on, created_at });

test("validity states: expired the day after, still valid on the day, expiring within the window, undated said as such", () => {
  assert.equal(validityOf("2026-11-21", today).state, "expired");
  assert.match(validityOf("2026-11-21", today).label, /^Expirée depuis le 21 novembre 2026$/);
  assert.equal(validityOf("2026-11-22", today).state, "expiring");
  assert.match(validityOf("2026-11-22", today).label, /Expire aujourd’hui/);
  assert.equal(validityOf("2026-12-04", today).label, "Expire bientôt : dans 12 jours (4 décembre 2026)");
  assert.equal(validityOf("2026-12-22", today).state, "expiring");
  assert.equal(validityOf("2026-12-22", today).days, EXPIRING_SOON_DAYS);
  assert.equal(validityOf("2026-12-23", today).state, "valid");
  assert.equal(validityOf("2027-12-27", today).label, "Valable jusqu’au 27 décembre 2027");
  for (const none of [null, undefined, "", "bientôt"]) assert.equal(validityOf(none, today).state, "undated");
});

test("versions: the latest linked credential of a kind is current, older ones are replaced", () => {
  const versions = credentialVersions([row("old", "registration", "2026-10-13", "2026-08-24T10:00:00Z"), row("new", "registration", "2027-12-27", "2026-11-20T10:00:00Z"), row("ins", "liability", null, "2026-10-23T10:00:00Z")], today);
  const registration = versions.find(v => v.kind === "registration")!;
  assert.equal(registration.current.id, "new"); assert.deepEqual(registration.superseded.map(v => v.id), ["old"]); assert.equal(registration.validity.state, "valid");
  assert.equal(versions.find(v => v.kind === "liability")!.validity.state, "undated");
});

test("summary: expired and missing credentials are not counted as valid; a replaced expired version does not make the kind expired", () => {
  const all = [row("old", "registration", "2026-10-13", "2026-08-24T10:00:00Z"), row("new", "registration", "2027-12-27", "2026-11-20T10:00:00Z"), row("ins", "liability", "2026-12-04", "2026-10-23T10:00:00Z"), row("q", "qualification", "2026-11-21", "2026-11-02T10:00:00Z")];
  const s = validitySummary(all, REQUIRED_CREDENTIAL_KINDS, today);
  assert.deepEqual({ required: s.required, transmitted: s.transmitted, valid: s.valid, expired: s.expired, expiring: s.expiring, missing: s.missing }, { required: 3, transmitted: 3, valid: 2, expired: 1, expiring: 1, missing: 0 });
  assert.equal(s.label, "2 pièces en cours de validité sur 3 obligatoires · 1 expirée (non comptée) · 1 expire bientôt");
  const none = validitySummary([row("x", "other", null, "2026-11-02T10:00:00Z")], REQUIRED_CREDENTIAL_KINDS, today);
  assert.equal(none.valid, 0); assert.equal(none.missing, 3); assert.match(none.label, /^0 pièce en cours de validité sur 3 obligatoires · 3 manquantes$/);
  // a newer expired version replaces a still-valid older one: the kind is expired
  const regressed = validitySummary([row("a", "liability", "2027-01-01", "2026-01-01T10:00:00Z"), row("b", "liability", "2026-11-01", "2026-11-10T10:00:00Z")], ["liability"], today);
  assert.equal(regressed.valid, 0); assert.equal(regressed.expired, 1);
});
