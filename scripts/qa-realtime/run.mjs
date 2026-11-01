#!/usr/bin/env node
// WEB-REALTIME-PROBE-001 runner (docs/REALTIME_DIAGNOSTIC_CONTRACT.md §3, §3 bis, §5). Run by ROOT
// only. Order: arguments → preflight (credentials, project, publishable key, exact SDK, auth health;
// refusal ⇒ exit 2 before any mutation) → --out, intents, durable manifest → QA client (intent BEFORE
// createAuthUser) → QA page (app SDK, loopback) + Realtime proxy → login, identity proven → sequential
// measurements → conclusion → guarded B1 cleanup. Persisted: scalars / booleans only (report.json 0600).
// Exit precedence: 3 (cleanup incomplete / unknown) > 2 (BLOCKED / preflight) > 130 > 1 (FATAL) > 0.
import { mkdirSync, chmodSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadCredentials, assertProject, defaultOutDir, assertOutOutsideRepo, PreflightError } from "../qa/lib/config.mjs";
import { createRedactor } from "../qa/lib/redact.mjs";
import { createCohort } from "../qa/lib/cohort.mjs";
import { createLifecycle, createStopGate, fatalExitCode } from "../qa/lib/lifecycle.mjs";
import { createServiceClient } from "../qa/lib/supabase.mjs";
import { Fixtures } from "../qa/lib/fixtures.mjs";
import { loadPlaywright, launchBrowser, stopBrowser } from "../qa/lib/browser.mjs";
import { IntentLog } from "../qa-tracking/lib/intents.mjs";
import { createAuthAdmin } from "../qa-tracking/lib/auth-admin.mjs";
import { makeManifestDurable } from "../qa-tracking/lib/durable.mjs";
import { createGuardedCleanup, exitCodeFor } from "../qa-tracking/lib/finalize.mjs";
import { act } from "../qa-tracking/lib/guard.mjs";
import { TrackingFixtures } from "../qa-tracking/scenarios.mjs";
import { parseArgs, HELP } from "./lib/args.mjs";
import { MEASUREMENTS, JOIN_TIMEOUT_MS, WINDOW_MS } from "./lib/constants.mjs";
import { buildBundle, servePage, sdkVersions } from "./lib/page.mjs";
import { installRealtimeProxy } from "./lib/proxy.mjs";
import { runMeasurement } from "./lib/measure.mjs";
import { conclude } from "./lib/verdict.mjs";
import { realtimeCleanupWithProof, cleanupOnly } from "./lib/cleanup.mjs";

const DISCLAIMER = "Isolated QA page with the app SDK (no UI proof). H1/H2 are observations limited to each measurement, not a general cause; RT product finding stays OPEN.";

