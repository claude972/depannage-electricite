// @ts-nocheck — drives the untyped ESM harness (scripts/qa-tracking/*.mjs) through tsx.
// WEB-TRACKING-QA-006 — root review P2-c / P2-d: Auth admin reads and the lost-create search.
// Real harness code (createAuthAdmin, TrackingFixtures, cleanupWithProof, IntentLog) over a fake
// `fetch` returning real Response objects and a controllable clock. No network, no credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createAuthAdmin, parseUserBody } from "../scripts/qa-tracking/lib/auth-admin.mjs";
import { readOwnership, proveOwnership } from "../scripts/qa-tracking/lib/ownership.mjs";
import { IntentLog, intentsVerdict } from "../scripts/qa-tracking/lib/intents.mjs";
import { TrackingFixtures } from "../scripts/qa-tracking/scenarios.mjs";
import { cleanupWithProof } from "../scripts/qa-tracking/run.mjs";
import { exitCodeFor } from "../scripts/qa-tracking/lib/finalize.mjs";
import { createCohort } from "../scripts/qa/lib/cohort.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";

const RUN = "0123456789ab";
const cohort = createCohort(RUN);
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-tracking-auth-"));
const json = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const other = (n) => ({ id: randomUUID(), email: `someone-${n}@example.org` });

/** Fake Auth admin endpoint: `users(id)` answers GET by id; `pages(attempt, page)` answers list pages. */
const NOT_FOUND = Object.freeze({ code: 404, error_code: "user_not_found", msg: "User not found" });
function fakeAuth({ byId = () => json(404, NOT_FOUND), pages = () => json(200, { users: [] }) } = {}) {
  let clock = 0;
  const calls = { byId: 0, list: [] };
  const attemptOf = { n: 0 };
  const fetchFn = async (url) => {
    const u = new URL(url);
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(u.pathname);
    if (m) {
      calls.byId++;
      return byId(decodeURIComponent(m[1]));
    }
    const page = Number(u.searchParams.get("page"));
    if (page === 1) attemptOf.n++;
    calls.list.push({ attempt: attemptOf.n, page });
    return pages(attemptOf.n, page, Number(u.searchParams.get("per_page")));
  };
  const auth = createAuthAdmin({ url: "https://project.supabase.co", serviceKey: "service-key-not-used-for-real-x", fetchFn, now: () => clock, sleep: async (ms) => { clock += ms; }, search: { perPage: 2, maxPages: 10, attempts: 3, intervalMs: 2000, deadlineMs: 6000 } });
  return { auth, calls, advance: (ms) => (clock += ms) };
}

function fakeDb() {
  const deletes = [];
  return {
    deletes,
    async delete(table, filters) { deletes.push({ table, filters: JSON.stringify(filters) }); },
    async count() { return 0; },
    async storageRemove() {},
    async storageList() { return []; },
    async deleteAuthUser(id) { deletes.push({ table: "auth.users", filters: id }); },
    async authUserExists() { return false; },
    async select() { return []; },
  };
}
const emptyManifest = () => ({ run_id: RUN, created: { auth_users: [], profiles: [], admin_profiles: [], interventions: [], organizations: [], sites: [], quotes: [], approvals: [], documents: [], storage_paths: [], support_tickets: [] } });

