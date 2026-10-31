#!/usr/bin/env node
// Acceptance runner for QA-DOCUMENTS-B2B-004 (lots 015 quote documents and 017 site operations).
// See docs/CLAUDE_BUSINESS_QA_CONTRACT.md. Node 24 ESM; Playwright is imported from an injected
// path; nothing is installed. Importing this module does nothing: every network call happens in
// main(), and only the pilot runs it against a frozen application and a dedicated Supabase.
//
// Reuses scripts/qa/lib/* READ-ONLY (preflight, redaction, cohort, lifecycle, report, service
// client, browser helpers). Own: arguments (docs|b2b|all), cleanup plan with 015/016/017 children
// and unknown-outcome refusal, fixtures with durable intents, build-id preflight, suites.
import { appendFileSync, mkdirSync, openSync, writeSync, closeSync, chmodSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs, HELP } from "./lib/args.mjs";
import { loadCredentials, assertProject, assertBaseUrl, verifySha, assertOutOutsideRepo, PreflightError } from "../qa/lib/config.mjs";
import { createRedactor } from "../qa/lib/redact.mjs";
import { createCohort } from "../qa/lib/cohort.mjs";
import { createReport, renderSummary, AppDefect } from "../qa/lib/report.mjs";
import { createLifecycle, createStopGate, fatalExitCode } from "../qa/lib/lifecycle.mjs";
import { createServiceClient } from "../qa/lib/supabase.mjs";
import { loadPlaywright, launchBrowser, configureBrowser, stopBrowser, newPage } from "../qa/lib/browser.mjs";
import { CLEANUP_STEPS, runCleanup, resolveIntents } from "./lib/cleanup.mjs";
import { BusinessFixtures } from "./lib/fixtures.mjs";
import { createAdminAuth } from "./lib/auth.mjs";
import { readLocalBuildId, servedBuildId, compareBuildIds } from "./lib/preflight.mjs";
import { orchestrate, NOT_EXERCISED } from "./lib/orchestrate.mjs";
import { SUITES, suiteByName } from "./suites/index.mjs";

export const defaultOutDir = (sha, runId) => path.join(os.tmpdir(), "depannage-qa-business", `${sha.slice(0, 12)}-${runId}`);

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

