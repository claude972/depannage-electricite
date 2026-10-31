// @ts-nocheck — drives the untyped ESM harness through tsx.
// WEB-DEEPLINK-QA-001 — pure units (Realtime proof, origin normalisation, gate, windows, args, intents
// journal validation) and the REAL `main` with injected deps: --cleanup-manifest strictness (manifest
// and intents journal refused BEFORE any read/delete), INCOMPLETE on an indirect-collection error, and
// exit precedence (cleanup incomplete 3 is never overwritten). No cloud, no credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normaliseOrigin, isRealtimeSocket, createRealtimeBlock } from "../scripts/qa-deeplink/lib/realtime-block.mjs";
import { gateOpen, assertWindow, openCleanWindow } from "../scripts/qa-deeplink/lib/window.mjs";
import { parseArgs } from "../scripts/qa-deeplink/lib/args.mjs";
import { validateIntentsJournal } from "../scripts/qa-deeplink/lib/cleanup.mjs";
import { classifyPath, authMarker } from "../scripts/qa-deeplink/lib/observe.mjs";
import { main } from "../scripts/qa-deeplink/run.mjs";
import { REVALIDATE_GUARD_MS, REALTIME_CLOSE } from "../scripts/qa-deeplink/lib/constants.mjs";
import { createAuthAdmin } from "../scripts/qa-tracking/lib/auth-admin.mjs";
import { AppDefect } from "../scripts/qa/lib/report.mjs";
import { PreflightError } from "../scripts/qa/lib/config.mjs";

const PROJECT = "abcdefghijklmnopqrst";
const SHA = "6901e2a0000000000000000000000000000000aa".slice(0, 40);
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-dl-unit-"));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------- Realtime proof (handler side)
test("origin normalisation: wss⇔https, ws⇔http, lowercase host, default port; exact Realtime path only", () => {
  assert.equal(normaliseOrigin("wss://ABC.supabase.co:443/realtime/v1/websocket?apikey=x"), "https://abc.supabase.co");
  assert.equal(normaliseOrigin("ws://127.0.0.1:8080/x"), "http://127.0.0.1:8080");
  assert.equal(normaliseOrigin("ftp://x"), null);
  assert.ok(isRealtimeSocket("wss://abc.supabase.co/realtime/v1/websocket?apikey=SECRET&vsn=1.0.0", "https://abc.supabase.co"));
  assert.ok(!isRealtimeSocket("wss://abc.supabase.co/realtime/v1/other", "https://abc.supabase.co"));
  assert.ok(!isRealtimeSocket("wss://evil.example/realtime/v1/websocket", "https://abc.supabase.co"));
});

function fakeWs(url, { closeFails = false } = {}) {
  const calls = { close: [], connect: 0 };
  return { calls, url: () => url, close: async (opts) => { calls.close.push(opts); if (closeFails) throw new Error("boom"); }, connectToServer: () => { calls.connect++; } };
}
test("realtime block: hit ⇒ close awaited with 4000, never connectToServer; other socket left alone; handler error / 0 hits ⇒ not proven", async () => {
  const block = createRealtimeBlock({ supabaseOrigin: "https://abc.supabase.co" });
  assert.equal(block.proof().ok, false, "0 hits ⇒ BLOCKED");
  const rt = fakeWs("wss://abc.supabase.co/realtime/v1/websocket?apikey=SECRET&vsn=1.0.0");
  await block.handler(rt);
  assert.deepEqual(rt.calls.close, [{ code: REALTIME_CLOSE.code, reason: REALTIME_CLOSE.reason }]);
  assert.equal(rt.calls.connect, 0);
  const other = fakeWs("wss://abc.supabase.co/other");
  await block.handler(other);
  assert.equal(other.calls.connect, 1);
  const p = block.proof();
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.other_sockets, 1);
  assert.ok(!JSON.stringify(block.stats()).includes("SECRET") && !JSON.stringify(block.stats()).includes("apikey"));
  const broken = createRealtimeBlock({ supabaseOrigin: "https://abc.supabase.co" });
  await broken.handler(fakeWs("wss://abc.supabase.co/realtime/v1/websocket", { closeFails: true }));
  assert.equal(broken.proof().ok, false);
  assert.match(broken.proof().reason, /close resolved 0\/1.*handler error/);
  assert.equal(createRealtimeBlock({ supabaseOrigin: "https://abc.supabase.co" }).proof({ pageRealtimeFrames: 2 }).ok, false);
});

