import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor, summarizeNetwork } from "../lib/redact.mjs";

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
  assert.equal(r.redactString("value sb-abcdefghij-auth-token.0=base64-chunk; other=1"), "value [REDACTED]; other=1");
  assert.equal(r.redactString(`Bearer ${JWT}`), "Bearer [REDACTED]");
  assert.equal(r.redactString("Authorization: Bearer sb_secret_1234567890abcdef"), "Authorization: [REDACTED]");
  assert.equal(r.redactString("key sb_publishable_abcdefghijkl ok"), "key [REDACTED] ok");
  assert.equal(r.redactString("code=12345678-aaaa"), "code=[REDACTED]");
});

test("cookie header text is redacted whole (QA-003: the crash printed a cookie)", () => {
  const r = createRedactor();
  const line = "  headers: { cookie: 'sb-kcpyjzndybfdlnhvscbs-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJleUoiLCJ0b2tlbl90eXBlIjoiYmVhcmVyIn0; other=1' }";
  const out = r.redactString(line);
  assert.ok(!out.includes("base64-eyJ"), out);
  assert.ok(!out.includes("sb-kcpyjzndybfdlnhvscbs-auth-token="), out);
  assert.equal(r.redactString("Set-Cookie: sb-x-auth-token=abc; Path=/"), "Set-Cookie: [REDACTED]");
});

test("thrown errors are redacted in message AND stack", () => {
  const r = createRedactor(["generated-password-xyz"]);
  const error = new Error(`route.fetch failed with cookie sb-proj-auth-token=${JWT} and pw generated-password-xyz`);
  error.stack = `${error.name}: ${error.message}\n    at handler (file.mjs:1:1) Authorization: Bearer ${JWT}\n    at cookie: sb-proj-auth-token.1=chunk2`;
  const out = r.redactError(error);
  assert.equal(out.name, "Error");
  assert.ok(!out.message.includes(JWT) && !out.message.includes("generated-password-xyz"), out.message);
  assert.ok(!out.stack.includes(JWT) && !out.stack.includes("chunk2"), out.stack);
  assert.match(out.stack, /at handler/);
  // redact() of an Error yields the same shape
  assert.deepEqual(r.redact(error), out);
  // non-Error values still produce a safe shape
  assert.deepEqual(r.redactError("plain string with code=abcd1234"), { name: "Error", message: "plain string with code=[REDACTED]", stack: null });
});

test("header-like keys are masked whole in objects (headers, cookie, authorization, apikey, x-api-key)", () => {
  const r = createRedactor();
  const out = r.redact({
    request: { method: "POST", path: "/api/support", headers: { cookie: "sb=1", authorization: "Bearer x" } },
    cookie: "a=b",
    Authorization: "Bearer y",
    apikey: "k",
    "x-api-key": "k2",
    "set-cookie": "sb=2",
    status: 200,
  });
  assert.deepEqual(out, { request: { method: "POST", path: "/api/support", headers: "[REDACTED]" }, cookie: "[REDACTED]", Authorization: "[REDACTED]", apikey: "[REDACTED]", "x-api-key": "[REDACTED]", "set-cookie": "[REDACTED]", status: 200 });
});

test("network summary keeps only method, path and status", () => {
  assert.deepEqual(summarizeNetwork([{ method: "GET", path: "/api/workspace", status: 200, url: "http://x/api/workspace?token=1", headers: { cookie: "x" }, body: "y" }]), [{ method: "GET", path: "/api/workspace", status: 200 }]);
});

test("objects are redacted recursively and sensitive keys are masked whole", () => {
  const r = createRedactor(["generated-password-123"]);
  const out = r.redact({
    user: { email: "qa-x@qa.invalid", password: "anything", nested: [{ note: "pw generated-password-123" }] },
    service_role_key: "value",
    status: 200,
  });
  assert.deepEqual(out, { user: { email: "qa-x@qa.invalid", password: "[REDACTED]", nested: [{ note: "pw [REDACTED]" }] }, service_role_key: "[REDACTED]", status: 200 });
});

test("non-string primitives pass through", () => {
  const r = createRedactor();
  assert.equal(r.redact(42), 42);
  assert.equal(r.redact(null), null);
  assert.equal(r.redact(true), true);
});
