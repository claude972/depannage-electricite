// QA-PWA-LIFECYCLE-002 — unit tests of the pure helpers and of the CLI refusal path (no server, no browser).
// Run: node --test tests/qa-pwa-lifecycle*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, extractSwVersion, scanEnvKeyNames, classifyCacheEntries, compareStageEvidence, childEnv, buildServerArgs, readinessUrls, exitCodeFor, splitConsoleRecords, isExpectedProbeRecord, EXPECTED_PROBE, DEFAULT_PORT } from "../scripts/qa-pwa-lifecycle/lib.mjs";

const execFileAsync = promisify(execFile);
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const base = ["--old-dir", "/tmp/old", "--old-sha", SHA_A, "--new-dir", "/tmp/new", "--new-sha", SHA_B, "--playwright-path", "/tmp/pw", "--out", "/tmp/out"];

test("parseArgs: required flags, full SHAs, distinct builds, port/timeout bounds, duplicates, env defaults", () => {
  const ok = parseArgs(base);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.options.port, DEFAULT_PORT);
  assert.equal(ok.options.headless, true);
  assert.ok(parseArgs(["--old-dir", "/tmp/old"]).errors.length >= 4);
  assert.ok(parseArgs([...base.slice(0, 3), "abc", ...base.slice(4)]).errors.some((e) => /40-hex/.test(e)));
  assert.ok(parseArgs(base.map((v) => (v === SHA_B ? SHA_A : v))).errors.some((e) => /must differ/.test(e)));
  assert.ok(parseArgs(base.map((v) => (v === "/tmp/new" ? "/tmp/old" : v))).errors.some((e) => /two different checkouts/.test(e)));
  assert.ok(parseArgs([...base, "--port", "80"]).errors.some((e) => /--port/.test(e)));
  assert.ok(parseArgs([...base, "--timeout-ms", "10"]).errors.some((e) => /--timeout-ms/.test(e)));
  assert.ok(parseArgs([...base, "--out", "/x"]).errors.some((e) => /given twice/.test(e)));
  assert.ok(parseArgs([...base, "--bogus"]).errors.some((e) => /unknown argument/.test(e)));
  const env = parseArgs(base.filter((v, i) => !(v === "--playwright-path" || base[i - 1] === "--playwright-path")), { QA_PLAYWRIGHT_PATH: "/env/pw" });
  assert.deepEqual(env.errors, []);
  assert.equal(env.options.playwrightPath, "/env/pw");
  assert.equal(parseArgs(["--help"]).options.help, true);
  assert.equal(parseArgs([...base, "--no-headless", "--dry-run", "--json"]).options.headless, false);
});

test("extractSwVersion reads the prefix and vN from the real worker pattern, null otherwise", () => {
  const src = 'const PUBLIC_CACHE_PREFIX = "courant-pwa-public-";\nconst PUBLIC_CACHE = `${PUBLIC_CACHE_PREFIX}v3`;';
  assert.deepEqual(extractSwVersion(src), { prefix: "courant-pwa-public-", version: 3, cacheName: "courant-pwa-public-v3" });
  assert.equal(extractSwVersion("self.addEventListener('fetch', () => {})"), null);
});

test("scanEnvKeyNames returns names only and flags secret-looking names without reading values", () => {
  const text = "# comment\nNEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co\nexport NEXT_PUBLIC_SUPABASE_ANON_KEY=public-value\n\nSUPABASE_SERVICE_ROLE_KEY=should-never-be-read\nSTRIPE_SECRET_KEY=x\nMY_TOKEN=y\n";
  const scan = scanEnvKeyNames(text);
  assert.deepEqual(scan.names, ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "MY_TOKEN"]);
  assert.deepEqual(scan.forbidden, ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "MY_TOKEN"]);
  assert.ok(!JSON.stringify(scan).includes("should-never-be-read"));
  assert.deepEqual(scanEnvKeyNames("NEXT_PUBLIC_SUPABASE_URL=a\n").forbidden, []);
});