test("P2-c — a 200 with a malformed body is UNKNOWN (never absent) and ownership is refused; nothing is deleted", async () => {
  const id = randomUUID();
  for (const body of ["{not json", {}, { id }, { email: cohort.email("client") }, { id: "not-a-uuid", email: cohort.email("client") }]) {
    const { auth } = fakeAuth({ byId: () => json(200, body) });
    const read = await auth.readUser(id);
    assert.equal(read.state, "unknown", JSON.stringify(body));
  }
  const { auth } = fakeAuth({ byId: () => json(200, {}) });
  const manifest = emptyManifest();
  manifest.created.auth_users.push(id);
  manifest.created.profiles.push(id);
  const remote = await readOwnership(fakeDb(), auth, manifest);
  assert.equal(remote.emails.get(id), undefined, "unknown, not null (absent)");
  const { manifest: proven, unproven } = proveOwnership({ manifest, runId: RUN, ...remote });
  assert.deepEqual(proven.created.profiles, []);
  assert.equal(unproven[0].why, "Auth read unknown (error or malformed body)");
  const db = fakeDb();
  const result = await cleanupWithProof({ db, auth, manifest, intents: new IntentLog(path.join(tmp(), "i.json")), runId: RUN, log: () => {}, persist: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(db.deletes.some((d) => d.filters.includes(id)), false, "an id not proven owned is never deleted");
  assert.equal(exitCodeFor({ cleanup: result }), 3);
  // Only a REAL 404 proves absence.
  assert.equal((await fakeAuth({ byId: () => json(404, NOT_FOUND) }).auth.readUser(id)).state, "absent");
  // A8 §5e: only the exact LEGACY body observed by ROOT proves absence; every other 404 is UNKNOWN.
  for (const body of [{}, { ...NOT_FOUND, extra: 1 }, { ...NOT_FOUND, error_code: "not_found" }, { ...NOT_FOUND, msg: "" }, { code: "user_not_found", message: "User not found" }, { code: "404", error_code: "user_not_found", msg: "x" }, null, []]) {
    assert.equal((await fakeAuth({ byId: () => json(404, body) }).auth.readUser(id)).state, "unknown", JSON.stringify(body));
  }
  assert.equal((await fakeAuth({ byId: () => new Response("<html>Not Found</html>", { status: 404 }) }).auth.readUser(id)).state, "unknown");
  assert.equal((await fakeAuth({ byId: () => new Response("", { status: 404 }) }).auth.readUser(id)).state, "unknown");
  assert.equal((await fakeAuth({ byId: () => json(500, NOT_FOUND) }).auth.readUser(id)).state, "unknown");
  assert.equal((await fakeAuth({ byId: () => json(200, NOT_FOUND) }).auth.readUser(id)).state, "unknown");
  assert.equal((await fakeAuth({ byId: () => json(500, {}) }).auth.readUser(id)).state, "unknown");
});

test("P2-c — a 200 with a mismatched id is UNKNOWN and a non-canonical e-mail is refused", async () => {
  const id = randomUUID();
  assert.equal(parseUserBody({ id: randomUUID(), email: cohort.email("client") }, id).ok, false);
  const { auth } = fakeAuth({ byId: () => json(200, { id: randomUUID(), email: cohort.email("client") }) });
  assert.equal((await auth.readUser(id)).state, "unknown");
  const victim = fakeAuth({ byId: (asked) => json(200, { id: asked, email: "victim@example.org" }) }).auth;
  const manifest = emptyManifest();
  manifest.created.profiles.push(id);
  const { manifest: proven, unproven } = proveOwnership({ manifest, runId: RUN, ...(await readOwnership(fakeDb(), victim, manifest)) });
  assert.deepEqual(proven.created.profiles, []);
  assert.equal(unproven[0].why, "e-mail is not a canonical QA e-mail of this run");
  // Another run's canonical e-mail is refused too.
  const otherRun = fakeAuth({ byId: (asked) => json(200, { id: asked, email: "qa-ffffffffffff-client@qa.invalid" }) }).auth;
  assert.equal(proveOwnership({ manifest, runId: RUN, ...(await readOwnership(fakeDb(), otherRun, manifest)) }).unproven.length, 1);
});

/** A create whose response is lost (transport error after emission): the intent stays open with its readback. */
async function lostCreate(auth) {
  const intents = new IntentLog(path.join(tmp(), "intents.json"));
  const manifest = emptyManifest();
  const fixtures = {
    manifest,
    async createUser() {
      throw Object.assign(new Error("fetch failed"), { name: "FetchError" });
    },
    async track(key, ...ids) {
      for (const id of ids) if (!manifest.created[key].includes(id)) manifest.created[key].push(id);
    },
    db: {},
  };
  const tf = new TrackingFixtures({ fixtures, intents, cohort, gate: createStopGate(), auth });
  await assert.rejects(tf.createUser("artisan-b", "artisan"));
  assert.equal(intents.open().length, 1, "lost response ⇒ intent open");
  return { intents, manifest };
}

test("P2-d — lost create, the user appears on the 2nd re-read ⇒ found, recorded and cleaned", async () => {
  const id = randomUUID();
  const email = cohort.email("artisan-b");
  const { auth, calls } = fakeAuth({
    byId: (asked) => (asked === id ? json(200, { id, email }) : json(404, NOT_FOUND)),
    pages: (attempt) => json(200, { users: attempt >= 2 ? [{ id, email }] : [] }),
  });
  const { intents, manifest } = await lostCreate(auth);
  const db = fakeDb();
  const result = await cleanupWithProof({ db, auth, manifest, intents, runId: RUN, log: () => {}, persist: async () => {} });
  assert.ok(calls.list.some((c) => c.attempt === 2), "a second spaced scan happened");
  assert.deepEqual(manifest.created.auth_users, [id]);
  assert.equal(intents.entries[0].outcome, "reconciled");
  assert.equal(result.ok, true);
  assert.ok(db.deletes.some((d) => d.table === "auth.users" && d.filters === id), "the proven-owned account is deleted");
});

test("P2-d — lost create, the user is on page 3 of the listing ⇒ found", async () => {
  const id = randomUUID();
  const email = cohort.email("artisan-b");
  const { auth, calls } = fakeAuth({
    byId: (asked) => (asked === id ? json(200, { id, email }) : json(404, NOT_FOUND)),
    pages: (attempt, page) => json(200, { users: page === 1 ? [other(1), other(2)] : page === 2 ? [other(3), other(4)] : [{ id, email }] }),
  });
  const found = await auth.searchByEmail(email, RUN);
  assert.deepEqual({ state: found.state, id: found.id }, { state: "found", id });
  assert.deepEqual(calls.list.map((c) => c.page), [1, 2, 3]);
});

test("P2-d — page 2 errors or is malformed ⇒ UNKNOWN, intent kept open, exit 3", async () => {
  for (const bad of [() => json(500, {}), () => json(200, { users: "nope" }), () => json(200, "{trunc")]) {
    const { auth } = fakeAuth({ pages: (attempt, page) => (page === 2 ? bad() : json(200, { users: [other(1), other(2)] })) });
    assert.equal((await auth.searchByEmail(cohort.email("artisan-b"), RUN)).state, "unknown");
    const { intents, manifest } = await lostCreate(auth);
    const db = fakeDb();
    const result = await cleanupWithProof({ db, auth, manifest, intents, runId: RUN, log: () => {}, persist: async () => {} });
    assert.equal(intentsVerdict(intents).ok, false);
    assert.equal(result.ok, false);
    assert.equal(exitCodeFor({ cleanup: result, signal: true }), 3);
    assert.equal(db.deletes.some((d) => d.table === "auth.users"), false);
  }
});

test("P2-d — never found after the deadline with exhaustive scans ⇒ 'not-found-exhaustive', intent kept, exit 3", async () => {
  const { auth, calls } = fakeAuth({ pages: () => json(200, { users: [other(1)] }) }); // 1 < per_page: end proven
  const found = await auth.searchByEmail(cohort.email("artisan-b"), RUN);
  assert.equal(found.state, "not-found-exhaustive");
  assert.ok(found.attempts >= 3, "several spaced re-reads, never a single absence");
  assert.ok(new Set(calls.list.map((c) => c.attempt)).size >= 3);
  const { intents, manifest } = await lostCreate(auth);
  const db = fakeDb();
  const result = await cleanupWithProof({ db, auth, manifest, intents, runId: RUN, log: () => {}, persist: async () => {} });
  assert.equal(intents.open().length, 1, "absence is not proof of non-creation");
  assert.equal(result.ok, false);
  assert.equal(exitCodeFor({ cleanup: result }), 3);
  assert.equal(db.deletes.length, 0, "nothing deleted that is not proven owned");
  // A listing that never proves its end is UNKNOWN, not exhaustive.
  const endless = fakeAuth({ pages: () => json(200, { users: [other(1), other(2)] }) }).auth;
  assert.equal((await endless.searchByEmail(cohort.email("artisan-b"), RUN)).state, "unknown");
});

// ---------------------------------------------------------------- root review P2-2 / P2-3 (real code paths)
import { existsSync, readFileSync } from "node:fs";
import { Fixtures } from "../scripts/qa/lib/fixtures.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { createReport } from "../scripts/qa/lib/report.mjs";
import { makeManifestDurable, atomicWriteJsonSync as atomicWriteJsonForTest } from "../scripts/qa-tracking/lib/durable.mjs";
import { PROVIDER_RUNNERS } from "../scripts/qa-tracking/scenarios.mjs";
import { runOne } from "../scripts/qa-tracking/run.mjs";

test("P2-2 — manifest and intent are durable on disk BEFORE the creation; a crash/lost create plus an absence never closes the intent", async () => {
  const dir = tmp();
  const manifestPath = path.join(dir, "manifest.json");
  const intents = new IntentLog(path.join(dir, "intents.json"));
  let manifestOnDiskAtCreation = null;
  let intentOnDiskAtCreation = null;
  const db = {
    // Injected crash point: the request left (state unknown), the response never arrives.
    async createAuthUser() {
      manifestOnDiskAtCreation = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
      intentOnDiskAtCreation = JSON.parse(readFileSync(intents.file, "utf8")).intents.at(-1) ?? null;
      throw Object.assign(new Error("socket hang up"), { name: "FetchError" });
    },
  };
  const gate = createStopGate();
  const fixtures = makeManifestDurable(new Fixtures({ db, cohort, manifestPath, context: { sha: "x", project: "p", base_url: "http://x" }, redactor: createRedactor(), gate }));
  assert.ok(existsSync(manifestPath), "manifest written before any creation or lookup");
  // One single instantaneous absence (not exhaustive over time): must NOT close the intent.
  const { auth } = fakeAuth({ pages: () => json(200, { users: [] }) });
  const tf = new TrackingFixtures({ fixtures, intents, cohort, gate, auth });
  await assert.rejects(tf.createUser("client", "client"));
  assert.ok(manifestOnDiskAtCreation && manifestOnDiskAtCreation.run_id === RUN, "the manifest existed on disk when the creation was emitted");
  assert.equal(intentOnDiskAtCreation?.state, "open", "the intent was on disk, open, when the creation was emitted");
  assert.equal(intentOnDiskAtCreation?.key, cohort.email("client"));
  await intents.reconcileOpen();
  const onDisk = JSON.parse(readFileSync(intents.file, "utf8")).intents;
  assert.equal(onDisk[0].state, "open", "absence after the bounded search never closes it (never 'reconciled')");
  const result = await cleanupWithProof({ db: fakeDb(), auth, manifest: fixtures.manifest, intents, runId: RUN, log: () => {}, persist: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(exitCodeFor({ cleanup: result }), 3);
});

function providerCtx(answers) {
  const job = randomUUID(), site = randomUUID(), sid = randomUUID();
  const snapshot = (over = {}) => ({ server_time: new Date().toISOString(), permissions: { can_share: true, can_confirm_destination: true }, tracking: { intervention_id: job, artisan_id: randomUUID(), travel_stage: "en_route", session_id: sid, control_version: 3, shared: true, consent_at: new Date().toISOString(), last_seq: 1, destination_version: 1, position_state: "fresh", position: null, destination: { latitude: 1, longitude: 1, label: "QA", source: "manual", confirmed_by: randomUUID(), confirmed_at: new Date().toISOString() }, ...over } });
  const posts = [];
  const ctx = {
    users: { artisanA: {}, client: {}, viewer: {} },
    jobs: { isoB: { id: job }, site: { id: site } },
    gate: createStopGate(),
    out: tmp(),
    base: "http://127.0.0.1:9",
    session: async () => ({ page: {} }),
    tf: { db: { select: async () => [{ backoff_until: "1970-01-01T00:00:00Z" }] } },
    api: {
      get: async () => ({ status: 200, cache: "private, no-store", body: snapshot() }),
      post: async (_page, p, body) => {
        posts.push({ path: p, action: body?.action ?? null });
        if (p.endsWith("/route")) return answers.route;
        if (p.endsWith("/geocode")) return p.includes(site) ? { status: 403, body: { error: "refusé" }, outcome: "refused" } : answers.geocode;
        return { status: 200, cache: "private, no-store", body: snapshot(), outcome: "done" };
      },
    },
  };
  return { ctx, posts };
}

test("P2-3 — provider 503/429/timeout through the REAL runners, runOne and createReport ⇒ BLOCKED, never PASS", async () => {
  const cases = [
    ["provider-geocode", { geocode: { status: 503, body: { reason: "provider_unavailable" }, outcome: "unknown" } }],
    ["provider-geocode", { geocode: { status: 429, body: { reason: "application_quota" }, outcome: "refused" } }],
    ["provider-route", { route: { status: 503, body: { reason: "provider_unavailable" }, outcome: "unknown" } }],
    ["provider-route", { route: { status: 503, body: { reason: "provider_quota", retry_after_s: 30 }, outcome: "unknown" } }],
    ["provider-route", { route: { status: null, transportError: true, outcome: "unknown" } }],
  ];
  for (const [name, answers] of cases) {
    const report = createReport({}, createRedactor());
    const { ctx, posts } = providerCtx(answers);
    const entry = await runOne(report, "provider", name, (s) => PROVIDER_RUNNERS[name](ctx, s));
    assert.equal(entry.status, "BLOCKED", `${name} ${JSON.stringify(answers)}`);
    assert.match(entry.note, /not a proof/);
    const summary = report.summary();
    assert.equal(summary.pass, 0);
    assert.equal(summary.blocked, 1);
    if (name === "provider-route") assert.ok(posts.some((p) => p.action === "stop"), "the sharing session is stopped even when blocked");
  }
});

// ---------------------------------------------------------------- root recheck of 4b57800: recovered UID durability
import { writeFileSync } from "node:fs";
import { cleanupOnly } from "../scripts/qa-tracking/run.mjs";

const PROJECT = "abcdefghijklmnopqrst";
/** Cleanup db whose FIRST delete asserts that `uid` is already in the manifest ON DISK. */
function diskCheckingDb(manifestPath, uid) {
  const db = fakeDb();
  const seen = { firstDeleteChecked: false, diskHadUidAtFirstDelete: null };
  const check = () => {
    if (seen.firstDeleteChecked) return;
    seen.firstDeleteChecked = true;
    const disk = JSON.parse(readFileSync(manifestPath, "utf8"));
    seen.diskHadUidAtFirstDelete = disk.created.auth_users.includes(uid) && disk.created.profiles.includes(uid);
  };
  const del = db.delete.bind(db), delAuth = db.deleteAuthUser.bind(db);
  db.delete = async (table, filters) => { check(); return del(table, filters); };
  db.deleteAuthUser = async (id) => { check(); return delAuth(id); };
  return { db, seen };
}
function recoveringAuth(uid) {
  const email = cohort.email("artisan-b");
  return fakeAuth({ byId: (asked) => (asked === uid ? json(200, { id: uid, email }) : json(404, NOT_FOUND)), pages: () => json(200, { users: [{ id: uid, email }] }) }).auth;
}
function crashedRun(dir) {
  // State left by a run that crashed after announcing a create whose response was lost: manifest
  // (durable, without the uid) and intents.json with the create intent OPEN.
  const manifestPath = path.join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ version: 1, run_id: RUN, project: PROJECT, created: { auth_users: [], profiles: [], admin_profiles: [], interventions: [], organizations: [], sites: [], quotes: [], approvals: [], documents: [], storage_paths: [], support_tickets: [] } }), { mode: 0o600 });
  const intents = new IntentLog(path.join(dir, "intents.json"));
  intents.begin("createAuthUser", "auth.users", cohort.email("artisan-b"), "service");
  const credentials = path.join(dir, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ supabase: { url: `https://${PROJECT}.supabase.co`, project_ref: PROJECT, service_role_key: "k".repeat(40) } }), { mode: 0o600 });
  return { manifestPath, intents, credentials };
}

