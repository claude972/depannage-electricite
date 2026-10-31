#!/usr/bin/env node
// QA-PWA-LIFECYCLE-002 — two real Next builds (SW v2 then v3) served successively on the SAME local
// origin by runner-owned child servers; two Chromium tabs prove the service-worker update lifecycle.
// Contract: docs/CLAUDE_PWA_LIFECYCLE_CONTRACT.md. Reuses scripts/qa/lib/* read-only.
// Never builds, never installs, never uses an account, never calls the cloud.
import { mkdir, readFile, writeFile, stat, realpath, chmod, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parseArgs, HELP, extractSwVersion, scanEnvKeyNames, classifyCacheEntries, compareStageEvidence, childEnv, buildServerArgs, readinessUrls, exitCodeFor, splitConsoleRecords, SW_PATH, OFFLINE_PATH, DEMO_HASH } from "./qa-pwa-lifecycle/lib.mjs";
import { createRedactor } from "./qa/lib/redact.mjs";
import { assertOutOutsideRepo, PreflightError } from "./qa/lib/config.mjs";
import { createLifecycle, createStopGate } from "./qa/lib/lifecycle.mjs";
import { loadPlaywright, launchBrowser, configureBrowser, noHorizontalOverflow } from "./qa/lib/browser.mjs";

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const FORM_LABEL = "Décrivez le problème";
const UPDATE_BUTTON = "Recharger maintenant";
const UPDATE_TEXT = "Une nouvelle version est disponible. Enregistrez vos saisies avant de recharger.";
const OFFLINE_TITLE = "La connexion est indisponible";
const OFFLINE_TEXT = "Aucun dossier personnel n’est enregistré dans le cache hors connexion.";
const QA_TEXTS = ["Saisie QA onglet A, jamais envoyée : coupure dans la cuisine depuis ce matin.", "Saisie QA onglet B, jamais envoyée : prise qui chauffe dans le couloir."];

/** True when something accepts TCP connections on 127.0.0.1:port. */
function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1500, () => done(false));
  });
}

async function inspectBuild(label, dir, expectedSha) {
  const absolute = await realpath(dir).catch(() => {
    throw new PreflightError(`--${label}-dir ${dir} does not exist`);
  });
  for (const rel of [".next/BUILD_ID", "public/sw.js", "public/offline.html", "node_modules/next/dist/bin/next"]) {
    const ok = await stat(path.join(absolute, rel)).then((s) => s.isFile()).catch(() => false);
    if (!ok) throw new PreflightError(`--${label}-dir ${absolute}: ${rel} missing (prebuilt checkout required; the runner never builds)`);
  }
  const { stdout } = await execFileAsync("git", ["-C", absolute, "rev-parse", "HEAD"]).catch(() => ({ stdout: "" }));
  const head = stdout.trim();
  if (head !== expectedSha) throw new PreflightError(`--${label}-dir HEAD ${head || "(not a git checkout)"} differs from --${label}-sha ${expectedSha}`);
  const buildId = (await readFile(path.join(absolute, ".next/BUILD_ID"), "utf8")).trim();
  const swBuffer = await readFile(path.join(absolute, "public/sw.js"));
  const sw = extractSwVersion(swBuffer.toString("utf8"));
  if (!sw) throw new PreflightError(`--${label}-dir public/sw.js: PUBLIC_CACHE_PREFIX/vN pattern not found`);
  const envFile = path.join(absolute, ".env.local");
  let envNames = [];
  if (await stat(envFile).then((s) => s.isFile()).catch(() => false)) {
    const scan = scanEnvKeyNames(await readFile(envFile, "utf8"));
    envNames = scan.names;
    if (scan.forbidden.length) throw new PreflightError(`--${label}-dir .env.local declares a secret-looking variable (${scan.forbidden.join(", ")}): public env only (values were not read)`);
  }
  return { label, dir: absolute, sha: head, buildId, swSha256: sha256(swBuffer), swVersion: sw.version, swCacheName: sw.cacheName, swPrefix: sw.prefix, envNames };
}

