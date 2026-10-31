import { test } from "node:test";
import assert from "node:assert/strict";
import { adminPreflight, countRealSuperAdmins, realAdminFilter, ADMIN_BLOCKED_REASON } from "../lib/admin-preflight.mjs";
import { createReport, exitCode, renderSummary } from "../lib/report.mjs";
import { emptyManifest, planCleanup } from "../lib/cleanup.mjs";
import { createRedactor } from "../lib/redact.mjs";
import { suite as adminSuite } from "../suites/admin-old-dossiers.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Fake service client: records every call; only `count` answers, any write on profiles is a test failure. */
function fakeDb(realAdmins) {
  const calls = [];
  return {
    calls,
    async count(table, filters) {
      calls.push(["count", table, filters]);
      return table === "profiles" ? realAdmins : 0;
    },
    async select(table, filters) {
      calls.push(["select", table, filters]);
      return [];
    },
    async update(table) {
      calls.push(["update", table]);
      throw new Error("the admin preflight must never update anything");
    },
    async delete(table) {
      calls.push(["delete", table]);
      throw new Error("the admin preflight must never delete anything");
    },
  };
}

test("realAdminFilter: role=admin, cohort ids excluded with not.in, never a name or date", () => {
  assert.deepEqual(realAdminFilter([]), { role: "eq.admin" });
  assert.deepEqual(realAdminFilter([uuid(1), uuid(2), uuid(1), ""]), { role: "eq.admin", id: `not.in.(${uuid(1)},${uuid(2)})` });
});

test("countRealSuperAdmins issues ONE read-only HEAD count on profiles and fails closed on a non-integer", async () => {
  const db = fakeDb(2);
  assert.equal(await countRealSuperAdmins(db, { excludeIds: [uuid(1)] }), 2);
  assert.deepEqual(db.calls, [["count", "profiles", { role: "eq.admin", id: `not.in.(${uuid(1)})` }]]);
  await assert.rejects(countRealSuperAdmins({ count: async () => null }), /exact count of real admins unavailable/);
});

test("adminPreflight: 0 real admins → not ok with the exact BLOCKED reason; 1 → ok; cohort profiles are excluded from the count", async () => {
  const manifest = emptyManifest();
  manifest.created.profiles = [uuid(7)];
  manifest.created.admin_profiles = [uuid(7)];
  const blocked = await adminPreflight(fakeDb(0), manifest);
  assert.deepEqual(blocked, { ok: false, realAdmins: 0, reason: ADMIN_BLOCKED_REASON });
  const db = fakeDb(1);
  const ok = await adminPreflight(db, manifest);
  assert.deepEqual(ok, { ok: true, realAdmins: 1, reason: null });
  assert.match(db.calls[0][2].id, new RegExp(uuid(7)), "cohort profile excluded from the real-admin count");
  assert.ok(db.calls.every((c) => c[0] === "count"), "read-only: no select/update/delete on any admin");
});

test("admin suite: count 0 → BLOCKED recorded, NOTHING created, suite returns; count 1 → proceeds to the QA admin creation", async () => {
  const redactor = createRedactor();
  const events = [];
  const report = createReport({ run_id: "x" }, redactor, { onEvent: (e) => events.push(e) });
  let created = 0;
  const fixtures = {
    manifest: emptyManifest(),
    async createUser(label) {
      created++;
      throw new Error(`proceeded:${label}`); // sentinel: the suite reached its first creation
    },
  };
  await adminSuite.run({ fixtures, db: fakeDb(0), report, redactor, base: "http://localhost:3017", projectRef: "p", browser: null, cohort: {}, out: "/tmp/x" });
  assert.equal(created, 0, "nothing created when blocked");
  const s = report.summary();
  assert.deepEqual(s, { total: 1, pass: 0, fail: 0, anomaly: 0, blocked: 1 });
  assert.equal(report.scenarios[0].status, "BLOCKED");
  assert.match(report.scenarios[0].note, /aucun super administrateur réel, la garde 014 bloquerait le nettoyage/);
  assert.ok(events.some((e) => e.type === "scenario-blocked"));
  assert.equal(exitCode(s, true, null), 0, "a BLOCKED admin suite does not change the exit code of the run");
  assert.match(renderSummary({ context: { run_id: "x", base_url: "b", target: "local", sha: "s", sha_verified: false, project: "p", started_at: "t", finished_at: "t" }, summary: s, scenarios: report.scenarios, cleanup: null, fatal: null }), /BLOCKED 1[\s\S]*Suite not executable in this environment/);
  // With one real admin the suite proceeds: the sentinel from the first creation is the proof.
  const report2 = createReport({ run_id: "y" }, redactor, {});
  await assert.rejects(adminSuite.run({ fixtures, db: fakeDb(1), report: report2, redactor, base: "http://localhost:3017", projectRef: "p", browser: null, cohort: {}, out: "/tmp/x" }), /proceeded:admin-listes/);
  assert.equal(created, 1);
  assert.equal(report2.scenarios[0].status, "PASS");
  assert.match(report2.scenarios[0].name, /admin-preflight/);
});

test("cleanup plan only ever targets manifest ids: a real super admin id can never appear in a delete filter", () => {
  const realAdmin = uuid(99);
  const manifest = emptyManifest();
  manifest.created.profiles = [uuid(7), uuid(8)];
  manifest.created.auth_users = [uuid(7), uuid(8)];
  manifest.created.admin_profiles = [uuid(7)];
  const ops = planCleanup(manifest);
  const allValues = ops.flatMap((op) => op.values);
  assert.ok(allValues.length > 0);
  assert.ok(!allValues.includes(realAdmin));
  const manifestIds = new Set(Object.values(manifest.created).flat());
  for (const value of allValues) assert.ok(manifestIds.has(value), `cleanup value ${value} is not a manifest id`);
  assert.ok(!ops.some((op) => op.ids === "admin_profiles"), "admin_profiles is a marker, never a deletion step");
});
