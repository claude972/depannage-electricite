#!/usr/bin/env node
// Acceptance-test runner for WEB-ACCEPTANCE-TESTS-001. See docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md.
// Node 24 ESM, no dependency installed in the repository: Playwright is imported from an
// injected path. Importing this module does nothing; cloud access happens only in main().
//
// Guarantees (QA-003): every console line and the final crash path go through the redactor;
// stdout/stderr are also teed to <out>/run.log (0600); result.json / summary.md are rewritten
// after EACH scenario and events.ndjson is appended per step; cleanup runs exactly once, on
// completion, on a suite crash, on an unhandled rejection and on an uncaught exception. The
// finalisation first raises a stop signal (every fixture helper refuses its next insert), drains
// the creations still in flight (their ids reach the manifest) and only then deletes.
import { appendFileSync, mkdirSync, openSync, writeSync, closeSync, chmodSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, HELP } from "./lib/args.mjs";
import { loadCredentials, assertProject, assertBaseUrl, verifySha, defaultOutDir, assertOutOutsideRepo, PreflightError } from "./lib/config.mjs";
import { createRedactor } from "./lib/redact.mjs";
import { createCohort } from "./lib/cohort.mjs";
import { CLEANUP_STEPS, runCleanup } from "./lib/cleanup.mjs";
import { createReport, exitCode, renderSummary, classify } from "./lib/report.mjs";
import { createLifecycle, createStopGate, fatalExitCode } from "./lib/lifecycle.mjs";
import { createServiceClient } from "./lib/supabase.mjs";
import { Fixtures } from "./lib/fixtures.mjs";
import { loadPlaywright, launchBrowser, configureBrowser, stopBrowser } from "./lib/browser.mjs";
import { SUITES, suiteByName } from "./suites/index.mjs";

