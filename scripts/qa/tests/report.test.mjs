import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, createReport, exitCode, renderSummary, AppDefect } from "../lib/report.mjs";
import { createRedactor } from "../lib/redact.mjs";

test("assertion failures are FAIL (application defect candidates)", () => {
  let error;
  try {
    assert.equal(1, 2);
  } catch (e) {
    error = e;
  }
  assert.equal(classify(error), "FAIL");
  assert.equal(classify(new AppDefect("control missing")), "FAIL");
});

test("Playwright timeouts, strict-mode and closed targets are ANOMALY", () => {
  const timeout = new Error("locator.click: Timeout 30000ms exceeded.");
  timeout.name = "TimeoutError";
  assert.equal(classify(timeout), "ANOMALY");
  assert.equal(classify(new Error("strict mode violation: getByRole('button') resolved to 2 elements")), "ANOMALY");
  assert.equal(classify(new Error("Target page, context or browser has been closed")), "ANOMALY");
  assert.equal(classify(new Error("something unexpected")), "ANOMALY");
  assert.equal(classify(null), "PASS");
});

test("scenario bookkeeping records steps, evidence and status; secrets are redacted", async () => {
  const redactor = createRedactor(["generated-password-xyz"]);
  const seen = [];
  const report = createReport({ run_id: "r" }, redactor, (entry) => seen.push(entry.status));
  await report.scenario("suite", "passes", async (s) => {
    await s.step("one", async () => ({ password: "generated-password-xyz", note: "uses generated-password-xyz" }));
    s.evidence("/tmp/x.png");
    s.network([{ method: "GET", path: "/api/workspace", status: 200, headers: { cookie: "secret" } }]);
  });
  await report.scenario("suite", "fails", async (s) => {
    await s.step("two", async () => {
      assert.equal("a", "b");
    });
  });
  await report.scenario("suite", "anomaly", async (s) => {
    await s.step("three", async () => {
      const e = new Error("Timeout 5000ms exceeded");
      e.name = "TimeoutError";
      throw e;
    });
  });
  assert.deepEqual(seen, ["PASS", "FAIL", "ANOMALY"]);
  assert.deepEqual(report.summary(), { total: 3, pass: 1, fail: 1, anomaly: 1 });
  const first = report.scenarios[0];
  assert.deepEqual(first.steps[0].detail, { password: "[REDACTED]", note: "uses [REDACTED]" });
  assert.deepEqual(first.network, [{ method: "GET", path: "/api/workspace", status: 200 }]);
  assert.deepEqual(first.evidence, [{ kind: "browser", path: "/tmp/x.png" }]);
  assert.equal(report.scenarios[1].steps[0].status, "FAIL");
});

test("exit codes follow the contract", () => {
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, true), 0);
  assert.equal(exitCode({ fail: 0, anomaly: 2 }, true), 0);
  assert.equal(exitCode({ fail: 1, anomaly: 0 }, true), 1);
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, false), 3);
  assert.equal(exitCode({ fail: 1, anomaly: 0 }, false), 1);
});

test("summary names the target, the sha verification state and non-proofs", () => {
  const text = renderSummary({
    context: { run_id: "r", base_url: "http://localhost:3017", target: "local", sha: "a".repeat(40), sha_verified: false, project: "p", started_at: "s", finished_at: "f" },
    summary: { total: 1, pass: 0, fail: 1, anomaly: 0 },
    scenarios: [{ suite: "x", name: "y", status: "FAIL", evidence: [{ path: "/out/a.png" }], steps: [{ label: "l", status: "FAIL" }], error: { name: "AssertionError", message: "m" } }],
    cleanup: { ok: false },
  });
  assert.match(text, /declared by pilot, not verified/);
  assert.match(text, /INCOMPLETE/);
  assert.match(text, /application defect candidate/);
  assert.match(text, /Vercel preview deployment, Stripe payments, OS-level PWA/);
});
