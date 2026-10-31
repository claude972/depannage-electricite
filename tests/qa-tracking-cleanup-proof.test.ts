// @ts-nocheck — drives the untyped ESM harness through tsx.
// B1 (QA-CLEANUP-EXTRACT-B1-001) — generic `cleanupWithProof` (scripts/qa-tracking/lib/cleanup-proof.mjs)
// and its tracking binding (scripts/qa-tracking/run.mjs). Real IntentLog, createAuthAdmin, ownership
// proof, durable manifest and cleanupOnly over injected Auth (fake fetch, real Response objects) and a
// fake DB. Both modes: normal (bound cleanupWithProof + Fixtures.save) and --cleanup-manifest.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cleanupWithProof as generic, noSideEffects } from "../scripts/qa-tracking/lib/cleanup-proof.mjs";
import { cleanupWithProof, cleanupOnly, settleTrackingSideEffects } from "../scripts/qa-tracking/run.mjs";
import { runTrackingCleanup } from "../scripts/qa-tracking/lib/cleanup.mjs";
import { createAuthAdmin } from "../scripts/qa-tracking/lib/auth-admin.mjs";
import { IntentLog, intentsVerdict } from "../scripts/qa-tracking/lib/intents.mjs";
import { makeManifestDurable } from "../scripts/qa-tracking/lib/durable.mjs";
import { exitCodeFor } from "../scripts/qa-tracking/lib/finalize.mjs";
import { Fixtures } from "../scripts/qa/lib/fixtures.mjs";
import { createCohort } from "../scripts/qa/lib/cohort.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";

const RUN = "0123456789ab";
const PROJECT = "abcdefghijklmnopqrst";
const cohort = createCohort(RUN);
const EMAIL = cohort.email("artisan-b");
const NOT_FOUND = Object.freeze({ code: 404, error_code: "user_not_found", msg: "User not found" });
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-tracking-b1-"));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyCreated = () => ({ auth_users: [], profiles: [], admin_profiles: [], interventions: [], organizations: [], sites: [], quotes: [], approvals: [], documents: [], storage_paths: [], support_tickets: [] });

function authWith({ byId, pages }) {
  let clock = 0;
  const fetchFn = async (url) => {
    const u = new URL(url);
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(u.pathname);
    return m ? byId(decodeURIComponent(m[1])) : pages(Number(u.searchParams.get("page")));
  };
  return createAuthAdmin({ url: `https://${PROJECT}.supabase.co`, serviceKey: "service-key-not-used-for-real-x", fetchFn, now: () => clock, sleep: async (ms) => { clock += ms; }, search: { perPage: 2, maxPages: 10, attempts: 3, intervalMs: 2000, deadlineMs: 6000 } });
}
const AUTH = {
  lostCreate: (uid) => authWith({ byId: (id) => (id === uid ? json(200, { id: uid, email: EMAIL }) : json(404, NOT_FOUND)), pages: () => json(200, { users: [{ id: uid, email: EMAIL }] }) }),
  unknown: () => authWith({ byId: () => json(404, NOT_FOUND), pages: () => json(200, { nope: true }) }), // malformed list ⇒ unknown
  absent: () => authWith({ byId: () => json(404, NOT_FOUND), pages: () => json(200, { users: [] }) }), // exhaustive absence
};
function fakeDb(manifestPath = null, uid = null) {
  const deletes = [];
  const seen = { diskHadUidAtFirstDelete: null };
  const check = () => {
    if (seen.diskHadUidAtFirstDelete !== null || !manifestPath || !uid) return;
    const disk = JSON.parse(readFileSync(manifestPath, "utf8"));
    seen.diskHadUidAtFirstDelete = disk.created.auth_users.includes(uid) && Boolean(disk.cleanup_attempt);
  };
  return {
    deletes, seen,
    async delete(table, filters) { check(); deletes.push({ table, filters: JSON.stringify(filters) }); },
    async count() { return 0; },
    async storageRemove() {}, async storageList() { return []; },
    async deleteAuthUser(id) { check(); deletes.push({ table: "auth.users", filters: id }); },
    async authUserExists() { return false; },
    async select() { return []; },
  };
}
function normalMode(dir) {
  const fixtures = makeManifestDurable(new Fixtures({ db: {}, cohort, manifestPath: path.join(dir, "manifest.json"), context: { sha: "x", project: PROJECT, base_url: "http://x" }, redactor: createRedactor(), gate: createStopGate() }));
  const intents = new IntentLog(path.join(dir, "intents.json"));
  intents.begin("createAuthUser", "auth.users", EMAIL, "service"); // create announced, reply lost
  return { fixtures, intents };
}
function crashedRun(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ version: 1, run_id: RUN, project: PROJECT, created: emptyCreated() }), { mode: 0o600 });
  const intents = new IntentLog(path.join(dir, "intents.json"));
  intents.begin("createAuthUser", "auth.users", EMAIL, "service");
  const credentials = path.join(dir, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ supabase: { url: `https://${PROJECT}.supabase.co`, project_ref: PROJECT, service_role_key: "k".repeat(40) } }), { mode: 0o600 });
  return { manifestPath, intents, credentials };
}
const cleanupOnlyRun = (dir, db, auth) => {
  const { manifestPath, credentials } = crashedRun(dir);
  return cleanupOnly({ credentials, project: PROJECT, cleanupManifest: manifestPath, timeoutMs: 5000 }, createRedactor(), () => {}, { makeDb: () => db, makeAuth: () => auth }).then((code) => ({ code, manifestPath }));
};