/** Dry-run plan: everything the run would do, without any network call. Pure; unit-tested. */
export function buildPlan(context, suites, localBuildId) {
  return {
    mode: "dry-run (no network call made)",
    ...context,
    build_id_local: localBuildId,
    build_id_check: localBuildId ? "served /_next/static/<id>/ must equal .next/BUILD_ID of --app-dir (FAIL otherwise)" : "not verified (no --app-dir build): declared only",
    fixtures: suites.map((s) => ({ suite: s.name, creates: s.plan })),
    cleanup_order: CLEANUP_STEPS.map((s) => (s.kind === "table" ? `${s.table} by ${s.column}` : s.kind === "storage" ? `storage ${s.bucket}` : "auth users")),
    unknown_outcome: "a delete or readback whose outcome is unknown halts the plan; later steps are skipped, manifest kept, exit 3",
    intents: "user ids generated and written to manifest.intents before each Auth creation",
    outputs: ["run.log (0600, redacted tee)", "events.ndjson", "result.json + summary.md (rewritten after each scenario)", "manifest.json", "cleanup.json", "*.png", "*.pdf (downloaded documents)"],
    exit_codes: { 0: "no FAIL", 1: "at least one FAIL or a FATAL crash", 2: "preflight refusal", 3: "cleanup incomplete or unknown outcome", 130: "interrupted after cleanup (second signal: cleanup aborted, manifest kept)" },
    not_exercised: NOT_EXERCISED,
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
  const log = (...parts) => process.stdout.write(`[qa-business] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);
  try {
    if (options.cleanupManifest) return await cleanupOnly(options, redactor, log);

    // ---- Preflight: nothing is created before every check passes.
    let credentials = null;
    if (options.credentials) {
      credentials = await loadCredentials(options.credentials);
      redactor.add(credentials.supabase.serviceKey);
      assertProject(options.project, credentials);
    } else if (!options.dryRun) throw new PreflightError("--credentials is required");
    const target = assertBaseUrl(options.baseUrl, [options.allowBaseUrls, credentials?.allowedBaseUrls || []]);
    const sha = await verifySha(options.sha, options.appDir);
    const localBuildId = await readLocalBuildId(options.appDir);
    const cohort = createCohort();
    const outDir = await assertOutOutsideRepo(options.out || defaultOutDir(options.sha, cohort.runId));
    const suites = options.suites.map(suiteByName);
    const context = {
      run_id: cohort.runId,
      sha: options.sha,
      sha_verified: sha.verified,
      build_id: localBuildId,
      build_id_verified: false,
      project: options.project,
      base_url: new URL(options.baseUrl).origin,
      target,
      headless: options.headless,
      timeout_ms: options.timeoutMs,
      playwright: null,
      suites: suites.map((s) => s.name),
      out: outDir,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    if (options.dryRun) {
      process.stdout.write(JSON.stringify(buildPlan({ ...context, credentials: options.credentials ? "shape validated, project matched" : "not provided" }, suites, localBuildId), null, 2) + "\n");
      return 0;
    }
    let playwright;
    try {
      playwright = await loadPlaywright(options.playwrightPath);
      context.playwright = JSON.parse(await readFile(path.join(path.resolve(options.playwrightPath), "package.json"), "utf8")).version;
    } catch (error) {
      throw new PreflightError(error.message);
    }
    configureBrowser({ timeoutMs: options.timeoutMs });

    // ---- Real run: private out dir, redacted tee, incremental results, guaranteed cleanup.
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    chmodSync(outDir, 0o700);
    const restoreTee = installTee(outDir, redactor);
    log(`run ${cohort.runId} → ${outDir}`);
    log(`target ${context.base_url} (${target}); sha ${options.sha.slice(0, 12)} ${sha.verified ? "verified" : "declared"}; build ${localBuildId ?? "unknown"}; project ${context.project}; timeout ${options.timeoutMs} ms`);
    const db = createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
    const auth = createAdminAuth({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
    const gate = createStopGate();
    const fixtures = new BusinessFixtures({ db, auth, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { sha: options.sha, build_id: localBuildId, project: context.project, base_url: context.base_url }, redactor, gate });
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
      cleanup: cleanupResult ? { ok: cleanupResult.ok, halted: cleanupResult.halted ?? null, steps: cleanupResult.steps?.length ?? 0, failed: (cleanupResult.steps || []).filter((s) => s.status !== "pass" && s.status !== "skipped").length, error: cleanupResult.error || null } : null,
      drain: drainResult,
      manifest: fixtures.manifestPath,
      not_exercised: NOT_EXERCISED,
    });
    async function persist() {
      const result = redactor.redact(buildResult());
      await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
      await writeFile(path.join(outDir, "summary.md"), renderSummary(result) + "\n## Not exercised by this lot (contract §8)\n\n" + NOT_EXERCISED.map((l) => `- ${l}`).join("\n") + "\n", { mode: 0o600 });
    }
    let browser = null;
    const lifecycle = createLifecycle({
      keepFixtures: options.keepFixtures,
      log,
      gate,
      drainTimeoutMs: options.timeoutMs,
      cleanup: async () => {
        await stopBrowser(browser);
        browser = null;
        try {
          await fixtures.collectIndirect();
        } catch (error) {
          log(`indirect fixture collection failed: ${redactor.redactString(error.message)}`);
        }
        try {
          await resolveIntents(auth, fixtures.manifest, (entry) => log(`intent ${entry.status.padEnd(10)} ${entry.label}${entry.error ? ` — ${entry.error}` : ""}`));
          await fixtures.save();
        } catch (error) {
          log(`intent resolution failed: ${redactor.redactString(error.message)}`);
        }
        const result = await runCleanup(db, fixtures.manifest, (entry) => log(`cleanup ${entry.status.padEnd(15)} ${entry.table}${entry.column ? ` by ${entry.column}` : ""}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
        await writeFile(path.join(outDir, "cleanup.json"), JSON.stringify(redactor.redact(result), null, 2) + "\n", { mode: 0o600 });
        return result;
      },
      writeResults: async ({ cleanup, fatal, reason, drain }) => {
        cleanupResult = cleanup;
        drainResult = drain;
        if (fatal) fatalInfo = { origin: fatal.origin, error: redactor.redactError(fatal.error) };
        context.finished_at = new Date().toISOString();
        context.finish_reason = reason;
        await persist();
        if (options.keepFixtures) log(`--keep-fixtures: nothing deleted; manifest ${fixtures.manifestPath}`);
      },
    });
    const uninstall = lifecycle.installCrashHandlers(process, {
      onFatal: (error, origin) => {
        const info = redactor.redactError(error);
        process.stderr.write(`[qa-business] FATAL (${origin}): ${info.name}: ${info.message}\n`);
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
    const uninstallSignals = lifecycle.installSignalHandlers(process, {
      onSignal: (signal) => {
        process.stderr.write(`[qa-business] ${signal} received: stopping fixtures, draining, cleaning up the cohort (send ${signal} again to abort the cleanup and keep the manifest)\n`);
        appendEvent({ at: new Date().toISOString(), type: "signal", signal });
      },
      onSecondSignal: (signal) => {
        process.stderr.write(`[qa-business] second ${signal}: cleanup aborted; manifest kept at ${fixtures.manifestPath} — recover with --cleanup-manifest\n`);
        appendEvent({ at: new Date().toISOString(), type: "signal", signal, aborted_cleanup: true });
        restoreTee();
      },
      codeFor: (signal, cleanup) => {
        const code = cleanup && cleanup.ok === false ? 3 : 130;
        log(`aborted by ${signal}: ${JSON.stringify(report.summary())}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped"}; exit ${code}`);
        restoreTee();
        return code;
      },
      exit: (code) => process.exit(code),
    });

    let result;
    try {
      browser = await launchBrowser(playwright, { headless: options.headless, chromiumPath: options.chromiumPath });
      // Build identity: the served document must reference the build of --app-dir (contract §2).
      await report.scenario("preflight", "served build matches --app-dir build", async (s) => {
        const h = await newPage(browser, { baseUrl: context.base_url, redactor });
        try {
          const verdict = await s.step("read the served build id", async () => {
            await h.page.goto(`${context.base_url}/`, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
            const served = servedBuildId(await h.page.content());
            const v = compareBuildIds(localBuildId, served);
            context.build_id_served = served;
            context.build_id_verified = v.verified;
            if (v.mismatch) throw new AppDefect(v.reason);
            return { local: localBuildId, served, ...v };
          });
          s.note(verdict.verified ? "build identity verified" : verdict.reason);
        } finally {
          await h.close();
        }
      });
      const ctx = { base: context.base_url, target, projectRef: context.project, fixtures, db, browser, cohort, out: outDir, report, redactor, log, credentials, timeoutMs: options.timeoutMs };
      result = await orchestrate({ suites, ctx, lifecycle, report, stopBrowser: async () => { await stopBrowser(browser); browser = null; }, log, PreflightError });
    } finally {
      uninstall();
      uninstallSignals();
    }
    const { code, summary, cleanup } = result ?? { code: 1, summary: report.summary(), cleanup: null };
    log(`done: ${JSON.stringify(summary)}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped"}; exit ${code}`);
    if (options.json) process.stdout.write(JSON.stringify({ ...summary, exit: code, out: outDir }) + "\n");
    restoreTee();
    return code;
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
  const auth = createAdminAuth({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
  await resolveIntents(auth, manifest, (entry) => log(`intent ${entry.status.padEnd(10)} ${entry.label}${entry.error ? ` — ${entry.error}` : ""}`));
  const cleanup = await runCleanup(db, manifest, (entry) => log(`cleanup ${entry.status.padEnd(15)} ${entry.table}${entry.column ? ` by ${entry.column}` : ""}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
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