test("durability — normal mode: a UID recovered by e-mail is on disk BEFORE the first DELETE and stays recorded after cleanup", async () => {
  const dir = tmp();
  const uid = randomUUID();
  const fixtures = makeManifestDurable(new Fixtures({ db: {}, cohort, manifestPath: path.join(dir, "manifest.json"), context: { sha: "x", project: PROJECT, base_url: "http://x" }, redactor: createRedactor(), gate: createStopGate() }));
  const intents = new IntentLog(path.join(dir, "intents.json"));
  intents.begin("createAuthUser", "auth.users", cohort.email("artisan-b"), "service"); // open, no reconciler (recovery path)
  const { db, seen } = diskCheckingDb(fixtures.manifestPath, uid);
  const result = await cleanupWithProof({ db, auth: recoveringAuth(uid), manifest: fixtures.manifest, intents, runId: RUN, log: () => {}, persist: () => fixtures.save() });
  assert.equal(seen.firstDeleteChecked, true);
  assert.equal(seen.diskHadUidAtFirstDelete, true, "memoryUID=true ⇒ diskUID=true at the first DELETE");
  const disk = JSON.parse(readFileSync(fixtures.manifestPath, "utf8"));
  assert.ok(disk.created.auth_users.includes(uid), "never dropped after cleanup");
  assert.equal(disk.recovered[0].id, uid);
  assert.ok(disk.cleanup_attempt.completed_at, "cleanup outcome recorded on disk");
  assert.ok(db.deletes.some((d) => d.table === "auth.users" && d.filters === uid), "proven-owned recovered account deleted");
  assert.equal(result.ok, false, "the recovered create intent stays open ⇒ INCOMPLETE");
});