test("B1: runCleanupFn is REQUIRED (refused before any read); settleSideEffects must be a function; persist still mandatory", async () => {
  let reads = 0;
  const intents = { reconcileOpen: async () => { reads++; } };
  await assert.rejects(generic({ db: {}, auth: {}, manifest: { created: {} }, intents, runId: RUN, log: () => {}, persist: async () => {} }), /runCleanupFn/);
  await assert.rejects(generic({ db: {}, auth: {}, manifest: { created: {} }, intents, runId: RUN, log: () => {}, persist: async () => {}, runCleanupFn: async () => ({}), settleSideEffects: 1 }), /settleSideEffects/);
  await assert.rejects(generic({ db: {}, auth: {}, manifest: { created: {} }, intents, runId: RUN, log: () => {}, runCleanupFn: async () => ({}) }), /persist/);
  assert.equal(reads, 0, "nothing read before the parameters are valid");
  assert.equal(typeof noSideEffects, "function");
});

test("B1 order: reconcile → persist → recovery → persist → proof → cleanup_attempt persisted BEFORE the cleanup → cleanup → side effects → result persisted", async () => {
  const dir = tmp();
  const uid = randomUUID();
  const { fixtures, intents } = normalMode(dir);
  const events = [];
  const persist = async () => {
    await fixtures.save();
    events.push(`persist:${fixtures.manifest.cleanup_attempt ? (fixtures.manifest.cleanup_attempt.completed_at ? "result" : "attempt") : fixtures.manifest.recovered ? "recovered" : "base"}`);
  };
  const result = await generic({
    db: fakeDb(), auth: AUTH.lostCreate(uid), manifest: fixtures.manifest, intents, runId: RUN, log: () => {}, persist,
    runCleanupFn: async (db, proven, log) => {
      events.push("cleanup");
      assert.ok(JSON.parse(readFileSync(fixtures.manifestPath, "utf8")).cleanup_attempt, "proof on disk BEFORE the first DELETE");
      return runTrackingCleanup(db, proven, log);
    },
    settleSideEffects: () => events.push("side-effects"),
  });
  assert.deepEqual(events, ["persist:base", "persist:recovered", "persist:attempt", "cleanup", "side-effects", "persist:result"]);
  assert.equal(result.ok, false, "the recovered create stays an open intent ⇒ INCOMPLETE");
});

