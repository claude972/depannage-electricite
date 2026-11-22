// QA-PWA-LIFECYCLE-002 — unit tests of the pure helpers and of the CLI refusal path (no server, no browser).
// Run: node --test tests/qa-pwa-lifecycle*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { parseArgs, extractSwVersion, scanEnvKeyNames, classifyCacheEntries, compareStageEvidence, childEnv, buildServerArgs, readinessUrls, exitCodeFor, splitConsoleRecords, isExpectedProbeRecord, isExpectedOfflineRecord, servedBuildIdMarkers, classifyOnlineRecovery, demoReopenPlan, isRealDocumentReopen, EXPECTED_PROBE, EXPECTED_OFFLINE, DEFAULT_PORT } from "../scripts/qa-pwa-lifecycle/lib.mjs";
import { createServerController } from "../scripts/qa-pwa-lifecycle/servers.mjs";
import { createStopGate, createLifecycle, StopRequestedError } from "../scripts/qa/lib/lifecycle.mjs";

/** Fake spawner: children exit asynchronously on SIGTERM (or never, when `ignoreSigterm`). */
function fakeSpawner({ ignoreSigterm = false, ignoreSigkill = false, exitDelayMs = 10 } = {}) {
  const spawned = [];
  const listening = new Set();
  let nextPid = 1000;
  const spawn = (build) => {
    const child = new EventEmitter();
    child.pid = ++nextPid;
    child.alive = true;
    listening.add(child.pid);
    child.kill = (signal) => {
      if (!child.alive) return;
      if (signal === "SIGTERM" && ignoreSigterm) return;
      if (signal === "SIGKILL" && ignoreSigkill) return;
      setTimeout(() => {
        child.alive = false;
        listening.delete(child.pid);
        child.emit("exit", signal === "SIGKILL" ? null : 143, signal === "SIGKILL" ? "SIGKILL" : null);
      }, exitDelayMs);
    };
    spawned.push({ pid: child.pid, dir: build.dir, child });
    return child;
  };
  return { spawn, spawned, listening, portListening: async () => listening.size > 0, alive: () => spawned.filter((s) => s.child.alive).map((s) => s.pid) };
}

test("server controller: start registers the pid before readiness, stop waits for exit and port release, SIGKILL after a bounded grace", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner({ ignoreSigterm: true, exitDelayMs: 5 });
  const logs = [];
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: fake.portListening, gate, port: 3020, timeoutMs: 2000, graceMs: 30, killMs: 200, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), log: (m) => logs.push(m) });
  const old = await controller.start("old", { dir: "/tmp/old" });
  assert.equal(controller.entries.length, 1);
  assert.equal(old.pid, fake.spawned[0].pid);
  assert.ok(old.ready_at);
  const outcome = await controller.stop(old);
  assert.deepEqual(outcome, { stopped: true, portReleased: true });
  assert.ok(logs.some((l) => /ignored SIGTERM: SIGKILL/.test(l)));
  assert.deepEqual(fake.alive(), []);
  const all = await controller.stopAll();
  assert.equal(all.ok, true);
  assert.equal(all.steps.length, 1);
});

test("server controller: start refuses to spawn once the gate is stopping; a foreign listener on the port refuses too", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner();
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: fake.portListening, gate, port: 3020, timeoutMs: 500, sleep: () => Promise.resolve() });
  gate.stop("signal:SIGINT");
  await assert.rejects(controller.start("new", { dir: "/tmp/new" }), StopRequestedError);
  assert.equal(fake.spawned.length, 0, "nothing spawned after the stop signal");
  const gate2 = createStopGate();
  const controller2 = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: async () => true, gate: gate2, port: 3020, timeoutMs: 500, sleep: () => Promise.resolve() });
  await assert.rejects(controller2.start("old", { dir: "/tmp/old" }), /bound by a process the runner does not own/);
  assert.equal(fake.spawned.length, 0);
});