test("classifyCacheEntries: /offline.html only in own caches; /api, /auth, /_next/data anywhere are private", () => {
  const prefix = "courant-pwa-public-";
  assert.equal(classifyCacheEntries([{ cache: "courant-pwa-public-v3", path: "/offline.html" }], prefix).ok, true);
  const bad = classifyCacheEntries(
    [
      { cache: "courant-pwa-public-v3", path: "/offline.html" },
      { cache: "courant-pwa-public-v3", path: "/" },
      { cache: "other", path: "/api/workspace" },
      { cache: "other", path: "/auth/callback?code=x" },
      { cache: "other", path: "/_next/data/abc/index.json" },
      { cache: "other", path: "/qa-public-marker" },
    ],
    prefix,
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.privateEntries.map((e) => e.path), ["/api/workspace", "/auth/callback?code=x", "/_next/data/abc/index.json"]);
  assert.deepEqual(bad.unexpected.map((e) => e.path), ["/"]);
  assert.equal(classifyCacheEntries([{ cache: "other", path: "/apiary" }], prefix).ok, true, "prefix match must be path-segment based");
});

test("compareStageEvidence reports every mismatch and refuses a stage carrying a service key", () => {
  const observed = { oldSha: SHA_A, newSha: SHA_B, oldBuildId: "old-id", newBuildId: "new-id", oldSwSha256: "1".repeat(64), newSwSha256: "2".repeat(64) };
  assert.deepEqual(compareStageEvidence({ old_source: SHA_A, new_source: SHA_B, new_build_id: "new-id", old_sw_sha256: "1".repeat(64), new_sw_sha256: "2".repeat(64), private_service_key_copied: false }, observed), []);
  const mismatches = compareStageEvidence({ old_source: SHA_B, new_build_id: "zzz", new_sw_sha256: "3".repeat(64), private_service_key_copied: true }, observed);
  assert.equal(mismatches.length, 4);
  assert.ok(mismatches.some((m) => m.startsWith("old_source:")) && mismatches.some((m) => m.startsWith("new_build_id:")) && mismatches.some((m) => m.startsWith("new_sw_sha256:")) && mismatches.some((m) => /service key/.test(m)));
  assert.deepEqual(compareStageEvidence({}, observed), [], "absent keys are not compared");
});

test("childEnv passes nothing from the pilot's shell except PATH/HOME/TMPDIR/LANG", () => {
  const env = childEnv({ PATH: "/usr/bin", HOME: "/Users/x", SUPABASE_SERVICE_ROLE_KEY: "leak", NEXT_PUBLIC_X: "y", AWS_SECRET_ACCESS_KEY: "leak2" }, { port: 3020 });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "HOSTNAME", "NEXT_TELEMETRY_DISABLED", "NODE_ENV", "PATH", "PORT"]);
  assert.equal(env.PORT, "3020");
  assert.equal(env.NODE_ENV, "production");
  assert.ok(!JSON.stringify(env).includes("leak"));
});

test("buildServerArgs targets the checkout's own next binary with the dedicated port on 127.0.0.1; readiness probes / and /sw.js", () => {
  assert.deepEqual(buildServerArgs("/tmp/old", 3020), ["/tmp/old/node_modules/next/dist/bin/next", "start", "-p", "3020", "-H", "127.0.0.1"]);
  assert.deepEqual(readinessUrls("http://localhost:3020"), ["http://localhost:3020/", "http://localhost:3020/sw.js"]);
});

test("exitCodeFor: 3 when a child server is not proven stopped (dominates), 1 on FAIL/SKIPPED/FATAL/no step, 0 otherwise", () => {
  assert.equal(exitCodeFor({ steps: [{ status: "PASS" }], serversStopped: true }), 0);
  assert.equal(exitCodeFor({ steps: [{ status: "PASS" }, { status: "FAIL" }], serversStopped: true }), 1);
  assert.equal(exitCodeFor({ steps: [{ status: "PASS" }, { status: "SKIPPED" }], serversStopped: true }), 1);
  assert.equal(exitCodeFor({ steps: [{ status: "PASS" }], fatal: { origin: "x" }, serversStopped: true }), 1);
  assert.equal(exitCodeFor({ steps: [], serversStopped: true }), 1);
  assert.equal(exitCodeFor({ steps: [{ status: "PASS" }], serversStopped: false }), 3);
});

const PROBE_LINE = "Failed to load resource: the server responded with a status of 401 (Unauthorized)";

