// Suite loop + single finalisation, separated from run.mjs so it can be driven with fakes:
// a suite that throws is recorded as a scenario (never silently dropped), a stopping lifecycle
// skips the remaining suites, the browser is stopped BEFORE the finalisation (no late route
// callback can fire during deletion) and the exit code follows the shared rule
// (FAIL → 1, cleanup not ok → 3, FATAL → 1, else 0).
import { exitCode, classify } from "../../qa/lib/report.mjs";

/**
 * @param {object} input
 * @param {Array<{name:string, description:string, needsCredentials:boolean, run(ctx):Promise<void>}>} input.suites
 * @param {object} input.ctx     context handed to every suite (base, fixtures, db, browser, report, …)
 * @param {object} input.lifecycle  createLifecycle() result (finalize, stopping, fatal, gate)
 * @param {object} input.report  createReport() result (scenario, summary)
 * @param {(suite:object, ctx:object)=>Promise<void>} [input.runSuite]  defaults to suite.run(ctx)
 * @param {()=>Promise<void>} [input.stopBrowser]
 * @param {(line:string)=>void} [input.log]
 * @returns {Promise<{code:number, summary:object, cleanup:object|null, reason:string}>}
 */
export async function orchestrate({ suites, ctx, lifecycle, report, runSuite = (suite, c) => suite.run(c), stopBrowser = async () => {}, log = () => {}, PreflightError = Error }) {
  try {
    for (const suite of suites) {
      if (lifecycle.stopping) {
        log(`suite ${suite.name} skipped: run stopping (${lifecycle.gate?.reason ?? "finalising"})`);
        break;
      }
      log(`suite ${suite.name}: ${suite.description}`);
      if (suite.needsCredentials && !ctx.fixtures) {
        await report.scenario(suite.name, "preconditions", async () => {
          throw new PreflightError("suite needs credentials");
        });
        continue;
      }
      try {
        await runSuite(suite, ctx);
      } catch (error) {
        await report.scenario(suite.name, "suite setup", async () => {
          throw error;
        });
        log(`suite ${suite.name} aborted: ${classify(error)} ${String(error?.message || error)}`);
        if (lifecycle.stopping) break;
      }
    }
  } finally {
    await stopBrowser();
  }
  const { cleanup, reason } = await lifecycle.finalize("completed");
  const summary = report.summary();
  const code = exitCode(summary, cleanup ? cleanup.ok : true, lifecycle.fatal);
  return { code, summary, cleanup, reason };
}

/** Markdown lines listing what a run did NOT exercise (contract §8), appended to summary.md. */
export const NOT_EXERCISED = [
  "Enterprise documents view (#approval/<id>), amendment reject/withdraw, incomplete issuer (QD001): not exercised (minimal cohort).",
  "SLA calendars, pauses/resume, contract grids (publication), two-tab UI concurrency: not exercised; stale-version refusal proven through the API only.",
  "Payments, Stripe, email/SMS/push, administration, migration 014 data, native/EAS, Vercel preview: out of scope, never simulated as successful.",
  "Expired validity (D2) and artisan reassignment are synthetic states set by the service role and labelled QA: 'état simulé, non produit par le circuit utilisateur'.",
  "Captures are for human comparison only.",
];
