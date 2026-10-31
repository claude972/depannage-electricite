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

test("scenario bookkeeping records steps, evidence and status; secrets are redacted; events emitted per step", async () => {
  const redactor = createRedactor(["generated-password-xyz"]);
  const seen = [];
  const events = [];
  const report = createReport({ run_id: "r" }, redactor, { onScenario: (entry) => seen.push(entry.status), onEvent: (e) => events.push(e) });
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
  assert.deepEqual(report.summary(), { total: 3, pass: 1, fail: 1, anomaly: 1, blocked: 0 });
  const first = report.scenarios[0];
  assert.deepEqual(first.steps[0].detail, { password: "[REDACTED]", note: "uses [REDACTED]" });
  assert.deepEqual(first.network, [{ method: "GET", path: "/api/workspace", status: 200 }]);
  assert.deepEqual(first.evidence, [{ kind: "browser", path: "/tmp/x.png" }]);
  assert.equal(report.scenarios[1].steps[0].status, "FAIL");
  assert.ok(report.scenarios[2].error.stack === null || typeof report.scenarios[2].error.stack === "string");
  const types = events.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t === "scenario-start").length, 3);
  assert.deepEqual(types.filter((t) => t === "step").length, 3);
  assert.ok(events.every((e) => typeof e.at === "string"));
  assert.ok(!JSON.stringify(events).includes("generated-password-xyz"));
});

test("a route handler error turns an otherwise passing scenario into ANOMALY (never unhandled)", async () => {
  const redactor = createRedactor();
  const report = createReport({ run_id: "r" }, redactor);
  await report.scenario("suite", "route failure", async (s) => {
    const e = new Error("route.fetch: Timeout 30000ms exceeded. cookie: sb-x-auth-token=secretvalue");
    e.name = "TimeoutError";
    s.routeError(e, "POST /api/support");
    await s.step("ok step", async () => 1);
  });
  const entry = report.scenarios[0];
  assert.equal(entry.status, "ANOMALY");
  assert.equal(entry.routeErrors.length, 1);
  assert.equal(entry.routeErrors[0].where, "POST /api/support");
  assert.ok(!JSON.stringify(entry).includes("secretvalue"));
  assert.match(entry.error.message, /route handler error/);
});

test("exit codes follow the contract (FAIL 1, FATAL 1, cleanup incomplete 3)", () => {
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, true), 0);
  assert.equal(exitCode({ fail: 0, anomaly: 2 }, true), 0);
  assert.equal(exitCode({ fail: 1, anomaly: 0 }, true), 1);
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, false), 3);
  assert.equal(exitCode({ fail: 1, anomaly: 0 }, false), 1);
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, true, { origin: "unhandledRejection" }), 1);
  assert.equal(exitCode({ fail: 0, anomaly: 0 }, false, { origin: "unhandledRejection" }), 3);
});

test("summary names the target, the sha verification state, a FATAL and non-proofs", () => {
  const text = renderSummary({
    context: { run_id: "r", base_url: "http://localhost:3017", target: "local", sha: "a".repeat(40), sha_verified: false, project: "p", started_at: "s", finished_at: "f" },
    summary: { total: 1, pass: 0, fail: 1, anomaly: 0 },
    fatal: { origin: "unhandledRejection", error: { name: "TimeoutError", message: "m" } },
    scenarios: [{ suite: "x", name: "y", status: "FAIL", evidence: [{ path: "/out/a.png" }], steps: [{ label: "l", status: "FAIL" }], error: { name: "AssertionError", message: "m" }, routeErrors: [] }],
    cleanup: { ok: false },
  });
  assert.match(text, /declared by pilot, not verified/);
  assert.match(text, /INCOMPLETE/);
  assert.match(text, /FATAL: unhandledRejection/);
  assert.match(text, /application defect candidate/);
  assert.match(text, /Vercel preview deployment, Stripe payments, OS-level PWA/);
});