test("isExpectedProbeRecord: only a console error for exactly /api/workspace with status 401 during a probe phase", () => {
  const good = { phase: "probe-v2", kind: "console", type: "error", url: "http://localhost:3020/api/workspace", text: PROBE_LINE };
  assert.equal(isExpectedProbeRecord(good), true);
  assert.equal(isExpectedProbeRecord({ ...good, phase: "probe-v3" }), true);
  assert.equal(isExpectedProbeRecord({ ...good, phase: "online" }), false, "outside a probe phase");
  assert.equal(isExpectedProbeRecord({ ...good, url: "http://localhost:3020/api/workspace/extra" }), false, "other path");
  assert.equal(isExpectedProbeRecord({ ...good, url: "http://localhost:3020/api/workspacex" }), false, "prefix is not enough");
  assert.equal(isExpectedProbeRecord({ ...good, url: "http://localhost:3020/auth/callback" }), false);
  assert.equal(isExpectedProbeRecord({ ...good, text: PROBE_LINE.replace("401 (Unauthorized)", "500 (Internal Server Error)") }), false, "other status");
  assert.equal(isExpectedProbeRecord({ ...good, text: "Uncaught TypeError: x is not a function" }), false, "app error on the same URL");
  assert.equal(isExpectedProbeRecord({ ...good, kind: "pageerror" }), false, "pageerror never expected");
  assert.equal(isExpectedProbeRecord({ ...good, type: "warning" }), false);
  assert.equal(isExpectedProbeRecord({ ...good, url: "" }), false);
  assert.equal(isExpectedProbeRecord({ ...good, url: "not a url" }), false, "an odd URL resolves to another path");
  assert.equal(isExpectedProbeRecord({ ...good, url: "/api/workspace" }), true, "a relative URL resolves against localhost");
  assert.deepEqual(EXPECTED_PROBE, { path: "/api/workspace", status: 401, phases: ["probe-v2", "probe-v3"], maxPerPhase: 1 });
});

test("splitConsoleRecords: one expected probe line per probe phase, every other error fails, offline-phase failures listed apart, warnings ignored", () => {
  const probe = (phase) => ({ phase, kind: "console", type: "error", url: "http://localhost:3020/api/workspace", text: PROBE_LINE });
  const records = [
    { phase: "online", kind: "console", type: "warning", text: "w" },
    probe("probe-v2"),
    probe("probe-v3"),
    { phase: "online", kind: "console", type: "error", url: "http://localhost:3020/_next/static/x.js", text: "boom" },
    { phase: "probe-v2", kind: "pageerror", text: "TypeError inside probe phase" },
    { phase: "probe-v3", kind: "console", type: "error", url: "http://localhost:3020/auth/callback", text: PROBE_LINE },
    { phase: "offline", kind: "console", type: "error", url: "http://localhost:3020/", text: "net::ERR_INTERNET_DISCONNECTED" },
  ];
  const split = splitConsoleRecords(records);
  assert.deepEqual(split.probeExpected.map((r) => r.phase), ["probe-v2", "probe-v3"]);
  assert.deepEqual(split.failing.map((r) => r.text), ["boom", "TypeError inside probe phase", PROBE_LINE]);
  assert.deepEqual(split.offlineExpected.map((r) => r.text), ["net::ERR_INTERNET_DISCONNECTED"]);
  assert.deepEqual(split.online, split.failing);
  // A second probe line in the same phase is NOT masked.
  const twice = splitConsoleRecords([probe("probe-v2"), probe("probe-v2")]);
  assert.equal(twice.probeExpected.length, 1);
  assert.equal(twice.failing.length, 1);
  assert.deepEqual(splitConsoleRecords([]), { failing: [], online: [], probeExpected: [], offlineExpected: [] });
});

test("CLI --dry-run with fake checkouts is refused at preflight (exit 2) before any server or browser", async () => {
  const entry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/qa-pwa-lifecycle.mjs");
  const run = (args) => execFileAsync(process.execPath, [entry, ...args], { timeout: 30000 }).then((r) => ({ code: 0, ...r })).catch((e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  const refused = await run(["--old-dir", "/nonexistent/old", "--old-sha", SHA_A, "--new-dir", "/nonexistent/new", "--new-sha", SHA_B, "--playwright-path", "/nonexistent/pw", "--out", "/tmp/qa-pwa-unit-out", "--dry-run"]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /refused: --old-dir .* does not exist/);
  const invalid = await run(["--old-dir", "/x", "--dry-run"]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /error: /);
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: node scripts\/qa-pwa-lifecycle\.mjs/);
});
