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

// ---------------------------------------------------------------- stop gate around scenarios and steps
/**
 * Report wrapper bound to the run's stop gate (QA root finding on 947e299):
 *  - a scenario never STARTS once the gate is stopping (logged, not recorded as PASS/FAIL);
 *  - every step checks the gate before running (StopRequestedError → the scenario ends there);
 *  - each running scenario is registered in the gate, so the lifecycle drain WAITS for it before
 *    cleanup (no scenario keeps driving the browser or the API while the cohort is deleted);
 *  - on the FIRST failing step of a scenario, diagnostics are captured from the pages the scenario
 *    opened (private screenshot, visible text of the main region, network summary), then the error
 *    propagates unchanged: a FAIL stays a FAIL.
 */
export function guardReport(report, gate, { log = () => {}, diagnose = async () => null } = {}) {
  const skipped = [];
  return {
    get scenarios() {
      return report.scenarios;
    },
    skipped,
    summary: () => report.summary(),
    /** BLOCKED (prerequisite / environment): recorded as such, never PASS; nothing runs. */
    blocked: (suite, name, reason) => report.blocked(suite, name, reason),
    async scenario(suite, name, fn) {
      if (gate.stopping) {
        skipped.push({ suite, name, reason: gate.reason });
        log(`scenario ${suite} / ${name} not started: run stopping (${gate.reason})`);
        return null;
      }
      const run = report.scenario(suite, name, async (s) => {
        const pages = [];
        let diagnosed = false;
        const handle = {
          ...s,
          pages,
          track(page) {
            pages.push(page);
            return page;
          },
          async step(label, task) {
            gate.check();
            try {
              return await s.step(label, task);
            } catch (error) {
              if (!diagnosed && error?.name !== "StopRequestedError") {
                diagnosed = true;
                try {
                  const files = await diagnose({ suite, scenario: name, step: label, pages });
                  for (const file of files ?? []) s.evidence(file, "diagnostic");
                } catch (diagError) {
                  log(`diagnostics failed for ${suite} / ${name}: ${String(diagError?.message || diagError)}`);
                }
              }
              throw error;
            }
          },
        };
        await fn(handle);
      });
      return gate.register(run);
    },
  };
}

const slug = (text) => String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Diagnostics writer: for each page of the scenario, `<out>/diag-<suite>-<scenario>-<n>.png` and
 * `.json` (mode 0600) with the URL path+hash (no query), visible text of the main region (redacted,
 * bounded) and the network summary already kept by newPage (method/path/status only).
 */
export function createDiagnose({ out, redactor, writeFile, chmod, join, maxText = 20000 }) {
  return async ({ suite, scenario, step, pages }) => {
    const files = [];
    let n = 0;
    for (const h of pages) {
      n++;
      const base = join(out, `diag-${slug(suite)}-${slug(scenario)}-${n}`);
      const record = { suite, scenario, failed_step: step, captured_at: new Date().toISOString(), location: null, main_text: null, network: Array.isArray(h.network) ? h.network.map((e) => ({ method: e.method, path: e.path, status: e.status })) : [], page_errors: h.pageErrors ?? [] };
      try {
        const u = new URL(h.page.url());
        record.location = `${u.pathname}${u.hash}`;
      } catch {}
      try {
        const main = h.page.locator("main");
        const text = (await main.count()) ? await main.first().innerText() : await h.page.locator("body").innerText();
        record.main_text = redactor.redactString(text).slice(0, maxText);
      } catch (error) {
        record.main_text = `[unavailable: ${String(error?.message || error).slice(0, 120)}]`;
      }
      try {
        await h.page.screenshot({ path: `${base}.png`, fullPage: true });
        await chmod(`${base}.png`, 0o600);
        files.push(`${base}.png`);
      } catch {}
      await writeFile(`${base}.json`, JSON.stringify(redactor.redact(record), null, 2) + "\n", { mode: 0o600 });
      files.push(`${base}.json`);
    }
    return files;
  };
}

// ---------------------------------------------------------------- mutations: check right before emission, tracked in the drain
/**
 * `mutation(fn)`: checks the stop gate SYNCHRONOUSLY right before calling `fn` (no await between
 * the check and the emission) and registers the resulting promise in the gate, so the drain waits
 * for its settlement before any cleanup. Every await that precedes a mutation (token read, form
 * filling…) must therefore sit OUTSIDE `fn`, before the call.
 * `mutatingClick(locator, responsePromise)`: same for a UI click that triggers a POST; the drain
 * waits for the click AND the server response.
 */
export function createMutationGuard(gate) {
  const mutation = (fn) => {
    gate.check();
    return gate.register(fn());
  };
  const mutatingClick = (locator, responsePromise) =>
    mutation(async () => {
      await locator.click();
      return responsePromise;
    });
  return { mutation, mutatingClick };
}
