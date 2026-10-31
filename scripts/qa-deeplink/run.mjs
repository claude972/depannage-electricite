#!/usr/bin/env node
// WEB-DEEPLINK-QA-001 runner (docs/CLAUDE_DEEPLINK_QA_CONTRACT.md). Run by ROOT only.
// Order: arguments → local read-only checks → build provenance (first network check) → --out, intents
// and durable manifest → setup (dedicated preflight context, seed) → D1..D4 (runOne + diagnostics) →
// guarded cleanup with proof (generic B1, no side effects). Exit codes as the tracking harness.
import { mkdirSync, chmodSync, openSync, writeSync, closeSync, appendFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadCredentials, assertProject, assertBaseUrl, verifySha, defaultOutDir, assertOutOutsideRepo, PreflightError } from "../qa/lib/config.mjs";
import { createRedactor } from "../qa/lib/redact.mjs";
import { createCohort } from "../qa/lib/cohort.mjs";
import { createReport, exitCode, renderSummary } from "../qa/lib/report.mjs";
import { createLifecycle, createStopGate, fatalExitCode } from "../qa/lib/lifecycle.mjs";
import { createServiceClient } from "../qa/lib/supabase.mjs";
import { Fixtures } from "../qa/lib/fixtures.mjs";
import { loadPlaywright, launchBrowser, configureBrowser, stopBrowser } from "../qa/lib/browser.mjs";
import { IntentLog } from "../qa-tracking/lib/intents.mjs";
import { checkBuildProvenance } from "../qa-tracking/lib/preflight.mjs";
import { createAuthAdmin } from "../qa-tracking/lib/auth-admin.mjs";
import { createTrackingApi } from "../qa-tracking/lib/guard.mjs";
import { createReconciler } from "../qa-tracking/lib/reconcile.mjs";
import { makeManifestDurable } from "../qa-tracking/lib/durable.mjs";
import { captureDiagnostics } from "../qa-tracking/lib/diagnostics.mjs";
import { createGuardedCleanup, recoveryCommand, exitCodeFor } from "../qa-tracking/lib/finalize.mjs";
import { TrackingFixtures } from "../qa-tracking/scenarios.mjs";
import { runOne } from "../qa-tracking/run.mjs";
import { parseArgs, HELP } from "./lib/args.mjs";
import { deeplinkCleanupWithProof, cleanupOnly } from "./lib/cleanup.mjs";
import { REVALIDATE_GUARD_MS, REALTIME_PATH, REALTIME_CLOSE } from "./lib/constants.mjs";
import { createDeeplinkPool, setupDeeplink, SCENARIO_RUNNERS } from "./scenarios.mjs";

const DISCLAIMER = "Realtime is BLOCKED on purpose: only the deep-link fallback is proven; LIVE-WORKSPACE-001 (Realtime effectiveness) and the 100-dossier cap stay OPEN.";

