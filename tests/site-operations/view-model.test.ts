// Normalized leaf rules (WEB-SHARED-001, amendments A1/A2) on pure decisions: read-only ceiling,
// scope remount key, stale results, form helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { demoReport } from "../../lib/features/site-operations/demo";
import { fieldErrors, fromCents, fromInstant, toCents, toInstant, toInt } from "../../lib/features/site-operations/forms";
import { equipmentPayload } from "../../lib/features/site-operations/schemas";
import { SCOPE_READ_ONLY, SERVER_READ_ONLY, messageOf, outcomeOf, resolveAuthority, scopeKey } from "../../lib/features/site-operations/view-model";
import type { SiteOperationsScope } from "../../lib/features/site-operations/types";

const scope = (canWrite: boolean, reason?: string): SiteOperationsScope => ({ userId: "u1", role: "manager", organizationId: "o1", siteId: "s1", authority: { canWrite, reason } });

test("authority: the lead's scope is a ceiling, the server can only restrict further", () => {
  const report = demoReport();
  assert.deepEqual(resolveAuthority(scope(false, "Votre rôle est en lecture seule dans cette organisation."), report), { canWrite: false, canWriteOrganization: false, readOnlyReason: "Votre rôle est en lecture seule dans cette organisation." });
  assert.deepEqual(resolveAuthority(scope(false), report), { canWrite: false, canWriteOrganization: false, readOnlyReason: SCOPE_READ_ONLY });
  assert.deepEqual(resolveAuthority(scope(true), report), { canWrite: true, canWriteOrganization: true, readOnlyReason: null });
  const siteOnly = { ...report, snapshot: { ...report.snapshot, limits: { ...report.snapshot.limits, can_write_organization: false } } };
  assert.deepEqual(resolveAuthority(scope(true), siteOnly), { canWrite: true, canWriteOrganization: false, readOnlyReason: null });
  const revoked = { ...report, snapshot: { ...report.snapshot, limits: { ...report.snapshot.limits, can_write_site: false, can_write_organization: true } } };
  assert.deepEqual(resolveAuthority(scope(true), revoked), { canWrite: false, canWriteOrganization: false, readOnlyReason: SERVER_READ_ONLY }, "server refusal wins even when the lead allowed writes");
  assert.equal(resolveAuthority(scope(true), null).canWriteOrganization, false, "no report: no organisation write control");
});
test("scope key changes on user, organisation or site; stable otherwise", () => {
  const base = scope(true);
  assert.equal(scopeKey(base), scopeKey({ ...base, role: "viewer", authority: { canWrite: false } }));
  assert.notEqual(scopeKey(base), scopeKey({ ...base, userId: "u2" }));
  assert.notEqual(scopeKey(base), scopeKey({ ...base, organizationId: "o2" }));
  assert.notEqual(scopeKey(base), scopeKey({ ...base, siteId: "s2" }));
  assert.notEqual(scopeKey(base), scopeKey({ ...base, organizationId: undefined }));
});
test("a null command result is stale: neither success nor update; errors keep the server wording", () => {
  assert.deepEqual(outcomeOf(null), { status: "stale" });
  assert.deepEqual(outcomeOf({ action: "save_equipment", result: {} }, false), { status: "stale" }, "unmounted component");
  assert.deepEqual(outcomeOf({ action: "save_equipment", result: { id: "x" } }), { status: "done", result: { action: "save_equipment", result: { id: "x" } } });
  assert.equal(messageOf(new Error("Vous n’avez pas accès à cette action.")), "Vous n’avez pas accès à cette action.");
  assert.equal(messageOf(new Error("")), "L’action n’a pas pu être réalisée. Réessayez.");
  assert.equal(messageOf("boom"), "L’action n’a pas pu être réalisée. Réessayez.");
});
test("form helpers: euro text, integers, instants and field-level errors", () => {
  assert.equal(toCents("1 234,50"), 123450);
  assert.equal(toCents("45"), 4500);
  assert.equal(toCents("45.5"), 4550);
  assert.ok(Number.isNaN(toCents("45,555")));
  assert.ok(Number.isNaN(toCents("abc")));
  assert.ok(Number.isNaN(toCents("-1")));
  assert.equal(fromCents(123450), "1234,50");
  assert.equal(toInt(""), null);
  assert.equal(toInt("12"), 12);
  assert.ok(Number.isNaN(toInt("1.5") as number));
  assert.equal(toInstant(""), null);
  assert.equal(toInstant("not a date"), "invalid");
  const roundTrip = toInstant(fromInstant("2026-10-05T07:30:00.000Z"));
  assert.equal(roundTrip, "2026-10-05T07:30:00.000Z");
  const errors = fieldErrors(equipmentPayload, { name: "", category: "panel", criticality: "high", location: "", reference: "", installed_on: "bad", status: "in_service", notes: "" });
  assert.ok(errors.name);
  assert.match(errors.installed_on, /AAAA-MM-JJ/);
  assert.deepEqual(fieldErrors(equipmentPayload, { name: "QA", category: "panel", criticality: "high", location: "", reference: "", installed_on: null, status: "in_service", notes: "" }), {});
});