test("B1 hooks: no-op leaves provider intents OPEN; tracking settlement only after a passing lease readback; a hook error is never PASS", async () => {
  const run = async (settleSideEffects, leaseStatus = "pass") => {
    const intents = new IntentLog(path.join(tmp(), "i.json"));
    const id = intents.begin("provider", "route", "route:x", "provider");
    const result = await generic({ db: fakeDb(), auth: AUTH.absent(), manifest: { created: emptyCreated() }, intents, runId: RUN, log: () => {}, persist: async () => {}, runCleanupFn: async () => ({ ok: true, steps: [{ table: "tracking_provider_leases", status: leaseStatus }] }), settleSideEffects });
    return { result, state: intents.entries.find((e) => e.id === id).state };
  };
  const noop = await run(undefined);
  assert.equal(noop.state, "open");
  assert.equal(noop.result.ok, false);
  const tracked = await run(settleTrackingSideEffects);
  assert.equal(tracked.state, "settled", "settled (outcome reconciled) by the tracking hook");
  assert.equal(tracked.result.ok, true);
  const failedLease = await run(settleTrackingSideEffects, "fail");
  assert.equal(failedLease.state, "open", "no settlement when the lease readback did not pass");
  const intents = new IntentLog(path.join(tmp(), "i.json"));
  const manifest = { created: emptyCreated() };
  const broken = await generic({ db: fakeDb(), auth: AUTH.absent(), manifest, intents, runId: RUN, log: () => {}, persist: async () => {}, runCleanupFn: async () => ({ ok: true, steps: [] }), settleSideEffects: () => { throw new TypeError("hook bug"); } });
  assert.equal(broken.ok, false, "hook error ⇒ INCOMPLETE, never PASS");
  assert.match(broken.error, /side-effect settlement failed/);
  assert.equal(manifest.cleanup_attempt.side_effects_error, "TypeError");
  assert.equal(exitCodeFor({ cleanup: broken }), 3);
});

for (const mode of ["normal", "--cleanup-manifest"]) {
  test(`B1 ${mode}: lost create reply ⇒ UID recovered, persisted with the proof BEFORE the first DELETE, deleted; intent open ⇒ exit 3`, async () => {
    const dir = tmp();
    const uid = randomUUID();
    if (mode === "normal") {
      const { fixtures, intents } = normalMode(dir);
      const db = fakeDb(fixtures.manifestPath, uid);
      const result = await cleanupWithProof({ db, auth: AUTH.lostCreate(uid), manifest: fixtures.manifest, intents, runId: RUN, log: () => {}, persist: () => fixtures.save() });
      assert.equal(db.seen.diskHadUidAtFirstDelete, true);
      assert.ok(db.deletes.some((d) => d.table === "auth.users" && d.filters === uid));
      assert.equal(exitCodeFor({ cleanup: result }), 3);
      assert.equal(intentsVerdict(intents).open.length, 1);
    } else {
      const manifestPath = path.join(dir, "manifest.json");
      const db = fakeDb(manifestPath, uid);
      const { code } = await cleanupOnlyRun(dir, db, AUTH.lostCreate(uid));
      assert.equal(db.seen.diskHadUidAtFirstDelete, true);
      assert.ok(db.deletes.some((d) => d.table === "auth.users" && d.filters === uid));
      assert.equal(code, 3);
    }
  });

  for (const [name, make] of [["UNKNOWN Auth search (malformed list)", AUTH.unknown], ["exhaustive absence", AUTH.absent]]) {
    test(`B1 ${mode}: ${name} ⇒ no Auth deletion, intent stays OPEN, INCOMPLETE, exit 3`, async () => {
      const dir = tmp();
      if (mode === "normal") {
        const { fixtures, intents } = normalMode(dir);
        const db = fakeDb();
        const result = await cleanupWithProof({ db, auth: make(), manifest: fixtures.manifest, intents, runId: RUN, log: () => {}, persist: () => fixtures.save() });
        assert.equal(db.deletes.filter((d) => d.table === "auth.users").length, 0);
        assert.equal(intentsVerdict(intents).open.length, 1, "an absence never closes an intent");
        assert.equal(result.ok, false);
        assert.equal(exitCodeFor({ cleanup: result }), 3);
        assert.ok(JSON.parse(readFileSync(fixtures.manifestPath, "utf8")).cleanup_attempt.completed_at);
      } else {
        const db = fakeDb();
        const { code, manifestPath } = await cleanupOnlyRun(dir, db, make());
        assert.equal(db.deletes.filter((d) => d.table === "auth.users").length, 0);
        assert.equal(JSON.parse(readFileSync(path.join(dir, "intents.json"), "utf8")).intents[0].state, "open");
        assert.equal(code, 3);
        assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).cleanup_attempt.ok, false);
      }
    });
  }
}
