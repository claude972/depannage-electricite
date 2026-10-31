#!/usr/bin/env node
// Acceptance-test runner for WEB-ACCEPTANCE-TESTS-001. See docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md.
// Node 24 ESM, no dependency installed in the repository: Playwright is imported from an
// injected path. Importing this module does nothing; cloud access happens only in main().
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, HELP } from "./lib/args.mjs";
import { loadCredentials, assertProject, assertBaseUrl, verifySha, defaultOutDir, assertOutOutsideRepo, PreflightError } from "./lib/config.mjs";
import { createRedactor } from "./lib/redact.mjs";
import { createCohort } from "./lib/cohort.mjs";
import { CLEANUP_STEPS, runCleanup } from "./lib/cleanup.mjs";
import { createReport, exitCode, renderSummary, classify } from "./lib/report.mjs";
import { createServiceClient } from "./lib/supabase.mjs";
import { Fixtures } from "./lib/fixtures.mjs";
import { loadPlaywright, launchBrowser } from "./lib/browser.mjs";
import { SUITES, suiteByName } from "./suites/index.mjs";

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

    const context = {
      run_id: cohort.runId,
      sha: options.sha,
      sha_verified: sha.verified,
      project: options.project || credentials?.supabase.projectRef || null,
      base_url: new URL(options.baseUrl).origin,
      target,
      headless: options.headless,
      playwright: playwrightVersion,
      suites: suites.map((s) => s.name),
      out: outDir,
      started_at: new Date().toISOString(),
    };

    if (options.dryRun) {
      const plan = {
        mode: "dry-run (no network call made)",
        ...context,
        credentials: options.credentials ? "shape validated, project matched" : "not provided",
        fixtures: suites.map((s) => ({ suite: s.name, creates: s.plan })),
        cleanup_order: CLEANUP_STEPS.map((s) => (s.kind === "table" ? `${s.table} by ${s.column}` : s.kind === "storage" ? `storage ${s.bucket}` : "auth users")),
        exit_codes: { 0: "no FAIL", 1: "at least one FAIL", 2: "preflight refusal", 3: "cleanup incomplete" },
      };
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
      return 0;
    }

    // ---- Real run.
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    log(`run ${cohort.runId} → ${outDir}`);
    log(`target ${context.base_url} (${target}); sha ${options.sha.slice(0, 12)} ${sha.verified ? "verified" : "declared"}; project ${context.project}`);
    const db = credentials ? createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor }) : null;
    const fixtures = db ? new Fixtures({ db, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { sha: options.sha, project: context.project, base_url: context.base_url }, redactor }) : null;
    const report = createReport(context, redactor, (entry) => log(`${entry.status.padEnd(7)} ${entry.suite} / ${entry.name} (${entry.durationMs} ms)`));
    let browser = null;
    let cleanup = null;
    try {
      browser = await launchBrowser(playwright, { headless: options.headless, chromiumPath: options.chromiumPath });
      for (const suite of suites) {
        log(`suite ${suite.name}: ${suite.description}`);
        if (suite.needsCredentials && !fixtures) {
          await report.scenario(suite.name, "preconditions", async () => {
            throw new PreflightError("suite needs credentials");
          });
          continue;
        }
        try {
          await suite.run({ base: context.base_url, target, projectRef: context.project, fixtures, db, browser, cohort, out: outDir, report, redactor, log });
        } catch (error) {
          // A suite-level crash (fixture seeding, browser) is recorded, never silently dropped.
          await report.scenario(suite.name, "suite setup", async () => {
            throw error;
          });
          log(`suite ${suite.name} aborted: ${classify(error)} ${error.message}`);
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (fixtures) {
        try {
          await fixtures.collectIndirect();
        } catch (error) {
          log(`indirect fixture collection failed: ${error.message}`);
        }
        if (options.keepFixtures) log(`--keep-fixtures: nothing deleted; manifest ${fixtures.manifestPath}`);
        else {
          cleanup = await runCleanup(db, fixtures.manifest, (entry) => log(`cleanup ${entry.status.padEnd(7)} ${entry.table}${entry.column ? ` by ${entry.column}` : ""}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
          await writeFile(path.join(outDir, "cleanup.json"), JSON.stringify(redactor.redact(cleanup), null, 2) + "\n");
        }
      }
      context.finished_at = new Date().toISOString();
      const result = { context, summary: report.summary(), scenarios: report.scenarios, cleanup: cleanup ? { ok: cleanup.ok, steps: cleanup.steps.length, failed: cleanup.steps.filter((s) => s.status === "fail").length } : null, manifest: fixtures ? fixtures.manifestPath : null };
      await writeFile(path.join(outDir, "result.json"), JSON.stringify(redactor.redact(result), null, 2) + "\n");
      await writeFile(path.join(outDir, "summary.md"), renderSummary(result));
      const code = exitCode(result.summary, cleanup ? cleanup.ok : true);
      log(`done: ${JSON.stringify(result.summary)}; cleanup ${cleanup ? (cleanup.ok ? "complete" : "INCOMPLETE") : "skipped"}; exit ${code}`);
      if (options.json) process.stdout.write(JSON.stringify({ ...result.summary, exit: code, out: outDir }) + "\n");
      process.exitCode = code;
    }
    return process.exitCode;
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    process.stderr.write(`fatal: ${redactor.redactString(error.stack || error.message)}\n`);
    return 2;
  }
}

async function cleanupOnly(options, redactor, log) {
  const credentials = await loadCredentials(options.credentials);
  redactor.add(credentials.supabase.serviceKey);
  assertProject(options.project, credentials);
  const manifest = JSON.parse(await readFile(options.cleanupManifest, "utf8"));
  if (manifest.project && manifest.project !== options.project) throw new PreflightError(`manifest was created for project ${manifest.project}, not ${options.project}`);
  const db = createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor });
  const cleanup = await runCleanup(db, manifest, (entry) => log(`cleanup ${entry.status.padEnd(7)} ${entry.table}: requested ${entry.requested}, remaining ${entry.remaining}${entry.error ? ` — ${entry.error}` : ""}`));
  const target = path.join(path.dirname(path.resolve(options.cleanupManifest)), "cleanup.json");
  await writeFile(target, JSON.stringify(redactor.redact(cleanup), null, 2) + "\n");
  log(`cleanup ${cleanup.ok ? "complete" : "INCOMPLETE"} → ${target}`);
  return cleanup.ok ? 0 : 3;
}

export { SUITES };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