test("server controller: a stop signal during the readiness wait stops the just-spawned child (no orphan) and aborts the start", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner({ exitDelayMs: 2 });
  let probes = 0;
  const controller = createServerController({ spawn: fake.spawn, probe: async () => { probes++; if (probes === 2) gate.stop("signal:SIGINT"); return false; }, portListening: fake.portListening, gate, port: 3020, timeoutMs: 5000, graceMs: 50, killMs: 50, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  await assert.rejects(controller.start("new", { dir: "/tmp/new" }), StopRequestedError);
  assert.equal(fake.spawned.length, 1, "the child had been spawned before the signal");
  assert.deepEqual(fake.alive(), [], "the pending start left no orphan");
  assert.equal(controller.entries[0].proven_stopped, true);
});

test("SIGINT while the OLD server is being stopped: no NEW spawn, no orphan, one finalize, exit 130 (fake process + fake spawner)", async () => {
  const proc = new EventEmitter();
  const gate = createStopGate();
  const fake = fakeSpawner({ exitDelayMs: 20 });
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: fake.portListening, gate, port: 3020, timeoutMs: 2000, graceMs: 500, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  let cleanups = 0;
  let cleanupResult = null;
  const lc = createLifecycle({
    gate,
    drainTimeoutMs: 1000,
    cleanup: async () => {
      cleanups++;
      cleanupResult = await controller.stopAll();
      return cleanupResult;
    },
    writeResults: async () => {},
  });
  const exits = [];
  const exited = new Promise((resolve) => {
    lc.installSignalHandlers(proc, { exit: (code) => { exits.push(code); resolve(code); } });
  });
  const old = await controller.start("old", { dir: "/tmp/old" });
  // The switch: stop old … SIGINT lands while the old child has not exited yet … then try to start new.
  const stopping = controller.stop(old);
  proc.emit("SIGINT");
  assert.equal(gate.stopping, true, "the signal raised the gate synchronously");
  await stopping;
  let newStart = null;
  try {
    await controller.start("new", { dir: "/tmp/new" });
  } catch (error) {
    newStart = error;
  }
  assert.ok(newStart instanceof StopRequestedError, `start(new) must be refused, got ${newStart}`);
  assert.equal(fake.spawned.length, 1, "no NEW server spawned after the signal");
  assert.equal(await exited, 130);
  assert.deepEqual(exits, [130], "exactly one exit");
  assert.equal(cleanups, 1, "finalize ran once");
  assert.equal(cleanupResult.ok, true, "registry drained: every child exited and the port is released");
  assert.deepEqual(fake.alive(), [], "no orphan child");
  assert.equal(await fake.portListening(), false);
  // A second finalize (the main flow's `finally`) joins the same one: still one cleanup.
  await lc.finalize("completed");
  assert.equal(cleanups, 1);
});

test("REV-001: SIGINT while the port probe is SUSPENDED before spawn → zero late spawn, one cleanup, exit 130", async () => {
  const proc = new EventEmitter();
  const gate = createStopGate();
  const fake = fakeSpawner({ exitDelayMs: 5 });
  let releasePort;
  const held = new Promise((resolve) => (releasePort = resolve));
  let portCalls = 0;
  const portListening = async () => {
    portCalls++;
    if (portCalls === 1) await held; // the pre-spawn probe hangs while the signal lands
    return fake.listening.size > 0;
  };
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening, gate, port: 3020, timeoutMs: 2000, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  let cleanups = 0;
  const lc = createLifecycle({ gate, drainTimeoutMs: 1000, cleanup: async () => { cleanups++; return controller.stopAll(); }, writeResults: async () => {} });
  const exits = [];
  const exited = new Promise((resolve) => lc.installSignalHandlers(proc, { exit: (code) => { exits.push(code); resolve(code); } }));
  const starting = controller.start("new", { dir: "/tmp/new" });
  await new Promise((r) => setImmediate(r)); // start() is now suspended inside portListening
  proc.emit("SIGINT");
  releasePort(); // the probe resolves AFTER the signal
  await assert.rejects(starting, StopRequestedError);
  assert.equal(fake.spawned.length, 0, "no spawn after the signal, even though the pre-spawn probe resolved later");
  assert.equal(await exited, 130);
  assert.deepEqual(exits, [130]);
  assert.equal(cleanups, 1);
  assert.deepEqual(fake.alive(), []);
});

test("REV-001: SIGINT while the READINESS probe is suspended after spawn → the spawned child is stopped, no orphan, start aborted", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner({ exitDelayMs: 5 });
  let releaseProbe;
  const held = new Promise((resolve) => (releaseProbe = resolve));
  const controller = createServerController({ spawn: fake.spawn, probe: async () => { await held; return true; }, portListening: fake.portListening, gate, port: 3020, timeoutMs: 2000, graceMs: 50, killMs: 50, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  const starting = controller.start("new", { dir: "/tmp/new" });
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.spawned.length, 1, "spawned before the signal");
  gate.stop("signal:SIGINT");
  releaseProbe(); // readiness would have been reported ready — but the gate is re-checked after the await
  await assert.rejects(starting, StopRequestedError);
  assert.deepEqual(fake.alive(), [], "the just-spawned child was stopped before any success");
  assert.equal(controller.entries[0].proven_stopped, true);
  assert.equal(controller.entries[0].ready_at, null, "never reported ready");
});

test("REV-003: a pageerror is ALWAYS a FAIL (offline phase included); only attributable offline network failures are expected", () => {
  const origin = "http://localhost:3020";
  const offline = { ...EXPECTED_OFFLINE, origin };
  const netFail = { phase: "offline", kind: "console", type: "error", url: `${origin}/`, text: "Failed to load resource: net::ERR_INTERNET_DISCONNECTED" };
  assert.equal(isExpectedOfflineRecord(netFail, offline), true);
  assert.equal(isExpectedOfflineRecord({ ...netFail, kind: "pageerror" }, offline), false, "pageerror never expected");
  assert.equal(isExpectedOfflineRecord({ ...netFail, phase: "online" }, offline), false);
  assert.equal(isExpectedOfflineRecord({ ...netFail, text: "Uncaught TypeError: x is not a function" }, offline), false, "app error text");
  assert.equal(isExpectedOfflineRecord({ ...netFail, url: "https://evil.invalid/x.js" }, offline), false, "foreign origin");
  assert.equal(isExpectedOfflineRecord({ ...netFail, url: "" }, offline), false, "no URL = not attributable");
  const split = splitConsoleRecords(
    [netFail, { phase: "offline", kind: "pageerror", text: "TypeError: cannot read properties of undefined" }, { phase: "offline", kind: "console", type: "error", url: `${origin}/_next/static/x.js`, text: "Failed to load resource: net::ERR_INTERNET_DISCONNECTED" }, { phase: "offline", kind: "console", type: "error", url: `${origin}/`, text: "Refused to execute inline script" }],
    EXPECTED_PROBE,
    offline,
  );
  assert.equal(split.offlineExpected.length, 2);
  assert.deepEqual(split.failing.map((r) => r.text), ["TypeError: cannot read properties of undefined", "Refused to execute inline script"]);
  // Without an origin rule, a pageerror in the offline phase still fails.
  assert.equal(splitConsoleRecords([{ phase: "offline", kind: "pageerror", text: "TypeError" }]).failing.length, 1);
});

test("REV-004: stopAll with an already-exited OLD child and an active NEW child stops new, reads the port back ONCE at the end, ok=true", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner({ exitDelayMs: 5 });
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: fake.portListening, gate, port: 3020, timeoutMs: 2000, graceMs: 100, killMs: 100, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  const old = await controller.start("old", { dir: "/tmp/old" });
  await controller.stop(old); // the switch: old exited and port read back while no other child existed
  assert.equal(old.proven_stopped, true);
  const fresh = await controller.start("new", { dir: "/tmp/new" });
  assert.deepEqual(fake.alive(), [fresh.pid], "new child active, old exited");
  const result = await controller.stopAll();
  assert.equal(result.ok, true, `old exited earlier must not be blamed for the port held by new: ${JSON.stringify(result)}`);
  assert.equal(result.port_released, true);
  assert.deepEqual(result.steps.map((s) => [s.label, s.exited, s.stopped]), [["old", true, true], ["new", true, true]]);
  assert.deepEqual(fake.alive(), []);
  assert.equal(old.proven_stopped, true);
  assert.equal(fresh.proven_stopped, true);
});

