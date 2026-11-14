// Normalized leaf rules (WEB-SHARED-001, amendments A1/A2) on pure decisions: read-only ceiling,
// scope remount key, stale results, form helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { demoReport } from "../../lib/features/site-operations/demo";
import { fieldErrors, fromCents, fromInstant, toCents, toInstant, toInt } from "../../lib/features/site-operations/forms";
import { equipmentPayload } from "../../lib/features/site-operations/schemas";
import { AUTHORITY_UNVERIFIED, INITIAL_LOAD, SCOPE_READ_ONLY, SERVER_READ_ONLY, STALE_CONTEXT, applyLoadResult, messageOf, outcomeOf, resolveAuthority, scopeKey } from "../../lib/features/site-operations/view-model";
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
  assert.deepEqual(resolveAuthority(scope(true), null), { canWrite: false, canWriteOrganization: false, readOnlyReason: AUTHORITY_UNVERIFIED }, "no report: nothing writable");
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
  assert.equal(errors.installed_on, "Choisissez une date valide.");
  assert.deepEqual(fieldErrors(equipmentPayload, { name: "QA", category: "panel", criticality: "high", location: "", reference: "", installed_on: null, status: "in_service", notes: "" }), {});
});
test("a refused or failed load invalidates the displayed report and every write control", () => {
  const report = demoReport();
  const loaded = applyLoadResult(INITIAL_LOAD, { kind: "ok", report });
  assert.equal(loaded.report, report);
  assert.equal(resolveAuthority(scope(true), loaded.report, loaded.stale).canWrite, true);
  const refused = applyLoadResult(loaded, { kind: "error", message: "Vous n’avez pas accès à cette action." });
  assert.equal(refused.report, null, "403: previous report discarded");
  assert.equal(refused.error, "Vous n’avez pas accès à cette action.");
  assert.equal(refused.stale, false);
  assert.deepEqual(resolveAuthority(scope(true), refused.report, refused.stale), { canWrite: false, canWriteOrganization: false, readOnlyReason: AUTHORITY_UNVERIFIED }, "canWrite false after refusal");
  const failed = applyLoadResult(loaded, { kind: "error", message: "Les données sont momentanément indisponibles. Réessayez." });
  assert.equal(failed.report, null, "503: nothing stale remains");
  const recovered = applyLoadResult(failed, { kind: "ok", report });
  assert.equal(recovered.error, "");
  assert.equal(resolveAuthority(scope(true), recovered.report, recovered.stale).canWrite, true);
});
test("a null (stale) load leaves no actionable state: data untouched, writes disabled until a fresh load", () => {
  const report = demoReport();
  const loaded = applyLoadResult(INITIAL_LOAD, { kind: "ok", report });
  const stale = applyLoadResult(loaded, { kind: "stale" });
  assert.equal(stale.report, report, "no data update on null");
  assert.equal(stale.stale, true);
  assert.deepEqual(resolveAuthority(scope(true), stale.report, stale.stale), { canWrite: false, canWriteOrganization: false, readOnlyReason: STALE_CONTEXT });
  const staleFromNothing = applyLoadResult(INITIAL_LOAD, { kind: "stale" });
  assert.equal(staleFromNothing.report, null);
  assert.equal(resolveAuthority(scope(true), staleFromNothing.report, staleFromNothing.stale).canWrite, false);
  const fresh = applyLoadResult(stale, { kind: "ok", report });
  assert.equal(fresh.stale, false);
  assert.equal(resolveAuthority(scope(true), fresh.report, fresh.stale).canWrite, true);
  assert.notEqual(scopeKey(scope(true)), scopeKey({ ...scope(true), siteId: "s2" }), "a scope change remounts: the previous report is cleared");
});
test("budget selection barrier: mount with 0 years → first year created → refreshed report makes the lines table reachable", async () => {
  const { effectiveFiscalYearId, selectionAfterYearCreated } = await import("../../lib/features/site-operations/view-model");
  // Mount: the panel's initial state is computed from an empty report (as in root run 78a5f871aaba).
  let chosen = "";
  assert.equal(effectiveFiscalYearId(chosen, [], null), "", "no year: nothing selected, no lines table");
  // « Ajouter un exercice » succeeds: onDone receives the created row; the report then refreshes.
  const created = { id: "f1", starts_on: "2026-01-01", ends_on: "2026-12-31" };
  chosen = selectionAfterYearCreated(chosen, created, "2026-10-31");
  assert.equal(chosen, "f1", "a newly created CURRENT year becomes the selection");
  const refreshed = [{ id: "f1" }];
  assert.equal(effectiveFiscalYearId(chosen, refreshed, "f1"), "f1", "lines table and « Saisir » reachable without remount");
  // Even without the onDone selection (e.g. a year created elsewhere), the refreshed report recovers.
  assert.equal(effectiveFiscalYearId("", refreshed, "f1"), "f1");
  assert.equal(effectiveFiscalYearId("", refreshed, null), "f1", "no current year: first listed");
  // A non-current created year does not steal an existing choice.
  assert.equal(selectionAfterYearCreated("f1", { id: "f2", starts_on: "2027-01-01", ends_on: "2027-12-31" }, "2026-10-31"), "f1");
  assert.equal(selectionAfterYearCreated("f1", null, "2026-10-31"), "f1");
  // Explicit choice kept while it exists; removed/unknown choice falls back.
  const two = [{ id: "f2" }, { id: "f1" }];
  assert.equal(effectiveFiscalYearId("f2", two, "f1"), "f2", "explicit choice kept");
  assert.equal(effectiveFiscalYearId("gone", two, "f1"), "f1", "unknown choice → current");
  assert.equal(effectiveFiscalYearId("gone", two, "absent"), "f2", "unknown choice and unknown current → first");
});