function installTee(outDir, redactor) {
  const file = path.join(outDir, "run.log");
  const fd = openSync(file, "a", 0o600);
  chmodSync(file, 0o600);
  const originals = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const wrap = (original, label) =>
    function write(chunk, encoding, callback) {
      const text = redactor.redactString(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      try {
        writeSync(fd, `${new Date().toISOString()} ${label} ${text}${text.endsWith("\n") ? "" : "\n"}`);
      } catch {}
      return original(text, typeof encoding === "function" ? encoding : callback);
    };
  process.stdout.write = wrap(originals.out, "out");
  process.stderr.write = wrap(originals.err, "err");
  return () => {
    process.stdout.write = originals.out;
    process.stderr.write = originals.err;
    try {
      closeSync(fd);
    } catch {}
  };
}

const bindPool = (pool) => ({ session: (l, u) => pool.session(l, u), freshSession: (l, u) => pool.freshSession(l, u), closeSession: (l) => pool.closeSession(l) });

/**
 * `deps` (tests only; defaults are the real modules): loadCredentials, verifySha, loadPlaywright,
 * checkBuildProvenance, makeDb, makeAuth, launchBrowser, afterManifest({fixtures,intents,cohort}),
 * cleanupDeps (for --cleanup-manifest).
 * Exit precedence (documented, A8 finalize rules): cleanup incomplete/unknown (3) wins over anything
 * thrown afterwards; then preflight refusal (2); then interruption (130); then FAIL/FATAL (1).
 */
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
  const log = (...parts) => process.stdout.write(`[qa-deeplink] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);
  try {
    if (options.cleanupManifest) return await cleanupOnly(options, redactor, log, deps.cleanupDeps || {});
    const target = assertBaseUrl(options.baseUrl, [options.allowBaseUrls]);
    const cohort = createCohort();
    if (options.dryRun) {
      process.stdout.write(
        JSON.stringify(
          {
            mode: "dry-run (no credentials read, no network call)",
            base_url: new URL(options.baseUrl).origin,
            target,
            sha: options.sha,
            build_id: options.buildId || "REQUIRED for a real run",
            build_provenance: options.mode ? `${options.mode} (tracking A7 rules)` : "--mode remote|local REQUIRED for a real run",
            scenarios: options.scenarios,
            realtime: `routeWebSocket on every session context BEFORE login; ${REALTIME_PATH} closed with ${REALTIME_CLOSE.code}, never connectToServer; handler-side proof or BLOCKED`,
            windows: `passive gate: no workspace GET in flight + 1 s quiet + ${REVALIDATE_GUARD_MS} ms since the last window focus/visibility event; 45 s ⇒ BLOCKED`,
            preconditions: { D1: "session BEFORE the creation", D2: "witness BEFORE the session, then late dossier", D3: "sessions AFTER the seed", D4: "session BEFORE the creation + never-seeded UUID" },
            cleanup: "generic cleanupWithProof (B1) with runTrackingCleanup, no side effects; unknown ⇒ open intent, exit 3",
            out_of_proof: DISCLAIMER,
            outputs: ["run.log 0600", "events.ndjson", "result.json + summary.md", "manifest.json", "intents.json", "cleanup.json", "diagnostics/<scenario>/*"],
            exit_codes: { 0: "no FAIL", 1: "FAIL or FATAL", 2: "preflight refusal", 3: "cleanup incomplete / unknown outcome / unproven id", 130: "interrupted, cleanup complete" },
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    const credentials = await (deps.loadCredentials || loadCredentials)(options.credentials);
    redactor.add(credentials.supabase.serviceKey);
    assertProject(options.project, credentials);
    assertBaseUrl(options.baseUrl, [options.allowBaseUrls, credentials.allowedBaseUrls]);
    const sha = await (deps.verifySha || verifySha)(options.sha, options.appDir);
    const outDir = await assertOutOutsideRepo(options.out || defaultOutDir(options.sha, cohort.runId));
    let playwright;
    try {
      playwright = await (deps.loadPlaywright || loadPlaywright)(options.playwrightPath);
    } catch (error) {
      throw new PreflightError(error.message);
    }
    configureBrowser({ timeoutMs: options.timeoutMs });
    const base = new URL(options.baseUrl).origin;
    // Build provenance: first network check, before any --out, intent, fixture or service request.
    const build = await (deps.checkBuildProvenance || checkBuildProvenance)({ options, origin: base, fetchFn: fetch, timeoutMs: options.timeoutMs });
    log(`build provenance ${build.mode}: ${build.servedBuildId} (${build.provenance})`);
    const db = deps.makeDb ? deps.makeDb(credentials) : createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });

    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    chmodSync(outDir, 0o700);
    const restoreTee = installTee(outDir, redactor);
    const context = { run_id: cohort.runId, sha: options.sha, sha_verified: sha.verified, build, project: options.project, base_url: base, target, scenarios: options.scenarios, disclaimer: DISCLAIMER, out: outDir, started_at: new Date().toISOString(), finished_at: null };
    log(`run ${cohort.runId} → ${outDir}; ${DISCLAIMER}`);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(outDir, "intents.json"));
    const fixtures = new Fixtures({ db, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { sha: options.sha, project: options.project, base_url: base }, redactor, gate });
    makeManifestDurable(fixtures); // initial manifest on disk BEFORE any mutation
    const auth = deps.makeAuth ? deps.makeAuth(credentials) : createAuthAdmin({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, timeoutMs: options.timeoutMs });
    const tf = new TrackingFixtures({ fixtures, intents, cohort, gate, auth });
    await deps.afterManifest?.({ fixtures, intents, cohort });
    const reconcile = createReconciler(db);
    const recovery = recoveryCommand({ outDir, project: options.project }).replace("qa-tracking", "qa-deeplink");
    const eventsFile = path.join(outDir, "events.ndjson");
    const appendEvent = (event) => {
      try {
        appendFileSync(eventsFile, JSON.stringify(redactor.redact(event)) + "\n", { mode: 0o600 });
      } catch {}
    };
    let cleanupResult = null;
    let fatalInfo = null;
    const report = createReport(context, redactor, { onEvent: appendEvent, onScenario: async (entry) => {
      log(`${entry.status.padEnd(7)} ${entry.suite} / ${entry.name} (${entry.durationMs} ms)`);
      await persist();
    } });
    const buildResult = () => ({ context, summary: report.summary(), fatal: fatalInfo, scenarios: report.scenarios, cleanup: cleanupResult ? { ok: cleanupResult.ok, error: cleanupResult.error, refused: Boolean(cleanupResult.refused), recovery: cleanupResult.recovery || null, unproven: cleanupResult.unproven?.length ?? 0, open_intents: cleanupResult.open_intents?.length ?? 0, recovered: cleanupResult.recovered?.length ?? 0 } : null, manifest: fixtures.manifestPath, intents: intents.file });
    async function persist() {
      const result = redactor.redact(buildResult());
      await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
      await writeFile(path.join(outDir, "summary.md"), `${renderSummary(result)}\n\n> ${DISCLAIMER}\n`, { mode: 0o600 });
    }
    let browser = null;
    let pool = null;
    const lifecycle = createLifecycle({
      keepFixtures: options.keepFixtures,
      log,
      gate,
      drainTimeoutMs: options.timeoutMs,
      cleanup: createGuardedCleanup({
        gate,
        recovery,
        log,
        onEvent: appendEvent,
        stopProducers: async () => {
          try {
            await pool?.closeAll();
          } catch {}
          await stopBrowser(browser);
          browser = null;
        },
        proveAndClean: async () => {
          let indirectError = null;
          try {
            await fixtures.collectIndirect();
          } catch (error) {
            indirectError = String(error?.name || "Error");
            log(`indirect collection failed (${indirectError}): cleanup will be INCOMPLETE`);
          }
          const result = await deeplinkCleanupWithProof({ db, auth, manifest: fixtures.manifest, intents, runId: cohort.runId, log, persist: () => fixtures.save() });
          // Ids possibly created indirectly were not collected: never « cleanup ok » (exit 3).
          if (indirectError) return { ...result, ok: false, error: [result.error, "indirect collection failed: possible uncollected ids"].filter(Boolean).join("; ") };
          return result;
        },
      }),
      writeResults: async ({ cleanup, fatal, reason }) => {
        cleanupResult = cleanup;
        if (cleanup) await writeFile(path.join(outDir, "cleanup.json"), JSON.stringify(redactor.redact(cleanup), null, 2) + "\n", { mode: 0o600 });
        if (cleanup && cleanup.ok === false) log(`cleanup INCOMPLETE: ${cleanup.error}. Recover with: ${recovery}`);
        if (fatal) fatalInfo = { origin: fatal.origin, error: redactor.redactError(fatal.error) };
        context.finished_at = new Date().toISOString();
        context.finish_reason = reason;
        await persist();
      },
    });
    const uninstall = lifecycle.installCrashHandlers(process, {
      onFatal: (error, origin) => appendEvent({ at: new Date().toISOString(), type: "fatal", origin, error: redactor.redactError(error) }),
      codeFor: (fatal, cleanup) => {
        const code = exitCodeFor({ cleanup, fail: report.summary().fail, fatalCode: fatalExitCode(fatal, cleanup) });
        restoreTee();
        return code;
      },
      exit: (code) => process.exit(code),
    });
    const uninstallSignals = lifecycle.installSignalHandlers(process, {
      onSignal: (signal) => {
        process.stderr.write(`[qa-deeplink] ${signal}: next scenarios and every mutator stopped; closing the browser, draining, proving ownership, cleaning up\n`);
        appendEvent({ at: new Date().toISOString(), type: "signal", signal });
      },
      onSecondSignal: (signal) => {
        process.stderr.write(`[qa-deeplink] second ${signal}: cleanup aborted; manifest and intents kept — recover with --cleanup-manifest\n`);
        restoreTee();
      },
      codeFor: (signal, cleanup) => {
        const code = exitCodeFor({ cleanup, signal: true });
        restoreTee();
        return code;
      },
      exit: (code) => process.exit(code),
    });

    let preflightLate = null;
    try {
      browser = await (deps.launchBrowser || launchBrowser)(playwright, { headless: !options.headed, chromiumPath: options.chromiumPath });
      const state = { watch: new Map(), canaries: [] };
      pool = createDeeplinkPool({ browser, base, supabaseOrigin: credentials.supabase.url, projectRef: options.project, redactor, gate, intents, reconcile, onEvent: appendEvent, state });
      const ctx = { base, projectRef: options.project, out: outDir, gate, intents, tf, fixtures, cohort, redactor, log, state, api: createTrackingApi({ gate, intents, reconcile }), ...bindPool(pool) };
      const setup = await gate.register(
        report.scenario("setup", "dedicated preflight context + seed", async (s) => {
          try {
            s.note(JSON.stringify(await setupDeeplink(ctx)));
          } catch (error) {
            if (error instanceof PreflightError) preflightLate = error;
            throw error;
          }
        }),
      );
      if (setup.status === "PASS") {
        const diagnose = (name, s) => captureDiagnostics({ scenario: name, handles: pool.diagnosticHandles(), out: outDir, redactor, gate }).then((d) => {
          for (const file of d.files || []) s.evidence(file, "diagnostics");
          if (d.skipped || d.truncated || d.errors?.length) log(`diagnostics ${name}: ${d.skipped || ""}${d.truncated ? " truncated" : ""} ${(d.errors || []).join(",")}`.trim());
        });
        for (const name of options.scenarios) {
          if (lifecycle.stopping) break;
          pool.beginScenario();
          await runOne(report, "deeplink", name, (s) => SCENARIO_RUNNERS[name](ctx, s), persist, gate, diagnose);
        }
      }
    } finally {
      const { cleanup } = await lifecycle.finalize("completed");
      uninstall();
      uninstallSignals();
      const summary = report.summary();
      const code = exitCodeFor({ cleanup, preflight: Boolean(preflightLate), fatalCode: exitCode(summary, true, lifecycle.fatal) });
      log(`done: ${JSON.stringify(summary)}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped (kept)"}; exit ${code}`);
      if (options.json) process.stdout.write(JSON.stringify({ ...summary, exit: code, out: outDir }) + "\n");
      restoreTee();
      process.exitCode = code;
      finalCode = code;
    }
    return process.exitCode;
  } catch (error) {
    // Precedence: an incomplete/unknown cleanup (3) is never overwritten by a later throw.
    if (finalCode === 3) {
      process.stderr.write(`fatal after an INCOMPLETE cleanup: exit 3 kept\n`);
      return 3;
    }
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    const info = redactor.redactError(error);
    process.stderr.write(`fatal: ${info.name}: ${info.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