test("REV-004: NEW child refusing SIGTERM → SIGKILL → ok only when the port is released; a child that never exits keeps ok=false", async () => {
  const gate = createStopGate();
  const fake = fakeSpawner({ ignoreSigterm: true, exitDelayMs: 5 });
  const logs = [];
  const controller = createServerController({ spawn: fake.spawn, probe: async () => true, portListening: fake.portListening, gate, port: 3020, timeoutMs: 2000, graceMs: 30, killMs: 100, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), log: (m) => logs.push(m) });
  const old = await controller.start("old", { dir: "/tmp/old" });
  await controller.stop(old);
  await controller.start("new", { dir: "/tmp/new" });
  const result = await controller.stopAll();
  assert.ok(logs.some((l) => /new server pid \d+ ignored SIGTERM: SIGKILL/.test(l)));
  assert.equal(result.ok, true);
  assert.equal(result.port_released, true);
  assert.deepEqual(fake.alive(), []);
  // Negative: a child that ignores SIGKILL too never exits and keeps the port: never ok.
  const stuck = fakeSpawner({ ignoreSigterm: true, ignoreSigkill: true });
  const controller2 = createServerController({ spawn: stuck.spawn, probe: async () => true, portListening: stuck.portListening, gate: createStopGate(), port: 3020, timeoutMs: 2000, graceMs: 20, killMs: 20, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))) });
  await controller2.start("new", { dir: "/tmp/new" });
  const bad = await controller2.stopAll();
  assert.equal(bad.ok, false);
  assert.equal(bad.port_released, false);
  assert.deepEqual(bad.steps.map((s) => [s.label, s.exited, s.stopped]), [["new", false, false]]);
});