async function preflight(options) {
  const old = await inspectBuild("old", options.oldDir, options.oldSha);
  const next = await inspectBuild("new", options.newDir, options.newSha);
  if (old.dir === next.dir) throw new PreflightError("old and new checkouts resolve to the same directory");
  if (old.swSha256 === next.swSha256) throw new PreflightError("public/sw.js is byte-identical in both builds: no worker update to prove");
  if (old.swPrefix !== next.swPrefix) throw new PreflightError(`cache prefix differs (${old.swPrefix} vs ${next.swPrefix}): activation purge cannot be compared`);
  if (!(old.swVersion < next.swVersion)) throw new PreflightError(`old worker v${old.swVersion} must be strictly lower than new worker v${next.swVersion}`);
  if (old.buildId === next.buildId) throw new PreflightError("both checkouts have the same BUILD_ID");
  if (await portListening(options.port)) throw new PreflightError(`port ${options.port} is already bound by a process the runner does not own; refusing (never reuse a foreign server)`);
  let stage = null;
  if (options.stageEvidence) {
    const evidence = JSON.parse(await readFile(options.stageEvidence, "utf8"));
    const mismatches = compareStageEvidence(evidence, { oldSha: old.sha, newSha: next.sha, oldBuildId: old.buildId, newBuildId: next.buildId, oldSwSha256: old.swSha256, newSwSha256: next.swSha256 });
    if (mismatches.length) throw new PreflightError(`stage evidence mismatch: ${mismatches.join("; ")}`);
    stage = { file: options.stageEvidence, matched: Object.keys(evidence) };
  }
  const outDir = await assertOutOutsideRepo(options.out);
  let playwrightVersion = null;
  try {
    await loadPlaywright(options.playwrightPath);
    playwrightVersion = JSON.parse(await readFile(path.join(path.resolve(options.playwrightPath), "package.json"), "utf8")).version;
  } catch (error) {
    throw new PreflightError(error.message);
  }
  return { old, next, outDir, stage, playwrightVersion };
}