// ---------------------------------------------------------------- passive gate (ROOT counter-example)
test("gate: last request t0, window focus t7 ⇒ the window cannot open before t23 (16 s guard); in flight / not quiet ⇒ closed", () => {
  const at = (s) => 1_000_000 + s * 1000;
  const probe = (nowS, focusS) => ({ created: at(-30), now: at(nowS), focus: focusS === null ? [] : [{ type: "focus", at: at(focusS) }] });
  const decide = (nowS) => gateOpen({ probe: probe(nowS, 7), inFlight: 0, lastActivity: at(0), nowMs: at(nowS) });
  assert.equal(REVALIDATE_GUARD_MS, 16000);
  for (const s of [8, 15, 18, 22.9]) assert.equal(decide(s).open, false, `t${s}`);
  assert.equal(decide(23).open, true);
  assert.equal(gateOpen({ probe: probe(40, null), inFlight: 1, lastActivity: at(0), nowMs: at(40) }).why, "workspace request in flight");
  assert.equal(gateOpen({ probe: probe(40, null), inFlight: 0, lastActivity: at(39.5), nowMs: at(40) }).why, "workspace not quiet");
  assert.equal(gateOpen({ probe: null, inFlight: 0, lastActivity: 0, nowMs: 0 }).open, false);
});

test("gate timeout ⇒ BLOCKED; window verdicts: focus ⇒ BLOCKED, wrong count / reload / auth ⇒ FAIL (never generalised)", async () => {
  let clock = 0;
  const page = { evaluate: async () => ({ marker: "m", created: clock, now: clock, focus: [{ type: "focus", at: clock }], seen: {} }) };
  const observer = { inFlightWorkspace: () => [], lastWorkspaceActivity: () => -10000 };
  await assert.rejects(openCleanWindow({ page, observer, now: () => clock, sleep: async (ms) => { clock += ms; }, timeoutMs: 1000 }), (e) => e.blocked === true && /revalidation gate not reached/.test(e.message));
  const base = { settled: true, count: 1, focusInWindow: 0, sameDocument: true, authEvents: [], seen: {} };
  assert.equal(assertWindow(base, 1, "x"), base);
  assert.throws(() => assertWindow({ ...base, focusInWindow: 1 }, 1, "x"), (e) => e.blocked === true);
  assert.throws(() => assertWindow({ ...base, count: 2 }, 1, "x"), (e) => e instanceof AppDefect && /2 GET \/api\/workspace in a clean window/.test(e.message));
  assert.throws(() => assertWindow({ ...base, sameDocument: false }, 1, "x"), AppDefect);
  assert.throws(() => assertWindow({ ...base, authEvents: ["logout"] }, 1, "x"), AppDefect);
  assert.throws(() => assertWindow({ ...base, settled: false }, 1, "x"), (e) => e.blocked === true);
});

test("observer classification and auth markers (scalars only, no query values)", () => {
  assert.equal(classifyPath("/api/workspace"), "workspace");
  assert.equal(classifyPath(`/api/interventions/${randomUUID()}/tracking`), "intervention");
  assert.equal(classifyPath("/auth/v1/user"), "auth");
  assert.equal(classifyPath("/api/other"), null);
  assert.equal(authMarker("https://x.supabase.co/auth/v1/logout?scope=global"), "logout");
  assert.equal(authMarker("https://x.supabase.co/auth/v1/token?grant_type=password"), "password_grant");
  assert.equal(authMarker("https://x.supabase.co/auth/v1/token?grant_type=refresh_token"), null);
});

test("args: --mode required, REMOTE flags, --only D1..D4, loopback for local", () => {
  const common = ["--base-url", "http://127.0.0.1:3000", "--sha", SHA, "--build-id", "mYTq7jnyFyd_WanJwnbB3", "--project", PROJECT, "--credentials", "/c.json", "--playwright", "/pw"];
  assert.deepEqual(parseArgs([...common, "--mode", "local", "--only", "D2"]).errors, []);
  assert.deepEqual(parseArgs([...common, "--mode", "local", "--only", "D2"]).options.scenarios, ["D2"]);
  assert.ok(parseArgs(common).errors.some((e) => /--mode/.test(e)));
  assert.ok(parseArgs([...common, "--mode", "local", "--only", "T6"]).errors.some((e) => /unknown scenario/.test(e)));
  assert.ok(parseArgs([...common, "--mode", "local", "--vercel-team-id", "team_x"]).errors.some((e) => /only accepted with --mode remote/.test(e)));
});

