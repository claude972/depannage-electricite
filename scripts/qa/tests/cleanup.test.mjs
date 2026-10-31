import { test } from "node:test";
import assert from "node:assert/strict";
import { CLEANUP_STEPS, orderViolations, planCleanup, emptyManifest, runCleanup, MANIFEST_KEYS } from "../lib/cleanup.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("the cleanup order deletes children before parents and auth users last", () => {
  assert.deepEqual(orderViolations(CLEANUP_STEPS), []);
});

test("order violations are detected", () => {
  const broken = [...CLEANUP_STEPS].filter((s) => s.table !== "support_events");
  broken.splice(broken.length - 1, 0, { kind: "table", table: "support_events", column: "ticket_id", ids: "support_tickets" });
  const violations = orderViolations(broken);
  assert.ok(violations.some((v) => /support_events must be deleted before support_tickets/.test(v)));
});

test("the mission's required sequence is respected", () => {
  const tables = CLEANUP_STEPS.filter((s) => s.kind === "table").map((s) => s.table);
  const idx = (t) => tables.indexOf(t);
  const storage = CLEANUP_STEPS.findIndex((s) => s.kind === "storage");
  assert.ok(idx("support_events") < idx("support_messages") && idx("support_messages") < idx("support_tickets"));
  assert.ok(idx("support_tickets") < idx("quote_drafts"));
  assert.ok(idx("quote_drafts") < CLEANUP_STEPS.findIndex((s) => s.table === "documents"));
  assert.ok(storage < CLEANUP_STEPS.findIndex((s) => s.table === "documents"));
  assert.ok(idx("documents") < idx("interventions"));
  assert.ok(idx("quotes") < idx("interventions") && idx("messages") < idx("interventions"));
  assert.ok(idx("approvals") < idx("quotes"), "approvals (FK quote_id) must precede quotes");
  assert.ok(idx("approvals") < idx("sites") && idx("approval_rules") < idx("sites"));
  assert.ok(idx("interventions") < idx("organization_member_site_grants"));
  assert.ok(idx("organization_member_site_grants") < idx("organization_member_site_scopes"));
  assert.ok(idx("organization_member_site_scopes") < idx("organization_members"));
  assert.ok(idx("organization_members") < idx("sites") && idx("sites") < idx("organizations"));
  assert.ok(idx("organizations") < idx("profiles"));
  assert.equal(CLEANUP_STEPS.at(-1).kind, "auth");
});

test("planCleanup skips empty lists, dedupes ids and refuses non-UUID ids", () => {
  const manifest = emptyManifest();
  manifest.created.support_tickets = [uuid(1), uuid(1)];
  manifest.created.profiles = [uuid(2)];
  manifest.created.auth_users = [uuid(2)];
  const ops = planCleanup(manifest);
  const tables = ops.map((o) => o.table || o.kind);
  assert.ok(tables.includes("support_events") && tables.includes("profiles") && tables.includes("auth"));
  assert.ok(!tables.includes("interventions"));
  assert.deepEqual(ops.find((o) => o.table === "support_tickets").values, [uuid(1)]);
  manifest.created.interventions = ["*"];
  assert.throws(() => planCleanup(manifest), /non-UUID/);
});

test("empty manifest lists every tracked key", () => {
  const m = emptyManifest({ sha: "x" });
  assert.deepEqual(Object.keys(m.created).sort(), [...MANIFEST_KEYS].sort());
  assert.equal(m.sha, "x");
});

test("runCleanup deletes by exact id lists, reads back, and reports a remaining row as failure", async () => {
  const calls = [];
  const remaining = { profiles: 1 };
  const db = {
    async delete(table, filters) {
      calls.push(["delete", table, filters]);
    },
    async count(table, filters) {
      calls.push(["count", table, filters]);
      return remaining[table] || 0;
    },
    async storageRemove() {},
    async storageList() {
      return [];
    },
    async deleteAuthUser(id) {
      calls.push(["deleteAuthUser", id]);
    },
    async authUserExists() {
      return false;
    },
  };
  const manifest = emptyManifest();
  manifest.created.profiles = [uuid(7)];
  manifest.created.auth_users = [uuid(7)];
  manifest.created.storage_paths = [`${uuid(7)}/photo.png`];
  const result = await runCleanup(db, manifest);
  assert.equal(result.ok, false);
  const profiles = result.steps.find((s) => s.table === "profiles");
  assert.equal(profiles.status, "fail");
  assert.equal(profiles.remaining, 1);
  const auth = result.steps.find((s) => s.kind === "auth");
  assert.equal(auth.status, "pass");
  // every delete carries an `in.(...)` filter with the exact id — never an unfiltered delete
  for (const [kind, , filters] of calls.filter((c) => c[0] === "delete")) {
    const value = Object.values(filters)[0];
    assert.match(value, /^in\.\(/);
    assert.ok(value.includes(uuid(7)));
    assert.equal(kind, "delete");
  }
});

test("optional tables absent from the schema are skipped, not failed", async () => {
  const db = {
    async delete(table) {
      if (table === "compliance_records") throw new Error('relation "public.compliance_records" does not exist (42P01)');
    },
    async count() {
      return 0;
    },
    async storageRemove() {},
    async storageList() {
      return [];
    },
    async deleteAuthUser() {},
    async authUserExists() {
      return false;
    },
  };
  const manifest = emptyManifest();
  manifest.created.sites = [uuid(3)];
  const result = await runCleanup(db, manifest);
  assert.equal(result.ok, true);
  assert.equal(result.steps.find((s) => s.table === "compliance_records").status, "skipped");
  assert.equal(result.steps.find((s) => s.table === "approvals").status, "pass");
});
