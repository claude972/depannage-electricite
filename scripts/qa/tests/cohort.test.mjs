import { test } from "node:test";
import assert from "node:assert/strict";
import { createCohort, newRunId, newPassword, isUuid, EMAIL_DOMAIN } from "../lib/cohort.mjs";

test("run ids are 12 hex characters and unique", () => {
  const a = newRunId();
  const b = newRunId();
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test("every generated name carries the run id; emails use the reserved domain", () => {
  const c = createCohort("0123456789ab");
  assert.equal(c.email("Support A"), `qa-0123456789ab-support-a@${EMAIL_DOMAIN}`);
  assert.equal(c.fullName("owner"), "QA 0123456789AB owner");
  assert.equal(c.name("Site A"), "QA-0123456789AB Site A");
  assert.equal(c.description("x"), "QA-0123456789AB x");
  assert.equal(EMAIL_DOMAIN, "qa.invalid");
  assert.ok(c.belongs(c.name("y")));
  assert.ok(c.belongs(c.email("z")));
  assert.ok(!c.belongs("QA-FFFFFFFFFFFF other cohort"));
});

test("invalid run ids are refused", () => {
  assert.throws(() => createCohort("short"));
});

test("passwords are long, random and contain required classes", () => {
  const p = newPassword();
  assert.ok(p.length > 40);
  assert.match(p, /[A-Z]/);
  assert.match(p, /[a-z]/);
  assert.match(p, /[0-9]/);
  assert.match(p, /[!]/);
  assert.notEqual(newPassword(), p);
});

test("uuid guard", () => {
  assert.ok(isUuid("123e4567-e89b-12d3-a456-426614174000"));
  assert.ok(!isUuid("123e4567e89b12d3a456426614174000"));
  assert.ok(!isUuid("*"));
});