test("durability — --cleanup-manifest mode: the recovered UID is written to the manifest file BEFORE the first DELETE", async () => {
  const dir = tmp();
  const uid = randomUUID();
  const { manifestPath, credentials } = crashedRun(dir);
  const { db, seen } = diskCheckingDb(manifestPath, uid);
  const code = await cleanupOnly({ credentials, project: PROJECT, cleanupManifest: manifestPath, timeoutMs: 5000 }, createRedactor(), () => {}, { makeDb: () => db, makeAuth: () => recoveringAuth(uid) });
  assert.equal(seen.diskHadUidAtFirstDelete, true, "diskUID=true at the first DELETE in cleanup-only mode");
  const disk = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(disk.created.auth_users.includes(uid));
  assert.ok(disk.cleanup_attempt.completed_at);
  assert.equal(code, 3, "the create intent is still open: INCOMPLETE");
});

test("durability — interruption between recovery and DELETE: the UID is on disk with the intent open; a --cleanup-manifest restart finds and deletes it", async () => {
  const dir = tmp();
  const uid = randomUUID();
  const { manifestPath, intents, credentials } = crashedRun(dir);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { db: firstDb } = diskCheckingDb(manifestPath, uid);
  // Real durable writer; the process is interrupted right after the recovery was persisted.
  const persist = () => {
    atomicWriteJsonForTest(manifestPath, manifest);
    if (manifest.recovered && !manifest.cleanup_attempt) throw Object.assign(new Error("SIGINT between recovery and delete"), { name: "Interrupted" });
  };
  await assert.rejects(cleanupWithProof({ db: firstDb, auth: recoveringAuth(uid), manifest, intents, runId: RUN, log: () => {}, persist }), /SIGINT/);
  assert.equal(firstDb.deletes.length, 0, "interrupted before any DELETE");
  const onDisk = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(onDisk.created.auth_users.includes(uid), "the UID survived the interruption on disk");
  assert.equal(JSON.parse(readFileSync(intents.file, "utf8")).intents[0].state, "open", "intent still open on disk");
  // Restart with --cleanup-manifest (fresh process state: no reconcilers, everything read from disk).
  const { db, seen } = diskCheckingDb(manifestPath, uid);
  const code = await cleanupOnly({ credentials, project: PROJECT, cleanupManifest: manifestPath, timeoutMs: 5000 }, createRedactor(), () => {}, { makeDb: () => db, makeAuth: () => recoveringAuth(uid) });
  assert.equal(seen.diskHadUidAtFirstDelete, true);
  assert.ok(db.deletes.some((d) => d.table === "auth.users" && d.filters === uid), "the restart deletes the recovered, proven-owned account");
  const after = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.ok(after.created.auth_users.includes(uid) && after.cleanup_attempt.completed_at, "consistent disk state after cleanup");
  assert.equal(code, 3);
});