/** `deps` (tests only): loadCredentials, sdkVersions, fetch, loadPlaywright, makeDb, makeAuth, buildBundle, launchBrowser, limits, cleanupDeps. */
export async function main(argv, deps = {}) {
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
  let finalCode = null;
  const log = (...parts) => process.stdout.write(`[qa-realtime] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);
  const selected = MEASUREMENTS.filter((m) => options.measurements.includes(m.name));
  try {
    if (options.cleanupManifest) return await cleanupOnly(options, redactor, log, deps.cleanupDeps || {});
    if (options.dryRun) {
      process.stdout.write(JSON.stringify({ mode: "dry-run (no credentials read, no network call)", project: options.project, expect_sdk: options.expectSdk, measurements: selected.map((m) => ({ name: m.name, tables: m.tables, wait: m.wait })), per_measurement: "join → final status → (confirmed only) durable intent → ONE INSERT → readback count 1 + client_id → listen ≤ 10 s → close/drain", persisted: "scalars / booleans only (report.json 0600)", disclaimer: DISCLAIMER }, null, 2) + "\n");
      return 0;
    }
    // ---- Preflight: nothing is written and nothing is mutated before it passes.
    const credentials = await (deps.loadCredentials || loadCredentials)(options.credentials);
    redactor.add(credentials.supabase.serviceKey);
    assertProject(options.project, credentials);
    const publishableKey = credentials.supabase.publishableKey;
    if (!publishableKey) throw new PreflightError("credentials: supabase.publishable_key is required (the QA page uses the app's public key, never the service key)");
    const sdk = (deps.sdkVersions || sdkVersions)(options.appDir);
    if (sdk.realtime_js !== options.expectSdk) throw new PreflightError(`realtime-js ${sdk.realtime_js} differs from the expected ${options.expectSdk}`);
    let health;
    try {
      health = await (deps.fetch || fetch)(`${credentials.supabase.url}/auth/v1/health`, { headers: { apikey: publishableKey }, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new PreflightError("BLOCKED: auth service unreachable");
    }
    if (health.status !== 200) throw new PreflightError(`BLOCKED: auth service answered ${health.status}`);
    const cohort = createCohort();
    const outDir = await assertOutOutsideRepo(options.out || defaultOutDir("realtime-probe", cohort.runId));
    let playwright;
    try {
      playwright = await (deps.loadPlaywright || loadPlaywright)(options.playwrightPath);
    } catch (error) {
      throw new PreflightError(error.message);
    }
    const db = deps.makeDb ? deps.makeDb(credentials) : createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    chmodSync(outDir, 0o700);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(outDir, "intents.json"));
    const fixtures = new Fixtures({ db, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { project: options.project, probe: "realtime" }, redactor, gate });
    makeManifestDurable(fixtures); // manifest on disk BEFORE any mutation
    const auth = deps.makeAuth ? deps.makeAuth(credentials) : createAuthAdmin({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, timeoutMs: options.timeoutMs });
    const tf = new TrackingFixtures({ fixtures, intents, cohort, gate, auth });
    const report = { context: { run_id: cohort.runId, project: options.project, sdk, measurements: selected.map((m) => ({ name: m.name, tables: m.tables, wait: m.wait })), disclaimer: DISCLAIMER, started_at: new Date().toISOString(), finished_at: null }, blocked: null, measurements: [], conclusion: null, cleanup: null };
    const persist = () => writeFile(path.join(outDir, "report.json"), JSON.stringify(redactor.redact(report), null, 2) + "\n", { mode: 0o600 });
    let browser = null;
    let pageServer = null;
    const lifecycle = createLifecycle({
      keepFixtures: options.keepFixtures,
      log,
      gate,
      drainTimeoutMs: options.timeoutMs,
      cleanup: createGuardedCleanup({
        gate,
        recovery: `node scripts/qa-realtime/run.mjs --cleanup-manifest ${path.join(outDir, "manifest.json")} --credentials <credentials.json> --project ${options.project}`,
        log,
        onEvent: () => {},
        stopProducers: async () => {
          await stopBrowser(browser).catch(() => {});
          browser = null;
          pageServer?.server.close();
        },
        proveAndClean: async () => {
          let indirectError = null;
          try {
            await fixtures.collectIndirect();
          } catch (error) {
            indirectError = String(error?.name || "Error");
          }
          const result = await realtimeCleanupWithProof({ db, auth, manifest: fixtures.manifest, intents, runId: cohort.runId, log, persist: () => fixtures.save() });
          return indirectError ? { ...result, ok: false, error: [result.error, "indirect collection failed: possible uncollected ids"].filter(Boolean).join("; ") } : result;
        },
      }),
      writeResults: async ({ cleanup }) => {
        report.cleanup = cleanup ? { ok: cleanup.ok, error: cleanup.error || null, refused: Boolean(cleanup.refused), open_intents: cleanup.open_intents?.length ?? 0, unproven: cleanup.unproven?.length ?? 0 } : null;
        if (cleanup) await writeFile(path.join(outDir, "cleanup.json"), JSON.stringify(redactor.redact(cleanup), null, 2) + "\n", { mode: 0o600 });
        report.context.finished_at = new Date().toISOString();
        await persist();
      },
    });
    const uninstall = lifecycle.installCrashHandlers(process, { onFatal: () => {}, codeFor: (fatal, cleanup) => exitCodeFor({ cleanup, fatalCode: fatalExitCode(fatal, cleanup) }), exit: (code) => process.exit(code) });
    const uninstallSignals = lifecycle.installSignalHandlers(process, { onSignal: (signal) => process.stderr.write(`[qa-realtime] ${signal}: stopping, draining, cleaning up\n`), onSecondSignal: () => {}, codeFor: (signal, cleanup) => exitCodeFor({ cleanup, signal: true }), exit: (code) => process.exit(code) });
    const limits = { joinTimeoutMs: JOIN_TIMEOUT_MS, windowMs: WINDOW_MS, ...(deps.limits || {}) };
    try {
      const user = await tf.createUser("rt-client", "client"); // durable intent BEFORE createAuthUser
      const bundle = await (deps.buildBundle || buildBundle)({ appDir: options.appDir, outDir: path.join(outDir, "page") });
      pageServer = await servePage(bundle);
      browser = await (deps.launchBrowser || launchBrowser)(playwright, { headless: !options.headed, chromiumPath: options.chromiumPath });
      const context = await browser.newContext();
      const proxy = await installRealtimeProxy(context, { supabaseOrigin: credentials.supabase.url });
      const page = await context.newPage();
      await act(gate, () => page.goto(pageServer.url));
      await act(gate, () => page.evaluate(([u, k]) => window.__rt.init(u, k), [credentials.supabase.url, publishableKey]));
      const session = await act(gate, () => page.evaluate(([e, p]) => window.__rt.signIn(e, p), [user.email, user.password]));
      if (!session.ok || session.uid !== user.id) report.blocked = session.ok ? "QA identity not proven (session UID differs from the created UID)" : "QA login refused";
      else {
        for (const spec of selected) {
          if (lifecycle.stopping) break;
          report.measurements.push(await runMeasurement({ spec, uid: user.id, user, page, proxy, tf, gate, ...limits }));
          await persist();
        }
        report.conclusion = conclude(report.measurements);
      }
    } finally {
      const { cleanup } = await lifecycle.finalize("completed");
      uninstall();
      uninstallSignals();
      const code = exitCodeFor({ cleanup, preflight: Boolean(report.blocked), fatalCode: lifecycle.fatal ? 1 : 0 });
      log(`done: ${report.measurements.length} measurement(s), conclusion ${JSON.stringify((report.conclusion || []).map((c) => c.code))}${report.blocked ? `, BLOCKED: ${report.blocked}` : ""}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped (kept)"}; exit ${code}`);
      if (options.json) process.stdout.write(JSON.stringify({ exit: code, out: outDir, conclusion: report.conclusion, blocked: report.blocked }) + "\n");
      finalCode = code; // the CLI wrapper sets process.exitCode; main only returns it
    }
    return finalCode;
  } catch (error) {
    if (finalCode === 3) return 3; // an incomplete cleanup is never overwritten
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    const info = redactor.redactError(error);
    process.stderr.write(`fatal: ${info.name}: ${info.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
