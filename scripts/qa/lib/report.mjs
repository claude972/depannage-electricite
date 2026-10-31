// Scenario bookkeeping and PASS / FAIL / ANOMALY classification.
//  FAIL     : an assertion about expected application behaviour failed (app defect candidate).
//  ANOMALY  : the harness itself failed (Playwright timeout on an action, strict-mode ambiguity,
//             closed target, browser launch) — a selector/headless problem until proven otherwise.
import { AssertionError } from "node:assert";

export class AppDefect extends AssertionError {
  constructor(message, details) {
    super({ message });
    this.name = "AppDefect";
    this.details = details;
  }
}

const ANOMALY_SIGNS = [
  /TimeoutError/i,
  /Timeout \d+ms exceeded/i,
  /strict mode violation/i,
  /Target (page|context|browser) .*closed/i,
  /Target closed/i,
  /Execution context was destroyed/i,
  /browserType\.launch/i,
  /Failed to launch/i,
  /net::ERR_/i,
  /Protocol error/i,
  /frame was detached/i,
];

export function classify(error) {
  if (!error) return "PASS";
  if (error instanceof AssertionError || error?.name === "AssertionError" || error?.name === "AppDefect" || error?.code === "ERR_ASSERTION") return "FAIL";
  const text = `${error?.name || ""} ${error?.message || ""}`;
  if (ANOMALY_SIGNS.some((re) => re.test(text))) return "ANOMALY";
  // Unknown harness exceptions are anomalies too: they are not evidence of an app defect.
  return "ANOMALY";
}

export function createReport(context, redactor, onScenario = () => {}) {
  const scenarios = [];
  const report = {
    context,
    scenarios,
    /** Runs one scenario; records steps, evidence and classification. Never throws. */
    async scenario(suite, name, fn) {
      const entry = { suite, name, status: "PASS", startedAt: new Date().toISOString(), durationMs: 0, steps: [], evidence: [], network: [], error: null, note: null };
      const started = Date.now();
      const handle = {
        async step(label, task) {
          const s = { label, status: "PASS", detail: null };
          try {
            const detail = await task();
            if (detail !== undefined) s.detail = redactor.redact(detail);
          } catch (error) {
            s.status = classify(error);
            s.error = redactor.redact(error);
            entry.steps.push(s);
            throw error;
          }
          entry.steps.push(s);
          return s.detail;
        },
        evidence(path, kind = "browser") {
          entry.evidence.push({ kind, path });
        },
        note(text) {
          entry.note = redactor.redactString(String(text));
        },
        network(list) {
          entry.network = list.map(({ method, path, status }) => ({ method, path, status }));
        },
      };
      try {
        await fn(handle);
      } catch (error) {
        entry.status = classify(error);
        entry.error = redactor.redact(error);
      }
      entry.durationMs = Date.now() - started;
      scenarios.push(entry);
      onScenario(entry);
      return entry;
    },
    summary() {
      const count = (status) => scenarios.filter((s) => s.status === status).length;
      return { total: scenarios.length, pass: count("PASS"), fail: count("FAIL"), anomaly: count("ANOMALY") };
    },
  };
  return report;
}

/** Exit code per contract §1. */
export function exitCode({ fail, anomaly }, cleanupOk) {
  if (fail > 0) return 1;
  if (!cleanupOk) return 3;
  return 0;
}

export function renderSummary(result) {
  const lines = [];
  lines.push(`# QA acceptance run ${result.context.run_id}`, "");
  lines.push(`- base URL: ${result.context.base_url} (${result.context.target})`);
  lines.push(`- sha: ${result.context.sha} (${result.context.sha_verified ? "verified against --app-dir" : "declared by pilot, not verified"})`);
  lines.push(`- project: ${result.context.project}`);
  lines.push(`- started: ${result.context.started_at}; finished: ${result.context.finished_at}`);
  lines.push(`- scenarios: ${result.summary.total}, PASS ${result.summary.pass}, FAIL ${result.summary.fail}, ANOMALY ${result.summary.anomaly}`);
  lines.push(`- cleanup: ${result.cleanup ? (result.cleanup.ok ? "complete (readback 0)" : "INCOMPLETE — manual intervention required, see cleanup.json") : "skipped (--keep-fixtures or nothing created)"}`);
  lines.push("", "| Suite | Scenario | Status | Evidence |", "| --- | --- | --- | --- |");
  for (const s of result.scenarios)
    lines.push(`| ${s.suite} | ${s.name} | ${s.status} | ${s.evidence.map((e) => e.path.split("/").pop()).join(", ") || "—"} |`);
  const failed = result.scenarios.filter((s) => s.status !== "PASS");
  if (failed.length) {
    lines.push("", "## Non-passing scenarios", "");
    for (const s of failed) {
      lines.push(`### ${s.suite} / ${s.name} — ${s.status}`);
      lines.push(s.status === "ANOMALY" ? "Harness/selector/headless anomaly: verify manually; not evidence of an application defect." : "Assertion on expected application behaviour failed: application defect candidate.");
      if (s.error) lines.push("", "```", `${s.error.name}: ${s.error.message}`, "```");
      const lastStep = s.steps[s.steps.length - 1];
      if (lastStep) lines.push(`Last step: ${lastStep.label} (${lastStep.status})`);
      lines.push("");
    }
  }
  lines.push("", "## Not proven by this run", "", "Vercel preview deployment, Stripe payments, OS-level PWA installation, email delivery, visual fidelity to the mock-ups (captures are for human comparison).");
  return lines.join("\n") + "\n";
}