// ---------------------------------------------------------------- intents journal (exact validation)
const goodEntry = () => ({ id: randomUUID(), op: "createAuthUser", target: "auth.users", key: "k", kind: "service", state: "open", opened_at: "x", settled_at: null, outcome: null });
test("intents journal: exact schema; malformed ⇒ refused (never coerced to an empty list)", () => {
  assert.equal(validateIntentsJournal({ version: 2, intents: [] }).ok, true);
  assert.equal(validateIntentsJournal({ version: 2, intents: [goodEntry(), { ...goodEntry(), state: "settled", outcome: "done" }] }).ok, true);
  const bad = [
    null, [], { version: 1, intents: [] }, { version: 2, intents: null }, { version: 2 }, { version: 2, intents: {} },
    { version: 2, intents: [{ ...goodEntry(), state: "weird" }] },
    { version: 2, intents: [{ ...goodEntry(), id: "nope" }] },
    { version: 2, intents: [(({ kind, ...r }) => r)(goodEntry())] },
    { version: 2, intents: [{ ...goodEntry(), op: "" }] },
    { version: 2, intents: [{ ...goodEntry(), kind: "magic" }] },
    { version: 2, intents: [{ ...goodEntry(), state: "settled", outcome: "maybe" }] },
    { version: 2, intents: [{ ...goodEntry(), outcome: "done" }] },
  ];
  for (const j of bad) assert.equal(validateIntentsJournal(j).ok, false, JSON.stringify(j));
});

// ---------------------------------------------------------------- REAL main, --cleanup-manifest
function cleanupDir({ manifest, intents }) {
  const dir = tmp();
  const manifestPath = path.join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  if (intents !== undefined) writeFileSync(path.join(dir, "intents.json"), typeof intents === "string" ? intents : JSON.stringify(intents), { mode: 0o600 });
  const credentials = path.join(dir, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ supabase: { url: `https://${PROJECT}.supabase.co`, project_ref: PROJECT, service_role_key: "k".repeat(40) } }), { mode: 0o600 });
  return { dir, manifestPath, credentials };
}
const goodManifest = () => ({ version: 1, run_id: "0123456789ab", project: PROJECT, created: { auth_users: [], profiles: [] } });
function countingDeps() {
  const calls = { db: 0, auth: 0, credentials: 0 };
  const db = new Proxy({}, { get: () => async () => { calls.db++; return []; } });
  return { calls, cleanupDeps: { makeDb: () => db, makeAuth: () => new Proxy({}, { get: () => async () => { calls.auth++; return { state: "unknown" }; } }), loadCredentials: async (f) => { calls.credentials++; return (await import("../scripts/qa/lib/config.mjs")).loadCredentials(f); } } };
}

test("main --cleanup-manifest: malformed intents journal (null, absent, non-array, unknown state, missing id/kind/op, missing file) ⇒ exit 3, refused, ZERO reads/deletes", async () => {
  const variants = {
    nullIntents: { version: 2, intents: null },
    absentField: { version: 2 },
    nonArray: { version: 2, intents: "x" },
    unknownState: { version: 2, intents: [{ ...goodEntry(), state: "zombie" }] },
    missingId: { version: 2, intents: [(({ id, ...r }) => r)(goodEntry())] },
    missingKind: { version: 2, intents: [(({ kind, ...r }) => r)(goodEntry())] },
    missingOp: { version: 2, intents: [(({ op, ...r }) => r)(goodEntry())] },
    notJson: "{oops",
    missingFile: undefined,
  };
  for (const [name, intents] of Object.entries(variants)) {
    const { dir, manifestPath, credentials } = cleanupDir({ manifest: goodManifest(), intents });
    const { calls, cleanupDeps } = countingDeps();
    const code = await main(["--cleanup-manifest", manifestPath, "--credentials", credentials, "--project", PROJECT], { cleanupDeps });
    assert.equal(code, 3, name);
    assert.deepEqual({ db: calls.db, auth: calls.auth }, { db: 0, auth: 0 }, `${name}: nothing read or deleted`);
    const out = JSON.parse(readFileSync(path.join(dir, "cleanup.json"), "utf8"));
    assert.equal(out.refused, true, name);
    assert.match(out.error, /intents journal refused/);
  }
});

test("main --cleanup-manifest: manifest validated STRICTLY before the credentials are read (version 1, exact project)", async () => {
  for (const [name, manifest] of [["version 2", { ...goodManifest(), version: 2 }], ["no version", (({ version, ...r }) => r)(goodManifest())], ["other project", { ...goodManifest(), project: "zzzzzzzzzzzzzzzzzzzz" }], ["no project", (({ project, ...r }) => r)(goodManifest())], ["bad run id", { ...goodManifest(), run_id: "x" }]]) {
    const { manifestPath, credentials } = cleanupDir({ manifest, intents: { version: 2, intents: [] } });
    const { calls, cleanupDeps } = countingDeps();
    const code = await main(["--cleanup-manifest", manifestPath, "--credentials", credentials, "--project", PROJECT], { cleanupDeps });
    assert.equal(code, 2, name);
    assert.deepEqual(calls, { db: 0, auth: 0, credentials: 0 }, `${name}: refused before the credentials and any remote call`);
  }
  const { manifestPath, credentials } = cleanupDir({ manifest: goodManifest(), intents: { version: 2, intents: [] } });
  const { calls, cleanupDeps } = countingDeps();
  assert.equal(await main(["--cleanup-manifest", manifestPath, "--credentials", credentials, "--project", PROJECT], { cleanupDeps }), 0, "valid and empty ⇒ clean");
  assert.equal(calls.credentials, 1);
});

