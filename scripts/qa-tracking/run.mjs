#!/usr/bin/env node
// WEB-TRACKING-QA-006 runner — docs/CLAUDE_TRACKING_QA_CONTRACT.md (A1–A5). Executed by ROOT only.
// Importing this module does nothing; network/cloud access happens only in main().
//
// Order (A5.1): build id → anonymous 401/no-store → service HEAD intervention_tracking → [first
// technical account announced by a durable intent, created, authenticated] → unknown-UUID 404 →
// cohort → scenarios. Browser positions are EMULATED (Playwright setGeolocation, fixed public
// coordinates): never a physical GPS proof. Every mutator (service write, tracking POST, click)
// checks the shared stop gate; SIGINT/SIGTERM stops the next scenarios and every mutator, closes
// the browser, drains, proves ownership remotely, then cleans up. Any open intent or unproven id
// ⇒ cleanup INCOMPLETE ⇒ exit 3.
import { mkdirSync, chmodSync, openSync, writeSync, closeSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
import { parseArgs, HELP, selectedProviderScenarios } from "./lib/args.mjs";
import { POSITION_SOURCE, POSITION_DISCLAIMER, REASSIGNMENT_DISCLAIMER } from "./lib/constants.mjs";
import { withPositionRedaction } from "./lib/position-redact.mjs";
import { IntentLog, intentsVerdict } from "./lib/intents.mjs";
import { checkBuildProvenance, checkAnonymous, checkTrackingTable } from "./lib/preflight.mjs";
import { proveOwnership, readOwnership } from "./lib/ownership.mjs";
import { createAuthAdmin } from "./lib/auth-admin.mjs";
import { runTrackingCleanup, cleanupOrder } from "./lib/cleanup.mjs";
import { createTrackingApi } from "./lib/guard.mjs";
import { createReconciler } from "./lib/reconcile.mjs";
import { makeManifestDurable, atomicWriteJsonSync } from "./lib/durable.mjs";
import { captureDiagnostics } from "./lib/diagnostics.mjs";
import { createGuardedCleanup, recoveryCommand, exitCodeFor } from "./lib/finalize.mjs";
import { TrackingFixtures, setupCohort, SCENARIO_RUNNERS, PROVIDER_RUNNERS, createSessionPool } from "./scenarios.mjs";

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

/**
 * Cleanup with remote ownership proof (A5.4). Open createAuthUser intents are recovered by their
 * canonical e-mail (validated before the lookup) so the account is still deleted, but the run
 * stays INCOMPLETE: an outcome that was unknown is never reported as clean.
 */
export async function cleanupWithProof({ db, auth, manifest, intents, runId, log, persist }) {
  // Mandatory durability hook (root review of 4b57800): every UID recovered or proven is written to
  // the manifest on disk AFTER its recovery and BEFORE any DELETE, in normal and --cleanup-manifest
  // modes, so an interruption between recovery and deletion never loses it.
  if (typeof persist !== "function") throw new Error("cleanupWithProof needs a durable persist() hook");
  for (const key of ["auth_users", "profiles", "admin_profiles", "interventions", "organizations", "sites"]) manifest.created[key] ||= [];
  // Unknown outcomes first: readbacks may prove them now that every producer has settled.
  await intents.reconcileOpen(log);
  await persist(); // ids tracked by readbacks are on disk
  const verdict = intentsVerdict(intents);
  const recovered = [];
  for (const open of verdict.open.filter((o) => o.op === "createAuthUser" && o.key)) {
    let found;
    try {
      found = await auth.searchByEmail(open.key, runId);
    } catch (error) {
      log(`intent recovery refused/failed: ${String(error?.message || error)}`);
      continue;
    }
    if (found.state !== "found") {
      recovered.push({ email_slug: open.key.split("@")[0], id: null, search: found.state });
      continue;
    }
    // Recorded for deletion; ownership is re-proven below from a schema-valid read by id.
    for (const key of ["auth_users", "profiles"]) if (!manifest.created[key].includes(found.id)) manifest.created[key].push(found.id);
    recovered.push({ email_slug: open.key.split("@")[0], id: found.id });
    manifest.recovered = [...(manifest.recovered || []).filter((r) => r.id !== found.id), { id: found.id, email_slug: open.key.split("@")[0], at: new Date().toISOString(), intent: "open" }];
    // Durable BEFORE anything else happens. A failed write is NOT caught: no DELETE may follow.
    await persist();
  }
  const remote = await readOwnership(db, auth, manifest);
  const { manifest: proven, unproven } = proveOwnership({ manifest, runId, ...remote });
  manifest.cleanup_attempt = { started_at: new Date().toISOString(), proven: proven.created, unproven: unproven.map((u) => ({ key: u.key, id: u.id, why: u.why })), completed_at: null, ok: null };
  await persist(); // proof recorded on disk BEFORE the first DELETE
  const cleanup = await runTrackingCleanup(db, proven, (e) => log(`cleanup ${String(e.status).padEnd(4)} ${e.table}${e.column ? ` by ${e.column}` : ""}: requested ${e.requested}, remaining ${e.remaining}${e.error ? ` — ${e.error}` : ""}`));
  // Provider calls only leave lease rows: the post-cascade lease readback (0) proves their state.
  const leaseCheck = cleanup.steps.find((st) => st.table === "tracking_provider_leases");
  if (!leaseCheck || leaseCheck.status === "pass") for (const e of intents.open()) if (e.kind === "provider") intents.settle(e.id, "reconciled", { note: "lease-only side effect, lease readback 0" });
  const final = intentsVerdict(intents);
  const ok = cleanup.ok && unproven.length === 0 && final.open.length === 0;
  // The manifest keeps every id (never dropped) and records what was deleted after proof.
  manifest.cleanup_attempt = { ...manifest.cleanup_attempt, completed_at: new Date().toISOString(), ok, deletion_ok: cleanup.ok, open_intents: final.open.length };
  await persist();
  return { ok, steps: cleanup.steps, unproven, open_intents: final.open, recovered, error: ok ? null : [!cleanup.ok && "deletion step failed", unproven.length && `${unproven.length} id(s) not proven to belong to the run`, final.open.length && `${final.open.length} write(s) with unknown outcome`].filter(Boolean).join("; ") };
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
  const redactor = withPositionRedaction(createRedactor());
  const log = (...parts) => process.stdout.write(`[qa-tracking] ${parts.map((p) => (typeof p === "string" ? redactor.redactString(p) : JSON.stringify(redactor.redact(p)))).join(" ")}\n`);
  try {
    if (options.cleanupManifest) return await cleanupOnly(options, redactor, log);
    const target = assertBaseUrl(options.baseUrl, [options.allowBaseUrls]);
    const cohort = createCohort();
    const providers = selectedProviderScenarios(options);
    if (options.dryRun) {
      // No credential is read, no network call is made.
      process.stdout.write(
        JSON.stringify(
          {
            mode: "dry-run (no credentials read, no network call)",
            base_url: new URL(options.baseUrl).origin,
            target,
            sha: options.sha,
            build_id: options.buildId || "REQUIRED for a real run",
            build_provenance: options.mode === "remote" ? "REMOTE: root receipt (loadDeploymentProof, <= 15 min) + served Flight build id (verifyRemoteDeployment), 8 expected values from the CLI" : options.mode === "local" ? "LOCAL: strict Flight parse (servedBuildIdentity), exactly one id equal to --build-id" : "--mode remote|local REQUIRED for a real run",
            project: options.project,
            position_source: POSITION_SOURCE,
            position_disclaimer: POSITION_DISCLAIMER,
            reassignment: REASSIGNMENT_DISCLAIMER,
            preflight: ["build provenance (A7) before any fixture/intent/write; refusal = BLOCKED, exit 2", "anonymous GET tracking → 401 JSON, Cache-Control private no-store", "service HEAD intervention_tracking (019)", "first account announced by a durable intent, then authenticated GET unknown UUID → 404"],
            scenarios: options.scenarios,
            provider_proof: providers.length ? providers : "disabled (opt-in --provider-proof; one real call each, no burst, no retry)",
            cleanup_order: cleanupOrder(),
            cleanup_checks: ["intent recovery by canonical e-mail (validated before lookup)", "remote ownership proof before deletion", "tracking_provider_leases re-read = 0 (cascade)", "tracking_provider_budget never written"],
            order: scenarioOrder(options.scenarios, providers).map((e) => `${e.suite}:${e.name}`),
            diagnostics: "on first failure: diagnostics/<scenario>/<page>.png + .json (0700/0600), same identity, no relogin/reload/navigation, passive network summary, <= 3 pages, <= 20 s",
            outputs: ["run.log 0600", "events.ndjson", "result.json + summary.md", "manifest.json", "intents.json", "cleanup.json", "*.png", "diagnostics/<scenario>/*"],
            exit_codes: { 0: "no FAIL", 1: "FAIL or FATAL", 2: "preflight refusal", 3: "cleanup incomplete / unknown outcome / unproven id", 130: "interrupted, cleanup complete" },
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    const credentials = await loadCredentials(options.credentials);
    redactor.add(credentials.supabase.serviceKey);
    assertProject(options.project, credentials);
    assertBaseUrl(options.baseUrl, [options.allowBaseUrls, credentials.allowedBaseUrls]);
    const sha = await verifySha(options.sha, options.appDir);
    const outDir = await assertOutOutsideRepo(options.out || defaultOutDir(options.sha, cohort.runId));
    let playwright;
    try {
      playwright = await loadPlaywright(options.playwrightPath);
    } catch (error) {
      throw new PreflightError(error.message);
    }
    configureBrowser({ timeoutMs: options.timeoutMs });
    const base = new URL(options.baseUrl).origin;
    const db = createServiceClient({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs });
    // ---- Preflight BEFORE any fixture (A5.1). A refusal here creates nothing.
    // A7: build provenance is the first network check (REMOTE: root receipt + served Flight via the
    // reviewed helper; LOCAL: strict parse). Nothing written, no service request before it.
    const build = await checkBuildProvenance({ options, origin: base, fetchFn: fetch, timeoutMs: options.timeoutMs });
    log(`build provenance ${build.mode}: ${build.servedBuildId} (${build.provenance})`);
    const anonymous = await checkAnonymous(fetch, base, options.timeoutMs);
    const table = await checkTrackingTable(db);

    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    chmodSync(outDir, 0o700);
    const restoreTee = installTee(outDir, redactor);
    const context = { run_id: cohort.runId, sha: options.sha, sha_verified: sha.verified, build, project: options.project, base_url: base, target, position_source: POSITION_SOURCE, position_disclaimer: POSITION_DISCLAIMER, physical_gps: "not exercised", preflight: { anonymous, table }, scenarios: options.scenarios, provider_proof: providers, out: outDir, started_at: new Date().toISOString(), finished_at: null };
    log(`run ${cohort.runId} → ${outDir}; ${POSITION_DISCLAIMER}`);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(outDir, "intents.json"));
    const fixtures = new Fixtures({ db, cohort, manifestPath: path.join(outDir, "manifest.json"), context: { sha: options.sha, project: options.project, base_url: base }, redactor, gate });
    // Manifest (and intents, above) durable on disk BEFORE any creation or lookup (P2-2).
    makeManifestDurable(fixtures);
    const auth = createAuthAdmin({ url: credentials.supabase.url, serviceKey: credentials.supabase.serviceKey, timeoutMs: options.timeoutMs });
    const tf = new TrackingFixtures({ fixtures, intents, cohort, gate, auth });
    const reconcile = createReconciler(db);
    const recovery = recoveryCommand({ outDir, project: options.project });
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
      await writeFile(path.join(outDir, "summary.md"), `${renderSummary(result)}\n\n> ${POSITION_DISCLAIMER}\n> Preuve GPS physique : non exercée.\n`, { mode: 0o600 });
    }
    let browser = null;
    let pool = null;
    const lifecycle = createLifecycle({
      keepFixtures: options.keepFixtures,
      log,
      gate,
      drainTimeoutMs: options.timeoutMs,
      // Harness-owned guard: undrained producer ⇒ zero deletion, zero Auth read, manifest/intents untouched.
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
          try {
            await fixtures.collectIndirect();
          } catch (error) {
            log(`indirect collection failed: ${error.message}`);
          }
          return cleanupWithProof({ db, auth, manifest: fixtures.manifest, intents, runId: cohort.runId, log, persist: () => fixtures.save() });
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
        process.stderr.write(`[qa-tracking] ${signal}: next scenarios and every mutator stopped; closing the browser, draining, proving ownership, cleaning up\n`);
        appendEvent({ at: new Date().toISOString(), type: "signal", signal });
      },
      onSecondSignal: (signal) => {
        process.stderr.write(`[qa-tracking] second ${signal}: cleanup aborted; manifest and intents kept — recover with --cleanup-manifest\n`);
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
      browser = await launchBrowser(playwright, { headless: !options.headed, chromiumPath: options.chromiumPath });
      pool = createSessionPool({ browser, base, projectRef: options.project, redactor, gate, intents, reconcile, onEvent: appendEvent });
      const ctx = { base, projectRef: options.project, out: outDir, gate, intents, tf, fixtures, cohort, redactor, log, state: {}, api: createTrackingApi({ gate, intents, reconcile }), ...bindPool(pool) };
      const setup = await gate.register(
        report.scenario("setup", "cohort + authenticated 404 preflight", async (s) => {
          try {
            s.note(JSON.stringify(await setupCohort(ctx)));
          } catch (error) {
            if (error instanceof PreflightError) preflightLate = error;
            throw error;
          }
        }),
      );
      if (setup.status === "PASS") {
        // A8 §6: the provider proofs run BEFORE T19 (its logout is global and revokes the client).
        // A8 §1: bounded diagnostics at the first failure, on the pages the scenario used.
        const diagnose = (name, s) => captureDiagnostics({ scenario: name, handles: pool.diagnosticHandles(), out: outDir, redactor, gate }).then((d) => {
          for (const file of d.files || []) s.evidence(file, "diagnostics");
          if (d.skipped || d.truncated || d.errors?.length) log(`diagnostics ${name}: ${d.skipped || ""}${d.truncated ? " truncated" : ""} ${(d.errors || []).join(",")}`.trim());
        });
        for (const { suite, name } of scenarioOrder(options.scenarios, providers)) {
          if (lifecycle.stopping) break;
          const runner = suite === "tracking" ? SCENARIO_RUNNERS[name] : PROVIDER_RUNNERS[name];
          pool.beginScenario();
          await runOne(report, suite, name, (s) => runner(ctx, s), persist, gate, diagnose);
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
    }
    return process.exitCode;
  } catch (error) {
    if (error instanceof PreflightError) {
      process.stderr.write(`refused: ${redactor.redactString(error.message)}\n`);
      return 2;
    }
    const info = redactor.redactError(error);
    process.stderr.write(`fatal: ${info.name}: ${info.message}\n`);
    return 2;
  }
}

function bindPool(pool) {
  return { session: (l, u) => pool.session(l, u), freshSession: (l, u) => pool.freshSession(l, u), closeSession: (l) => pool.closeSession(l), revokeUser: (id) => pool.revokeUser(id), rebind: (l, u) => pool.rebind(l, u) };
}

/** A8 §6: tracking scenarios except T19, then the provider proofs, then T19 last (global logout). */
export function scenarioOrder(scenarios, providers = []) {
  const last = scenarios.filter((n) => n === "T19");
  return [...scenarios.filter((n) => n !== "T19").map((name) => ({ suite: "tracking", name })), ...providers.map((name) => ({ suite: "provider", name })), ...last.map((name) => ({ suite: "tracking", name }))];
}

/** A precondition refused by a guard (e.g. reassignment simulation) is BLOCKED, never PASS. */
export async function runOne(report, suite, name, fn, persist = async () => {}, gate = null, diagnose = null) {
  if (gate?.stopping) return null; // never START a scenario once the run is stopping
  let blocked = null;
  const scenarioRun = report.scenario(suite, name, async (s) => {
    try {
      await fn(s);
    } catch (error) {
      // A8 §1: first failure, pages still open, same identity; never changes the verdict.
      if (diagnose) {
        try {
          await diagnose(name, s);
        } catch {}
      }
      if (error?.blocked) {
        blocked = String(error.message);
        return;
      }
      throw error;
    }
  });
  // The running scenario is part of the drain: cleanup never starts while it still drives anything.
  const entry = await (gate ? gate.register(scenarioRun) : scenarioRun);
  if (blocked) {
    entry.status = "BLOCKED";
    entry.note = blocked;
    await persist();
  }
  return entry;
}

/** --cleanup-manifest mode. `deps` (makeDb, makeAuth) are injectable for offline tests. */
export async function cleanupOnly(options, redactor, log, deps = {}) {
  const credentials = await loadCredentials(options.credentials);
  redactor.add(credentials.supabase.serviceKey);
  assertProject(options.project, credentials);
  const manifest = JSON.parse(await readFile(options.cleanupManifest, "utf8"));
  if (manifest.project && manifest.project !== options.project) throw new PreflightError(`manifest was created for project ${manifest.project}`);
  if (!/^[0-9a-f]{12}$/.test(String(manifest.run_id))) throw new PreflightError("manifest has no valid run_id");
  const intentsFile = path.join(path.dirname(path.resolve(options.cleanupManifest)), "intents.json");
  const intents = new IntentLog(intentsFile, { persist: false });
  if (existsSync(intentsFile)) intents.entries = JSON.parse(readFileSync(intentsFile, "utf8")).intents || [];
  else log("intents.json missing next to the manifest: outcomes unknown, cleanup will be INCOMPLETE");
  const db = (deps.makeDb || ((c) => createServiceClient({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs })))(credentials);
  const auth = (deps.makeAuth || ((c) => createAuthAdmin({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, timeoutMs: options.timeoutMs })))(credentials);
  const manifestFile = path.resolve(options.cleanupManifest);
  const result = await cleanupWithProof({ db, auth, manifest, intents, runId: manifest.run_id, log, persist: () => atomicWriteJsonSync(manifestFile, manifest) });
  if (!existsSync(intentsFile)) {
    result.ok = false;
    result.error = [result.error, "intents.json missing"].filter(Boolean).join("; ");
  }
  const target = path.join(path.dirname(path.resolve(options.cleanupManifest)), "cleanup.json");
  await writeFile(target, JSON.stringify(redactor.redact(result), null, 2) + "\n", { mode: 0o600 });
  log(`cleanup ${result.ok ? "complete" : "INCOMPLETE"} → ${target}`);
  return result.ok ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code ?? process.exitCode ?? 0;
  });
}