async function main(argv) {
  const { options, errors } = parseArgs(argv, process.env);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (errors.length) {
    for (const e of errors) process.stderr.write(`error: ${e}\n`);
    process.stderr.write(`\n${HELP}`);
    return 2;
  }
  const redactor = createRedactor();
  const log = (...parts) => process.stdout.write(`[qa-pwa] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);
  let pre;
  try {
    pre = await preflight(options);
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    throw error;
  }
  const origin = `http://localhost:${options.port}`;
  const context = {
    mission: "QA-PWA-LIFECYCLE-002",
    origin,
    port: options.port,
    headless: options.headless,
    timeout_ms: options.timeoutMs,
    playwright: pre.playwrightVersion,
    stage_evidence: pre.stage,
    old: { dir: pre.old.dir, sha: pre.old.sha, build_id: pre.old.buildId, sw_sha256: pre.old.swSha256, sw_cache: pre.old.swCacheName, env_names: pre.old.envNames },
    new: { dir: pre.next.dir, sha: pre.next.sha, build_id: pre.next.buildId, sw_sha256: pre.next.swSha256, sw_cache: pre.next.swCacheName, env_names: pre.next.envNames },
    out: pre.outDir,
    not_proven: ["two LOCAL builds served successively, not two deployed Vercel previews", "no OS-level installation (Chrome install, iOS/Android home screen)", "no push, background sync, offline queue (absent by design)", "no payment flow", "no user account, no Auth cohort, no cloud call required by the scenario"],
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  if (options.dryRun) {
    process.stdout.write(JSON.stringify({ mode: "dry-run (no server started, no browser launched)", ...context, steps: 13, exit_codes: { 0: "all PASS, child servers stopped", 1: "FAIL or FATAL", 2: "preflight refusal", 3: "a child server did not stop" } }, null, 2) + "\n");
    return 0;
  }

  // ---- Real run -------------------------------------------------------------------------
  const outDir = pre.outDir;
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  configureBrowser({ timeoutMs: options.timeoutMs });
  const result = { context, steps: [], versions: { old: null, new: null }, servers: [], console: { a: [], b: [] }, fatal: null };
  const persist = async () => {
    const data = redactor.redact(result);
    await writeFile(path.join(outDir, "result.json"), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await writeFile(path.join(outDir, "summary.md"), renderSummary(data), { mode: 0o600 });
  };
  const servers = [];
  let browser = null;
  let blocked = null;
  const step = async (name, fn, { critical = true } = {}) => {
    const started = Date.now();
    if (blocked) {
      result.steps.push({ name, status: "SKIPPED", detail: `blocked by failed step: ${blocked}`, duration_ms: 0 });
      log(`SKIPPED ${name} (blocked by: ${blocked})`);
      await persist();
      return;
    }
    try {
      const detail = await fn();
      result.steps.push({ name, status: "PASS", detail: detail ?? null, duration_ms: Date.now() - started });
      log(`PASS    ${name}`);
    } catch (error) {
      const info = redactor.redactError(error);
      result.steps.push({ name, status: "FAIL", detail: { error: info.message, stack: info.stack?.split("\n").slice(0, 6).join("\n") }, duration_ms: Date.now() - started });
      log(`FAIL    ${name}: ${info.message}`);
      if (critical) blocked = name;
    }
    await persist();
  };

  // ---- Child servers --------------------------------------------------------------------
  async function startServer(label, build) {
    const logFile = path.join(outDir, `server-${label}.log`);
    await writeFile(logFile, "", { mode: 0o600 });
    const args = buildServerArgs(build.dir, options.port);
    const child = spawn(process.execPath, args, { cwd: build.dir, env: childEnv(process.env, { port: options.port }), stdio: ["ignore", "pipe", "pipe"] });
    const entry = { label, pid: child.pid, dir: build.dir, started_at: new Date().toISOString(), ready_at: null, stopped_at: null, exit: null, stopped: false, child };
    servers.push(entry);
    result.servers.push({ label, pid: child.pid, started_at: entry.started_at, ready_at: null, stopped_at: null, exit: null, stopped: false });
    const tee = (stream, tag) => stream.on("data", (chunk) => appendFile(logFile, `${new Date().toISOString()} ${tag} ${redactor.redactString(chunk.toString("utf8"))}`).catch(() => {}));
    tee(child.stdout, "out");
    tee(child.stderr, "err");
    child.once("exit", (code, signal) => {
      entry.exit = { code, signal };
      entry.stopped = true;
      entry.stopped_at = new Date().toISOString();
      Object.assign(result.servers.find((s) => s.pid === child.pid), { exit: entry.exit, stopped: true, stopped_at: entry.stopped_at });
    });
    const deadline = Date.now() + options.timeoutMs;
    const urls = readinessUrls(origin);
    while (Date.now() < deadline) {
      if (entry.stopped) throw new Error(`${label} server exited before becoming ready (${JSON.stringify(entry.exit)}); see server-${label}.log`);
      let ready = true;
      for (const url of urls) {
        const ok = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) }).then((r) => r.status === 200).catch(() => false);
        if (!ok) ready = false;
      }
      if (ready) {
        entry.ready_at = new Date().toISOString();
        result.servers.find((s) => s.pid === child.pid).ready_at = entry.ready_at;
        return entry;
      }
      await sleep(300);
    }
    throw new Error(`${label} server not ready within ${options.timeoutMs} ms on ${origin}`);
  }
  async function stopServer(entry) {
    if (!entry || entry.stopped) return entry?.stopped ?? true;
    const exited = new Promise((resolve) => entry.child.once("exit", () => resolve(true)));
    entry.child.kill("SIGTERM");
    const graceful = await Promise.race([exited, sleep(Math.min(15000, options.timeoutMs)).then(() => false)]);
    if (!graceful) {
      log(`${entry.label} server pid ${entry.pid} ignored SIGTERM: SIGKILL`);
      entry.child.kill("SIGKILL");
      await Promise.race([exited, sleep(5000).then(() => false)]);
    }
    for (let i = 0; i < 20 && (await portListening(options.port)); i++) await sleep(250);
    const stillListening = await portListening(options.port);
    const stopped = entry.stopped && !stillListening;
    Object.assign(result.servers.find((s) => s.pid === entry.pid), { stopped, port_released: !stillListening });
    return stopped;
  }
  async function stopAllServers() {
    const states = [];
    for (const entry of servers) states.push({ label: entry.label, pid: entry.pid, stopped: await stopServer(entry) });
    return { ok: states.every((s) => s.stopped), steps: states };
  }

  // ---- Lifecycle (signals, crashes, single finalisation) ----------------------------------
  const gate = createStopGate();
  let cleanupState = null;
  const lifecycle = createLifecycle({
    gate,
    log,
    drainTimeoutMs: options.timeoutMs,
    cleanup: async () => {
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
      cleanupState = await stopAllServers();
      return cleanupState;
    },
    writeResults: async ({ fatal, reason }) => {
      if (fatal) result.fatal = { origin: fatal.origin, error: redactor.redactError(fatal.error) };
      context.finished_at = new Date().toISOString();
      context.finish_reason = reason;
      context.servers_stopped = cleanupState ? cleanupState.ok : null;
      await persist();
    },
  });
  const codeFor = () => exitCodeFor({ steps: result.steps, fatal: result.fatal, serversStopped: cleanupState ? cleanupState.ok : false });
  const uninstallCrash = lifecycle.installCrashHandlers(process, {
    onFatal: (error, origin) => {
      const info = redactor.redactError(error);
      process.stderr.write(`[qa-pwa] FATAL (${origin}): ${info.name}: ${info.message}\n`);
    },
    codeFor: () => {
      const code = codeFor();
      log(`aborted after FATAL; servers ${cleanupState?.ok ? "stopped" : "NOT proven stopped"}; exit ${code}`);
      return code;
    },
    exit: (code) => process.exit(code),
  });
  const uninstallSignals = lifecycle.installSignalHandlers(process, {
    onSignal: (signal) => process.stderr.write(`[qa-pwa] ${signal}: closing the browser and stopping the child servers\n`),
    onSecondSignal: (signal) => process.stderr.write(`[qa-pwa] second ${signal}: giving up; check for an orphan on port ${options.port}\n`),
    codeFor: (signal) => {
      const code = cleanupState && !cleanupState.ok ? 3 : 130;
      log(`aborted by ${signal}; exit ${code}`);
      return code;
    },
    exit: (code) => process.exit(code),
  });

  // ---- Browser helpers ---------------------------------------------------------------------
  const tabs = {};
  let phase = "online";
  const consoleRecords = { a: [], b: [] };
  const attachConsole = (page, key) => {
    page.on("pageerror", (error) => consoleRecords[key].push({ at: new Date().toISOString(), phase, kind: "pageerror", text: redactor.redactString(error.message) }));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        const location = message.location?.() || {};
        consoleRecords[key].push({ at: new Date().toISOString(), phase, kind: "console", type: message.type(), url: redactor.redactString(String(location.url || "")), text: redactor.redactString(message.text()).slice(0, 300) });
      }
    });
  };
  const demoUrl = `${origin}/#${DEMO_HASH}`;
  const swState = (page) =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const controller = navigator.serviceWorker.controller;
      return {
        controllerScript: controller ? new URL(controller.scriptURL).pathname : null,
        controllerState: controller?.state ?? null,
        controllerSameAsInitial: controller !== null && controller === window.__qaController,
        waiting: registration?.waiting?.state ?? null,
        installing: registration?.installing?.state ?? null,
        active: registration?.active?.state ?? null,
        scope: registration ? new URL(registration.scope).pathname : null,
        marker: window.__qaDocumentMarker ?? null,
      };
    });
  const cacheSnapshot = (page) =>
    page.evaluate(async () => {
      const keys = await caches.keys();
      const entries = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) entries.push({ cache: key, path: new URL(request.url).pathname + new URL(request.url).search });
      }
      return { keys, entries };
    });
  const servedWorker = (page) =>
    page.evaluate(async () => {
      const response = await fetch("/sw.js", { cache: "no-store" });
      const text = await response.text();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return { status: response.status, sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), version: /\$\{PUBLIC_CACHE_PREFIX\}v(\d+)`/.exec(text)?.[1] ?? null };
    });
  const openDemo = async (page, qaText, marker) => {
    await page.goto(demoUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    const field = page.getByRole("textbox", { name: FORM_LABEL });
    await field.first().waitFor({ state: "visible", timeout: options.timeoutMs });
    await field.first().fill(qaText);
    await page.evaluate(
      ({ marker }) => {
        window.__qaDocumentMarker = marker;
      },
      { marker },
    );
  };
  const waitControlled = async (page) => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: options.timeoutMs });
    await page.evaluate(() => {
      window.__qaController = navigator.serviceWorker.controller;
    });
  };
  const screenshot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => null);
  const fieldValue = (page) => page.getByRole("textbox", { name: FORM_LABEL }).first().inputValue();
  // ONE deliberate anonymous probe per step: GET /api/workspace, expected 401 (contract §4 steps 4/11).
  // Chromium logs exactly one "Failed to load resource … 401" line for it; the console classifier
  // accepts that single line by URL + status and nothing else. /auth/* non-interception is proven by
  // the worker unit tests and by the Cache Storage listing, not by a browser probe.
  const probePrivate = async (page, label) => {
    phase = label;
    try {
      const probe = await page.evaluate(async () => {
        const r = await fetch("/api/workspace", { cache: "no-store", redirect: "manual" });
        return { path: "/api/workspace", status: r.status, cacheControl: r.headers.get("cache-control") };
      });
      assert.equal(probe.status, 401, `anonymous /api/workspace answered ${probe.status}, expected 401`);
      await sleep(300); // let the console line land before the phase changes
      return probe;
    } finally {
      phase = "online";
    }
  };
  const headersOf = async (url) => {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs) });
    const body = await r.text();
    return { status: r.status, contentType: r.headers.get("content-type"), cacheControl: r.headers.get("cache-control"), offlineMarker: r.headers.get("x-courant-public-offline"), swAllowed: r.headers.get("service-worker-allowed"), body };
  };

  log(`run → ${outDir}`);
  log(`old ${pre.old.sha.slice(0, 12)} build ${pre.old.buildId} worker ${pre.old.swCacheName}; new ${pre.next.sha.slice(0, 12)} build ${pre.next.buildId} worker ${pre.next.swCacheName}; origin ${origin}`);
  await persist();
  let oldServer = null;
  let newServer = null;
  try {
    await step("1 old server ready: /, /sw.js (v2, hash = disk), /offline.html marker, manifest", async () => {
      oldServer = await startServer("old", pre.old);
      const sw = await headersOf(`${origin}${SW_PATH}`);
      assert.equal(sw.status, 200);
      assert.match(sw.contentType || "", /javascript/, "sw.js content-type");
      assert.match(sw.cacheControl || "", /no-store|no-cache/, "sw.js cache-control");
      assert.equal(sha256(Buffer.from(sw.body, "utf8")), pre.old.swSha256, "served sw.js differs from the old build on disk");
      assert.equal(extractSwVersion(sw.body)?.version, pre.old.swVersion);
      const offline = await headersOf(`${origin}${OFFLINE_PATH}`);
      assert.equal(offline.status, 200);
      assert.equal(offline.offlineMarker, "1", "X-Courant-Public-Offline header on /offline.html");
      assert.match(offline.body, new RegExp(OFFLINE_TITLE));
      const manifest = await headersOf(`${origin}/manifest.webmanifest`);
      assert.equal(manifest.status, 200);
      const parsed = JSON.parse(manifest.body);
      assert.equal(parsed.display, "standalone");
      assert.equal(parsed.scope, "/");
      result.versions.old = { served_sw_sha256: pre.old.swSha256, sw_version: pre.old.swVersion, build_id: pre.old.buildId, pid: oldServer.pid };
      return { pid: oldServer.pid, sw: { contentType: sw.contentType, cacheControl: sw.cacheControl, swAllowed: sw.swAllowed }, offline: { marker: offline.offlineMarker, cacheControl: offline.cacheControl }, manifest: { name: parsed.name, display: parsed.display } };
    });

    await step("2 worker v2 really installed and activated in two tabs (controller without reload, cache = /offline.html only)", async () => {
      const pw = await loadPlaywright(options.playwrightPath);
      browser = await launchBrowser(pw, { headless: options.headless, chromiumPath: options.chromiumPath });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR", serviceWorkers: "allow" });
      ctx.setDefaultTimeout(options.timeoutMs);
      tabs.a = await ctx.newPage();
      tabs.b = await ctx.newPage();
      attachConsole(tabs.a, "a");
      attachConsole(tabs.b, "b");
      await openDemo(tabs.a, QA_TEXTS[0], "initial-v2-document-A");
      await waitControlled(tabs.a);
      await openDemo(tabs.b, QA_TEXTS[1], "initial-v2-document-B");
      await waitControlled(tabs.b);
      const states = { a: await swState(tabs.a), b: await swState(tabs.b) };
      for (const [k, s] of Object.entries(states)) {
        assert.equal(s.controllerScript, SW_PATH, `tab ${k} controller script`);
        assert.equal(s.controllerState, "activated", `tab ${k} controller state`);
        assert.equal(s.scope, "/", `tab ${k} scope`);
        assert.equal(s.waiting, null, `tab ${k} has a waiting worker before any update`);
      }
      const served = await servedWorker(tabs.a);
      assert.equal(served.sha256, pre.old.swSha256, "worker served to the page is not the old build's");
      const snapshot = await cacheSnapshot(tabs.a);
      assert.ok(snapshot.keys.includes(pre.old.swCacheName), `cache ${pre.old.swCacheName} absent: ${JSON.stringify(snapshot.keys)}`);
      const own = snapshot.entries.filter((e) => e.cache === pre.old.swCacheName).map((e) => e.path);
      assert.deepEqual(own, [OFFLINE_PATH], `own cache entries: ${JSON.stringify(own)}`);
      result.versions.old.cache_keys = snapshot.keys;
      result.versions.old.cache_entries = snapshot.entries;
      return { states, served, cache: snapshot };
    });

    await step("3 unsaved input in both tabs (dirty witnesses) + markers", async () => {
      assert.equal(await fieldValue(tabs.a), QA_TEXTS[0]);
      assert.equal(await fieldValue(tabs.b), QA_TEXTS[1]);
      await screenshot(tabs.a, "tab-a-v2");
      await screenshot(tabs.b, "tab-b-v2");
      return { a: (await swState(tabs.a)).marker, b: (await swState(tabs.b)).marker };
    });

    await step("4 nothing private cached on v2 after the single anonymous /api/workspace probe (401)", async () => {
      const probes = await probePrivate(tabs.a, "probe-v2");
      const snapshot = await cacheSnapshot(tabs.a);
      const verdict = classifyCacheEntries(snapshot.entries, pre.old.swPrefix);
      assert.ok(verdict.ok, `private or unexpected cache entries: ${JSON.stringify({ privateEntries: verdict.privateEntries, unexpected: verdict.unexpected })}`);
      assert.equal(await fieldValue(tabs.a), QA_TEXTS[0], "probe changed tab A input");
      return { probes, keys: snapshot.keys, entries: snapshot.entries };
    }, { critical: false });

    await step("5 switch on the same origin: old server stopped (pid exited, port released), new server ready, /sw.js = v3", async () => {
      const stopped = await stopServer(oldServer);
      assert.ok(stopped, `old server pid ${oldServer.pid} not proven stopped`);
      newServer = await startServer("new", pre.next);
      const sw = await headersOf(`${origin}${SW_PATH}`);
      assert.equal(sw.status, 200);
      assert.equal(sha256(Buffer.from(sw.body, "utf8")), pre.next.swSha256, "served sw.js differs from the new build on disk");
      assert.equal(extractSwVersion(sw.body)?.version, pre.next.swVersion);
      assert.notEqual(pre.next.buildId, pre.old.buildId);
      const states = { a: await swState(tabs.a), b: await swState(tabs.b) };
      for (const [k, s] of Object.entries(states)) assert.equal(s.controllerSameAsInitial, true, `tab ${k} controller changed by the server switch alone`);
      result.versions.new = { served_sw_sha256: pre.next.swSha256, sw_version: pre.next.swVersion, build_id: pre.next.buildId, pid: newServer.pid };
      return { oldPid: oldServer.pid, oldExit: oldServer.exit, newPid: newServer.pid, states };
    });

    await step("6 new worker WAITING in both tabs without consent: notice + button, no reload, inputs intact", async () => {
      await tabs.a.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
      });
      for (const [k, page] of Object.entries(tabs)) {
        await page.getByRole("button", { name: UPDATE_BUTTON, exact: true }).waitFor({ state: "visible", timeout: options.timeoutMs });
        await page.getByText(UPDATE_TEXT, { exact: false }).first().waitFor({ state: "visible", timeout: options.timeoutMs });
      }
      await sleep(3000); // give any automatic reload the chance to betray itself
      const states = { a: await swState(tabs.a), b: await swState(tabs.b) };
      for (const [k, s] of Object.entries(states)) {
        assert.equal(s.waiting, "installed", `tab ${k} waiting worker state`);
        assert.equal(s.controllerSameAsInitial, true, `tab ${k} controller replaced without consent`);
        assert.equal(s.marker, `initial-v2-document-${k.toUpperCase()}`, `tab ${k} document was reloaded`);
      }
      assert.equal(await fieldValue(tabs.a), QA_TEXTS[0], "tab A input lost");
      assert.equal(await fieldValue(tabs.b), QA_TEXTS[1], "tab B input lost");
      await screenshot(tabs.a, "tab-a-waiting");
      await screenshot(tabs.b, "tab-b-waiting");
      return { states };
    });

    await step("7 explicit consent in tab A only: A reloads on v3, dirty tab B keeps its input and is not reloaded", async () => {
      const loaded = tabs.a.waitForEvent("load", { timeout: options.timeoutMs });
      await tabs.a.getByRole("button", { name: UPDATE_BUTTON, exact: true }).click();
      await loaded;
      await tabs.a.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: options.timeoutMs });
      await sleep(1500);
      const a = await swState(tabs.a);
      assert.equal(a.marker, null, "tab A did not reload after consent");
      assert.equal(a.controllerSameAsInitial, false, "tab A still controlled by the old worker");
      const servedA = await servedWorker(tabs.a);
      assert.equal(servedA.version, String(pre.next.swVersion));
      const b = await swState(tabs.b);
      assert.equal(b.marker, "initial-v2-document-B", "tab B was reloaded without consent");
      assert.equal(await fieldValue(tabs.b), QA_TEXTS[1], "tab B input lost");
      await tabs.b.waitForFunction(() => navigator.serviceWorker.controller !== window.__qaController, undefined, { timeout: options.timeoutMs });
      const bButton = await tabs.b.getByRole("button", { name: UPDATE_BUTTON, exact: true }).count();
      assert.ok(bButton >= 1, "tab B no longer offers the explicit update");
      await screenshot(tabs.b, "tab-b-after-a-update");
      return { a, b: await swState(tabs.b), bButtonVisible: bButton };
    });

    await step("8 caches observed v2 → v3: old own cache purged, third-party cache preserved, v3 = /offline.html only", async () => {
      await tabs.b.evaluate(async () => {
        const cache = await caches.open("qa-other-cache-preserve");
        await cache.put("/qa-public-marker", new Response("Public QA cache fixture only"));
      });
      const snapshot = await cacheSnapshot(tabs.b);
      assert.ok(snapshot.keys.includes(pre.next.swCacheName), `new cache ${pre.next.swCacheName} absent: ${JSON.stringify(snapshot.keys)}`);
      assert.ok(!snapshot.keys.includes(pre.old.swCacheName), `old cache ${pre.old.swCacheName} still present`);
      assert.ok(snapshot.keys.includes("qa-other-cache-preserve"), "activation purged a cache it does not own");
      const own = snapshot.entries.filter((e) => e.cache === pre.next.swCacheName).map((e) => e.path);
      assert.deepEqual(own, [OFFLINE_PATH]);
      await tabs.b.evaluate(() => caches.delete("qa-other-cache-preserve"));
      result.versions.new.cache_keys = (await cacheSnapshot(tabs.b)).keys;
      return { keys: snapshot.keys, entries: snapshot.entries };
    });

    await step("9 explicit consent in stale tab B: reloads, not stuck on « Actualisation… », controlled by v3", async () => {
      const loaded = tabs.b.waitForEvent("load", { timeout: options.timeoutMs });
      await tabs.b.getByRole("button", { name: UPDATE_BUTTON, exact: true }).click();
      await loaded;
      await sleep(1000);
      const b = await swState(tabs.b);
      assert.equal(b.marker, null, "tab B did not reload after its explicit consent");
      assert.equal(await tabs.b.getByRole("button", { name: "Actualisation…", exact: true }).count(), 0, "tab B stuck on Actualisation…");
      const served = await servedWorker(tabs.b);
      assert.equal(served.version, String(pre.next.swVersion));
      await screenshot(tabs.b, "tab-b-after-explicit-reload");
      return { b, served };
    });

    await step("10 real offline page served by worker v3, then online recovery", async () => {
      const ctx = tabs.a.context();
      phase = "offline";
      await ctx.setOffline(true);
      await tabs.a.goto(demoUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await tabs.a.getByRole("heading", { name: OFFLINE_TITLE, exact: true }).waitFor({ state: "visible", timeout: options.timeoutMs });
      await tabs.a.getByText(OFFLINE_TEXT, { exact: false }).first().waitFor({ state: "visible" });
      await tabs.a.getByRole("link", { name: "Réessayer", exact: true }).waitFor({ state: "visible" });
      await screenshot(tabs.a, "offline-v3");
      await ctx.setOffline(false);
      phase = "online";
      await tabs.a.goto(demoUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
      await tabs.a.getByRole("textbox", { name: FORM_LABEL }).first().waitFor({ state: "visible", timeout: options.timeoutMs });
      await screenshot(tabs.a, "online-again-v3");
      return { offlineTitle: OFFLINE_TITLE, recovered: true };
    });

    await step("11 nothing private cached on v3 after the single anonymous /api/workspace probe (401)", async () => {
      const probes = await probePrivate(tabs.a, "probe-v3");
      const snapshot = await cacheSnapshot(tabs.a);
      const verdict = classifyCacheEntries(snapshot.entries, pre.next.swPrefix);
      assert.ok(verdict.ok, `private or unexpected cache entries: ${JSON.stringify({ privateEntries: verdict.privateEntries, unexpected: verdict.unexpected })}`);
      assert.deepEqual(snapshot.keys, [pre.next.swCacheName], `unexpected cache keys ${JSON.stringify(snapshot.keys)}`);
      result.versions.new.cache_entries = snapshot.entries;
      return { probes, keys: snapshot.keys, entries: snapshot.entries };
    }, { critical: false });

    await step("12 console: only the single expected probe line (/api/workspace 401) per probe step; no other error; no overflow at 360/1280", async () => {
      const split = { a: splitConsoleRecords(consoleRecords.a), b: splitConsoleRecords(consoleRecords.b) };
      const failing = [...split.a.failing, ...split.b.failing];
      const overflow = {};
      for (const width of [360, 1280]) {
        await tabs.a.setViewportSize({ width, height: 900 });
        await sleep(300);
        overflow[width] = await noHorizontalOverflow(tabs.a, width);
      }
      assert.equal(failing.length, 0, `console errors outside the expected probe line: ${JSON.stringify(failing.slice(0, 5))}`);
      return { probeExpected: [...split.a.probeExpected, ...split.b.probeExpected].map((r) => ({ phase: r.phase, url: r.url, text: r.text })), offlineExpected: split.a.offlineExpected.length + split.b.offlineExpected.length, overflow };
    }, { critical: false });
  } catch (error) {
    result.steps.push({ name: "harness", status: "FAIL", detail: { error: redactor.redactError(error).message } });
    log(`harness error: ${redactor.redactString(error.message)}`);
  } finally {
    result.console = consoleRecords;
    await writeFile(path.join(outDir, "console-a.ndjson"), consoleRecords.a.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 }).catch(() => {});
    await writeFile(path.join(outDir, "console-b.ndjson"), consoleRecords.b.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 }).catch(() => {});
    const { cleanup } = await lifecycle.finalize("completed");
    uninstallCrash();
    uninstallSignals();
    const stoppedAll = cleanup ? cleanup.ok : false;
    result.steps.push({ name: "13 child servers stopped (pids exited, port released)", status: stoppedAll ? "PASS" : "FAIL", detail: cleanup, duration_ms: 0 });
    const code = codeFor();
    context.exit_code = code;
    await persist();
    const summary = { total: result.steps.length, pass: result.steps.filter((s) => s.status === "PASS").length, fail: result.steps.filter((s) => s.status === "FAIL").length, skipped: result.steps.filter((s) => s.status === "SKIPPED").length };
    log(`done: ${JSON.stringify(summary)}; servers ${stoppedAll ? "stopped" : "NOT proven stopped"}; exit ${code}; evidence ${outDir}`);
    if (options.json) process.stdout.write(JSON.stringify({ ...summary, exit: code, out: outDir }) + "\n");
    process.exitCode = code;
  }
  return process.exitCode;
}

function renderSummary(r) {
  const lines = [`# QA-PWA-LIFECYCLE-002 — ${r.context.origin}`, "", `- old build ${r.context.old.sha} (BUILD_ID ${r.context.old.build_id}, worker ${r.context.old.sw_cache}, sw.js sha256 ${r.context.old.sw_sha256})`, `- new build ${r.context.new.sha} (BUILD_ID ${r.context.new.build_id}, worker ${r.context.new.sw_cache}, sw.js sha256 ${r.context.new.sw_sha256})`, `- started ${r.context.started_at}; finished ${r.context.finished_at || "(in progress)"}; exit ${r.context.exit_code ?? "(pending)"}`, `- servers: ${r.servers.map((s) => `${s.label} pid ${s.pid} ${s.stopped ? "stopped" : "RUNNING"}`).join(", ") || "none"}`];
  if (r.fatal) lines.push(`- FATAL: ${r.fatal.origin} — ${r.fatal.error?.message}`);
  lines.push("", "| # | Step | Status |", "| --- | --- | --- |");
  for (const s of r.steps) lines.push(`| ${s.name.split(" ")[0]} | ${s.name.replace(/^\S+\s/, "")} | ${s.status}${s.status === "FAIL" ? ` — ${s.detail?.error || ""}` : ""} |`);
  lines.push("", "Observed, not inferred: cache keys/entries and served worker hashes are in result.json (`versions.old`, `versions.new`).", "", "Not proven by this run:");
  for (const n of r.context.not_proven) lines.push(`- ${n}`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
