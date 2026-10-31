import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, baseUrlAllowed, SUITE_NAMES } from "../lib/args.mjs";

const SHA = "a".repeat(40);
const base = ["--base-url", "http://localhost:3017", "--sha", SHA, "--project", "abcdefghijklmnopqrst", "--credentials", "/private/creds.json"];

test("full valid command parses with all suites by default", () => {
  const { options, errors } = parseArgs(base);
  assert.deepEqual(errors, []);
  assert.deepEqual(options.suites, SUITE_NAMES);
  assert.equal(options.headless, true);
  assert.equal(options.dryRun, false);
});

test("repeated --suite, --allow-base-url and boolean flags", () => {
  const { options, errors } = parseArgs([...base, "--suite", "captures", "--suite=quote-draft", "--allow-base-url", "https://preview.example", "--no-headless", "--dry-run", "--json", "--keep-fixtures"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(options.suites, ["captures", "quote-draft"]);
  assert.deepEqual(options.allowBaseUrls, ["https://preview.example"]);
  assert.equal(options.headless, false);
  assert.ok(options.dryRun && options.json && options.keepFixtures);
});

test("missing required flags and malformed values are reported", () => {
  const { errors } = parseArgs(["--base-url", "localhost:3017/app", "--sha", "abc", "--project", "Not-A-Ref"]);
  assert.ok(errors.some((e) => /--sha must be a full 40-hex/.test(e)));
  assert.ok(errors.some((e) => /--project must be/.test(e)));
  assert.ok(errors.some((e) => /--credentials is required/.test(e)));
  assert.ok(errors.some((e) => /--base-url/.test(e)));
});

test("unknown arguments, unknown suites and duplicates are refused", () => {
  const { errors } = parseArgs([...base, "--bogus", "--suite", "nope", "--suite", "captures", "--suite", "captures"]);
  assert.ok(errors.some((e) => /unknown argument --bogus/.test(e)));
  assert.ok(errors.some((e) => /unknown suite nope/.test(e)));
  assert.ok(errors.some((e) => /duplicate --suite/.test(e)));
});

test("captures-only run needs neither project nor credentials", () => {
  const { errors } = parseArgs(["--base-url", "http://127.0.0.1:3000", "--sha", SHA, "--suite", "captures"]);
  assert.deepEqual(errors, []);
});

test("--dry-run without credentials is accepted (plan only)", () => {
  const { errors } = parseArgs(["--base-url", "http://localhost:3017", "--sha", SHA, "--project", "abcdefghijklmnopqrst", "--dry-run"]);
  assert.deepEqual(errors, []);
});

test("env provides the Playwright path default", () => {
  const { options } = parseArgs(base, { QA_PLAYWRIGHT_PATH: "/opt/pw" });
  assert.equal(options.playwrightPath, "/opt/pw");
});

test("base URL allow-list: local always, remote only when listed by origin", () => {
  assert.equal(baseUrlAllowed("http://localhost:3017").target, "local");
  assert.equal(baseUrlAllowed("http://127.0.0.1:3000").target, "local");
  assert.equal(baseUrlAllowed("https://app.example.com").allowed, false);
  assert.equal(baseUrlAllowed("https://app.example.com", ["https://app.example.com/"]).target, "remote-allowed");
  assert.equal(baseUrlAllowed("https://app.example.com", ["https://other.example.com"]).allowed, false);
  assert.equal(baseUrlAllowed("not a url").allowed, false);
});

test("--timeout-ms defaults to 90000 and refuses values below 1000 or non-integers", () => {
  assert.equal(parseArgs(base).options.timeoutMs, 90000);
  assert.equal(parseArgs([...base, "--timeout-ms", "120000"]).options.timeoutMs, 120000);
  assert.ok(parseArgs([...base, "--timeout-ms", "500"]).errors.some((e) => /--timeout-ms/.test(e)));
  assert.ok(parseArgs([...base, "--timeout-ms", "soon"]).errors.some((e) => /--timeout-ms/.test(e)));
});

test("--cleanup-manifest mode needs credentials and project only", () => {
  assert.deepEqual(parseArgs(["--cleanup-manifest", "/tmp/m.json", "--credentials", "/c.json", "--project", "abcdefghijklmnopqrst"]).errors, []);
  assert.ok(parseArgs(["--cleanup-manifest", "/tmp/m.json"]).errors.length >= 2);
});