test("phase 10 classifier: the public landing after the online reload is a PASS; the offline heading is a FAIL; no demo textbox required", () => {
  const landing = { status: 200, contentType: "text/html; charset=utf-8", title: "Dépannage électrique", bodyText: "Dépannage électrique\nDépannage électrique\nConnectez-vous pour accéder à vos dossiers", offlineHeadingCount: 0 };
  assert.deepEqual(classifyOnlineRecovery(landing), { ok: true, reasons: [] });
  assert.equal(classifyOnlineRecovery({ ...landing, bodyText: "Dépannage électrique\nSe connecter" }).ok, true, "either sign-in wording");
  const offline = classifyOnlineRecovery({ ...landing, offlineHeadingCount: 1, bodyText: "Dépannage électrique\nLa connexion est indisponible\nRéessayer" });
  assert.equal(offline.ok, false);
  assert.ok(offline.reasons.some((r) => /offline heading/.test(r)) && offline.reasons.some((r) => /markers .* absent/.test(r)));
  assert.equal(classifyOnlineRecovery({ ...landing, status: 503 }).ok, false);
  assert.equal(classifyOnlineRecovery({ ...landing, contentType: "text/plain" }).ok, false);
  assert.equal(classifyOnlineRecovery({ ...landing, title: "Untitled" }).ok, false);
  assert.equal(classifyOnlineRecovery({ ...landing, bodyText: "Courant" }).ok, false, "a landing without the sign-in call to action is not valid");
  // The demo form is not part of the recovery verdict: a landing body with no "Décrivez le problème" passes.
  assert.ok(!JSON.stringify(classifyOnlineRecovery(landing)).includes("Décrivez"));
});

test("demo re-open is a REAL document load: about:blank then the full demo URL — never a same-document hash goto", () => {
  const origin = "http://localhost:3020";
  const plan = demoReopenPlan(origin);
  assert.deepEqual(plan, ["about:blank", "http://localhost:3020/#demo/client-new"]);
  assert.equal(isRealDocumentReopen(plan, origin), true);
  assert.equal(isRealDocumentReopen(["http://localhost:3020/", "http://localhost:3020/#demo/client-new"], origin), false, "/ then /#demo is a same-document hash navigation: the app never enters demo mode");
  assert.equal(isRealDocumentReopen(["http://localhost:3020/#demo/client-new"], origin), false, "no about:blank first");
  assert.equal(isRealDocumentReopen(["about:blank", "http://localhost:3020/#new"], origin), false, "wrong hash");
  assert.equal(isRealDocumentReopen(["about:blank", "http://localhost:3017/#demo/client-new"], origin), false, "wrong origin");
  assert.equal(isRealDocumentReopen(["about:blank", "http://localhost:3020/?x=1#demo/client-new"], origin), false, "no query");
  assert.equal(isRealDocumentReopen("about:blank", origin), false);
});

test("servedBuildIdMarkers: the served HTML names exactly the build it comes from", () => {
  const html = '<html><script>self.__next_f.push([1,"{\\"b\\":\\"gxwpcv_wvIETqdrwBlpr0\\"}"])</script></html>';
  assert.deepEqual(servedBuildIdMarkers(html, { old: "buQI9W-2n13MJ-V5lpOSI", new: "gxwpcv_wvIETqdrwBlpr0" }), { old: false, new: true });
  assert.deepEqual(servedBuildIdMarkers("", { old: "buQI9W-2n13MJ-V5lpOSI" }), { old: false });
  assert.deepEqual(servedBuildIdMarkers("short", { x: "short" }), { x: false }, "ids shorter than 8 chars are never accepted as markers");
});

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
  const split = splitConsoleRecords(records, EXPECTED_PROBE, { ...EXPECTED_OFFLINE, origin: "http://localhost:3020" });
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