/** Redacts and tees process stdout/stderr into <out>/run.log (mode 0600). Returns a restore(). */
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
  const log = (...parts) => process.stdout.write(`[qa] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);

  try {
    if (options.cleanupManifest) return await cleanupOnly(options, redactor, log);

    // ---- Preflight (contract §4): nothing is created before every check passes.
    const onlyCaptures = options.suites.length === 1 && options.suites[0] === "captures";
    let credentials = null;
    if (options.credentials) {
      credentials = await loadCredentials(options.credentials);
      redactor.add(credentials.supabase.serviceKey);
      if (options.project) assertProject(options.project, credentials);
    } else if (!onlyCaptures && !options.dryRun) throw new PreflightError("--credentials is required");
    const target = assertBaseUrl(options.baseUrl, [options.allowBaseUrls, credentials?.allowedBaseUrls || []]);
    const sha = await verifySha(options.sha, options.appDir);
    const cohort = createCohort();
    const outDir = await assertOutOutsideRepo(options.out || defaultOutDir(options.sha, cohort.runId));
    const suites = options.suites.map(suiteByName);
    const needsCredentials = suites.some((s) => s.needsCredentials);
    if (needsCredentials && !credentials && !options.dryRun) throw new PreflightError("selected suites need --credentials");
    let playwright = null;
    let playwrightVersion = null;
    try {
      playwright = await loadPlaywright(options.playwrightPath);
      playwrightVersion = JSON.parse(await readFile(path.join(path.resolve(options.playwrightPath), "package.json"), "utf8")).version;
    } catch (error) {
      throw new PreflightError(error.message);
    }
    configureBrowser({ timeoutMs: options.timeoutMs });

    const context = {
      run_id: cohort.runId,
      sha: options.sha,
      sha_verified: sha.verified,
      project: options.project || credentials?.supabase.projectRef || null,
      base_url: new URL(options.baseUrl).origin,
      target,
      headless: options.headless,
      timeout_ms: options.timeoutMs,
      playwright: playwrightVersion,
      suites: suites.map((s) => s.name),
      out: outDir,
      started_at: new Date().toISOString(),
      finished_at: null,
    };

    if (options.dryRun) {
      const plan = {
        mode: "dry-run (no network call made)",
        ...context,
        credentials: options.credentials ? "shape validated, project matched" : "not provided",
        direct_rpc_probes: credentials?.supabase.publishableKey ? "enabled (publishable_key present)" : "skipped unless supabase.publishable_key is provided",
        fixtures: suites.map((s) => ({ suite: s.name, creates: s.plan })),
        cleanup_order: CLEANUP_STEPS.map((s) => (s.kind === "table" ? `${s.table} by ${s.column}` : s.kind === "storage" ? `storage ${s.bucket}` : "auth users")),
        outputs: ["run.log (0600, redacted tee of stdout/stderr)", "events.ndjson (per step)", "result.json + summary.md (rewritten after each scenario)", "manifest.json", "cleanup.json", "*.png"],
        exit_codes: { 0: "no FAIL", 1: "at least one FAIL or a FATAL crash", 2: "preflight refusal", 3: "cleanup incomplete" },
      };
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
      return 0;
    }

    // ---- Real run: private out dir, redacted tee, incremental results, guaranteed cleanup.
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    chmodSync(outDir, 0o700);
    const restoreTee = installTee(outDir, redactor);
    log(`run ${cohort.runId} → ${outDir}`);
    log(`target ${context.base_url} (${target}); sha ${options.sha.slice(0, 12)} ${sha.verified ? "verified" : "declared"}; project ${context.project}; timeout ${options.timeoutMs} ms`);
    const db = credentials ? createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs }) : null;
    // One stop gate shared by the lifecycle (raises it, drains it) and the fixtures (check it before every write).
    const gate = createStopGate();
    const fixtures = db ? new Fixtures({ db, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { sha: options.sha, project: context.project, base_url: context.base_url }, redactor, gate }) : null;
    const eventsFile = path.join(outDir, "events.ndjson");
    const appendEvent = (event) => {
      try {
        appendFileSync(eventsFile, JSON.stringify(event) + "\n", { mode: 0o600 });
      } catch {}
    };
    let cleanupResult = null;
    let drainResult = null;
    let fatalInfo = null;
    const report = createReport(context, redactor, {
      onEvent: appendEvent,
      onScenario: async (entry) => {
        log(`${entry.status.padEnd(7)} ${entry.suite} / ${entry.name} (${entry.durationMs} ms)`);
        await persist();
      },
    });
    const buildResult = () => ({
      context,
      summary: report.summary(),
      fatal: fatalInfo,
      scenarios: report.scenarios,
      cleanup: cleanupResult ? { ok: cleanupResult.ok, steps: cleanupResult.steps?.length ?? 0, failed: (cleanupResult.steps || []).filter((s) => s.status === "fail").length, error: cleanupResult.error || null } : null,
      drain: drainResult,
      manifest: fixtures ? fixtures.manifestPath : null,
    });
    async function persist() {
      const result = redactor.redact(buildResult());
      await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
      await writeFile(path.join(outDir, "summary.md"), renderSummary(result), { mode: 0o600 });
    }
    let browser = null;
    const lifecycle = createLifecycle({
      keepFixtures: options.keepFixtures,
      log,
      gate,
      drainTimeoutMs: options.timeoutMs, // a Supabase call never outlives --timeout-ms (AbortSignal.timeout)
      cleanup: fixtures
        ? async () => {
            // Browser drained and stopped BEFORE any deletion: no late route callback can fire.
            await stopBrowser(browser);
            browser = null;
            try {
              await fixtures.collectIndirect();
            } catch (error) {
              log(`indirect fixture collection failed: ${redactor.redactString(error.message)}`);
            }
            const result = await runCleanup(db, fixtures.manifest, (entry) => log(`cleanup ${entry.status.padEnd(7)} ${entry.table}${entry.column ? ` by ${entry.column}` : ""}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
            await writeFile(path.join(outDir, "cleanup.json"), JSON.stringify(redactor.redact(result), null, 2) + "\n", { mode: 0o600 });
            return result;
          }
        : null,
      writeResults: async ({ cleanup, fatal, reason, drain }) => {
        cleanupResult = cleanup;
        drainResult = drain;
        if (fatal) fatalInfo = { origin: fatal.origin, error: redactor.redactError(fatal.error) };
        context.finished_at = new Date().toISOString();
        context.finish_reason = reason;
        await persist();
        if (options.keepFixtures && fixtures) log(`--keep-fixtures: nothing deleted; manifest ${fixtures.manifestPath}`);
      },
    });
    const uninstall = lifecycle.installCrashHandlers(process, {
      onFatal: (error, origin) => {
        const info = redactor.redactError(error);
        process.stderr.write(`[qa] FATAL (${origin}): ${info.name}: ${info.message}\n`);
        if (info.stack) process.stderr.write(`${info.stack}\n`);
        appendEvent({ at: new Date().toISOString(), type: "fatal", origin, error: info });
      },
      codeFor: (fatal, cleanup) => {
        const summary = report.summary();
        const code = summary.fail > 0 ? 1 : fatalExitCode(fatal, cleanup);
        log(`aborted after FATAL: ${JSON.stringify(summary)}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped"}; exit ${code}`);
        restoreTee();
        return code;
      },
      exit: (code) => process.exit(code),
    });

    try {
      browser = await launchBrowser(playwright, { headless: options.headless, chromiumPath: options.chromiumPath });
      for (const suite of suites) {
        if (lifecycle.stopping) {
          // A FATAL is being finalised: no further suite may seed fixtures or drive the browser.
          log(`suite ${suite.name} skipped: run stopping (${gate.reason})`);
          break;
        }
        log(`suite ${suite.name}: ${suite.description}`);
        if (suite.needsCredentials && !fixtures) {
          await report.scenario(suite.name, "preconditions", async () => {
            throw new PreflightError("suite needs credentials");
          });
          continue;
        }
        try {
          await suite.run({ base: context.base_url, target, projectRef: context.project, fixtures, db, browser, cohort, out: outDir, report, redactor, log, credentials, timeoutMs: options.timeoutMs });
        } catch (error) {
          // A suite-level crash (fixture seeding, browser) is recorded, never silently dropped.
          await report.scenario(suite.name, "suite setup", async () => {
            throw error;
          });
          log(`suite ${suite.name} aborted: ${classify(error)} ${redactor.redactString(error.message)}`);
          if (lifecycle.stopping) break; // StopRequestedError or a crash already finalising: stop seeding
        }
      }
    } finally {
      await stopBrowser(browser);
      browser = null;
      const { cleanup } = await lifecycle.finalize("completed");
      uninstall();
      const summary = report.summary();
      const code = exitCode(summary, cleanup ? cleanup.ok : true, lifecycle.fatal);
      log(`done: ${JSON.stringify(summary)}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped"}; exit ${code}`);
      if (options.json) process.stdout.write(JSON.stringify({ ...summary, exit: code, out: outDir }) + "\n");
      restoreTee();
      process.exitCode = code;
    }
    return process.exitCode;
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    const info = redactor.redactError(error);
    process.stderr.write(`fatal: ${info.name}: ${info.message}\n${info.stack || ""}\n`);
    return 2;
  }
}

async function cleanupOnly(options, redactor, log) {
  const credentials = await loadCredentials(options.credentials);
  redactor.add(credentials.supabase.serviceKey);
  assertProject(options.project, credentials);
  const manifest = JSON.parse(await readFile(options.cleanupManifest, "utf8"));
  if (manifest.project && manifest.project !== options.project) throw new PreflightError(`manifest was created for project ${manifest.project}, not ${options.project}`);
  const db = createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
  const cleanup = await runCleanup(db, manifest, (entry) => log(`cleanup ${entry.status.padEnd(7)} ${entry.table}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
  const target = path.join(path.dirname(path.resolve(options.cleanupManifest)), "cleanup.json");
  await writeFile(target, JSON.stringify(redactor.redact(cleanup), null, 2) + "\n", { mode: 0o600 });
  log(`cleanup ${cleanup.ok ? "complete" : "INCOMPLETE"} → ${target}`);
  return cleanup.ok ? 0 : 3;
}

export { SUITES };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
