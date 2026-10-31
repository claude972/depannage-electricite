import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor } from "../lib/redact.mjs";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnopqrstuvwxyz0123456789";

test("registered secrets are removed from strings, longest first", () => {
  const r = createRedactor(["supersecretvalue", "supersecretvalue-extended"]);
  assert.equal(r.redactString("key=supersecretvalue-extended and supersecretvalue"), "key=[REDACTED] and [REDACTED]");
});

test("short values are not registered (would redact everything)", () => {
  const r = createRedactor(["abc"]);
  assert.equal(r.size(), 0);
  assert.equal(r.redactString("abc stays"), "abc stays");
});

test("token parameters, auth cookies, JWTs and new-style keys are redacted by pattern", () => {
  const r = createRedactor();
  assert.equal(r.redactString("https://x/#access_token=AAA.BBB&refresh_token=CCC&type=recovery"), "https://x/#access_token=[REDACTED]&refresh_token=[REDACTED]&type=recovery");
  assert.equal(r.redactString("cookie: sb-abcdefghij-auth-token.0=base64-chunk; other=1"), "cookie: [REDACTED]; other=1");
  assert.equal(r.redactString(`Bearer ${JWT}`), "Bearer [REDACTED]");
  assert.equal(r.redactString("Authorization: Bearer sb_secret_1234567890abcdef"), "Authorization: [REDACTED]");
  assert.equal(r.redactString("key sb_publishable_abcdefghijkl ok"), "key [REDACTED] ok");
  assert.equal(r.redactString("code=12345678-aaaa"), "code=[REDACTED]");
});

test("objects are redacted recursively and sensitive keys are masked whole", () => {
  const r = createRedactor(["generated-password-123"]);
  const out = r.redact({
    user: { email: "qa-x@qa.invalid", password: "anything", nested: [{ note: "pw generated-password-123" }] },
    service_role_key: "value",
    Authorization: "Bearer x",
    status: 200,
  });
  assert.deepEqual(out, {
    user: { email: "qa-x@qa.invalid", password: "[REDACTED]", nested: [{ note: "pw [REDACTED]" }] },
    service_role_key: "[REDACTED]",
    Authorization: "[REDACTED]",
    status: 200,
  });
});

test("errors become plain {name, message} with redaction", () => {
  const r = createRedactor([JWT]);
  const out = r.redact(new Error(`failed with ${JWT}`));
  assert.deepEqual(out, { name: "Error", message: "failed with [REDACTED]" });
});

test("non-string primitives pass through", () => {
  const r = createRedactor();
  assert.equal(r.redact(42), 42);
  assert.equal(r.redact(null), null);
  assert.equal(r.redact(true), true);
});