// ---------------------------------------------------------------- REAL main, normal mode
function runDeps({ selectThrows = false, browserThrows = false } = {}) {
  const uid = randomUUID();
  let cohortRef = null;
  const db = {
    deletes: [],
    async select() { if (selectThrows) throw new TypeError("select failed"); return []; },
    async delete(t, f) { this.deletes.push(t); }, async count() { return 0; }, async storageRemove() {}, async storageList() { return []; },
    async deleteAuthUser(id) { this.deletes.push(`auth:${id}`); }, async authUserExists() { return false; },
    // The seed is definitively refused (400): its intent settles « refused », nothing is created.
    async createAuthUser() { throw Object.assign(new Error("refused by the test"), { status: 400 }); },
    async insert() { throw new Error("no insert expected"); }, async update() { throw new Error("no update expected"); }, async upsert() { throw new Error("no upsert expected"); },
  };
  const fetchFn = async (url) => {
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(new URL(url).pathname);
    if (m && m[1] === uid) return json(200, { id: uid, email: cohortRef.email("dl-owned") });
    return json(404, { code: 404, error_code: "user_not_found", msg: "User not found" });
  };
  const fakeBrowser = { contexts: () => [], close: async () => {}, newContext: async () => { throw new Error("no browser in this test"); } };
  return {
    db,
    deps: {
      verifySha: async () => ({ verified: false }),
      loadPlaywright: async () => ({ chromium: {} }),
      checkBuildProvenance: async () => ({ mode: "local", servedBuildId: "mYTq7jnyFyd_WanJwnbB3", provenance: "test" }),
      makeDb: () => db,
      makeAuth: () => createAuthAdmin({ url: `https://${PROJECT}.supabase.co`, serviceKey: "service-key-not-used-for-real-x", fetchFn }),
      launchBrowser: async () => { if (browserThrows) throw new Error("browser crashed"); return fakeBrowser; },
      afterManifest: async ({ fixtures, cohort }) => {
        cohortRef = cohort;
        await fixtures.track("auth_users", uid); // a proven-owned account, so the cleanup itself can succeed
        await fixtures.track("profiles", uid);
      },
    },
  };
}
const runArgs = (out, credentials) => ["--mode", "local", "--base-url", "http://127.0.0.1:9", "--sha", SHA, "--build-id", "mYTq7jnyFyd_WanJwnbB3", "--project", PROJECT, "--credentials", credentials, "--playwright", "/pw", "--out", out, "--only", "D1"];

test("main: indirect collection error ⇒ cleanup INCOMPLETE ⇒ exit 3 (never « cleanup ok »); without it the cleanup is complete", async () => {
  const { credentials } = cleanupDir({ manifest: goodManifest() });
  const okRun = runDeps();
  const outOk = path.join(tmp(), "out");
  const codeOk = await main(runArgs(outOk, credentials), okRun.deps);
  assert.notEqual(codeOk, 3);
  assert.equal(JSON.parse(readFileSync(path.join(outOk, "cleanup.json"), "utf8")).ok, true);
  const bad = runDeps({ selectThrows: true });
  const outBad = path.join(tmp(), "out");
  const codeBad = await main(runArgs(outBad, credentials), bad.deps);
  assert.equal(codeBad, 3);
  const cleanup = JSON.parse(readFileSync(path.join(outBad, "cleanup.json"), "utf8"));
  assert.equal(cleanup.ok, false);
  assert.match(cleanup.error, /indirect collection failed/);
});

test("main: exit codes — a throw after an INCOMPLETE cleanup keeps 3; a crash with a COMPLETE cleanup is FATAL 1; a PreflightError is 2", async () => {
  const { credentials } = cleanupDir({ manifest: goodManifest() });
  const out1 = path.join(tmp(), "out");
  assert.equal(await main(runArgs(out1, credentials), runDeps({ browserThrows: true, selectThrows: true }).deps), 3);
  assert.ok(existsSync(path.join(out1, "cleanup.json")));
  const out2 = path.join(tmp(), "out");
  assert.equal(await main(runArgs(out2, credentials), runDeps({ browserThrows: true }).deps), 1, "crash + complete cleanup ⇒ FATAL 1");
  assert.equal(JSON.parse(readFileSync(path.join(out2, "cleanup.json"), "utf8")).ok, true);
  const refused = runDeps();
  refused.deps.checkBuildProvenance = async () => { throw new PreflightError("BLOCKED deployment provenance SERVED_BUILD"); };
  const out3 = path.join(tmp(), "out");
  assert.equal(await main(runArgs(out3, credentials), refused.deps), 2, "preflight refusal ⇒ 2");
  assert.equal(existsSync(out3), false, "refused before --out is created");
});
