// @ts-nocheck — drives the untyped ESM probe through tsx.
// WEB-REALTIME-PROBE-001 — pure projections (fake tokens only), conclusion table, CLI, journal
// validation, and the REAL `main` with injected deps: preflight refusals (exit 2, nothing written),
// an end-to-end run in real Chromium against the local fake Supabase (exit 0, scalars only, no
// secret in any output file, 0600), a lost createAuthUser reply (recovered, exit 3), and the strict
// --cleanup-manifest. No cloud, no credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decodeFrame, projectToken, createProjector, authVerdict, whitelistText } from "../scripts/qa-realtime/lib/project.mjs";
import { conclude } from "../scripts/qa-realtime/lib/verdict.mjs";
import { parseArgs } from "../scripts/qa-realtime/lib/args.mjs";
import { validateIntentsJournal } from "../scripts/qa-realtime/lib/cleanup.mjs";
import { main } from "../scripts/qa-realtime/run.mjs";
import { startFakeSupabase, fakeJwt } from "../scripts/qa-realtime/test-support/fake-supabase.mjs";
import { createAuthAdmin } from "../scripts/qa-tracking/lib/auth-admin.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable: ${PW} / ${CHROMIUM}`;
const APP_DIR = path.resolve(import.meta.dirname, "..");
const PROJECT = "abcdefghijklmnopqrst";
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-rt-unit-"));
const UID = randomUUID();
const TOPIC = "realtime:workspace-x";
const SECRETS = /eyJ|access_token|refresh-|password|Bearer|apikey|pw-|publishable-key/;

// ---------------------------------------------------------------- projections (in memory, booleans)
test("decodeFrame: vsn 2.0.0 arrays and 1.0.0 objects; binary / junk ⇒ null", () => {
  assert.deepEqual(decodeFrame(JSON.stringify(["1", "2", TOPIC, "phx_join", { a: 1 }])), { join_ref: "1", ref: "2", topic: TOPIC, event: "phx_join", payload: { a: 1 } });
  assert.equal(decodeFrame(JSON.stringify({ topic: TOPIC, event: "system", payload: {}, ref: null })).event, "system");
  assert.equal(decodeFrame(Buffer.from([1, 2])), null);
  assert.equal(decodeFrame("not json"), null);
  assert.equal(decodeFrame(JSON.stringify([1, 2, 3])), null);
});

test("projectToken: three booleans from FAKE tokens; the token and claims never come back", () => {
  const good = fakeJwt({ sub: UID, role: "authenticated" });
  assert.deepEqual(projectToken(good, UID), { present: true, role_authenticated: true, sub_matches: true });
  assert.deepEqual(projectToken(fakeJwt({ sub: UID, role: "anon" }), UID), { present: true, role_authenticated: false, sub_matches: true });
  assert.deepEqual(projectToken(fakeJwt({ sub: "other", role: "authenticated" }), UID), { present: true, role_authenticated: true, sub_matches: false });
  assert.deepEqual(projectToken(undefined, UID), { present: false, role_authenticated: false, sub_matches: false });
  assert.deepEqual(projectToken("garbage", UID), { present: true, role_authenticated: false, sub_matches: false });
  assert.ok(!JSON.stringify(projectToken(good, UID)).includes("eyJ"));
});

test("projector: bound to ONE topic, epochs (join + access_token), join reply positions, whitelisted system; nothing secret in the snapshot", () => {
  let t = 0;
  const p = createProjector({ topic: TOPIC, clientTables: ["interventions", "payments"], expectedSub: UID, now: () => (t += 10) });
  const tok = fakeJwt({ sub: UID, role: "authenticated" });
  p.client(JSON.stringify(["3", "3", TOPIC, "phx_join", { access_token: tok, config: {} }]));
  p.client(JSON.stringify(["9", "9", "realtime:other", "access_token", { access_token: tok }])); // another channel: not an epoch
  p.server(JSON.stringify(["3", "3", TOPIC, "phx_reply", { status: "ok", response: { postgres_changes: [{ id: 1, event: "*", schema: "public", table: "interventions" }, { id: 2, event: "*", schema: "public", table: "secret_table" }] } }]));
  p.client(JSON.stringify(["3", "4", TOPIC, "access_token", { access_token: tok }]));
  p.server(JSON.stringify([null, null, TOPIC, "system", { status: "error", message: "Unable to subscribe to changes with given parameters [table: payments, user 123]" }]));
  p.server(JSON.stringify([null, null, TOPIC, "system", { status: "error", message: "some private upstream text" }]));
  const s = p.snapshot();
  assert.equal(s.epochs.length, 2);
  assert.deepEqual(s.epochs.map((e) => e.epoch), [0, 1]);
  assert.equal(s.foreign_frames, 1);
  assert.deepEqual(s.reply.positions, [{ table: "interventions", event: "*", match: true }, { table: "other", event: "*", match: false }]);
  assert.equal(s.reply.all_match, false);
  assert.deepEqual(s.system.map((x) => x.message), ["Unable to subscribe to changes with given parameters", "other"]);
  assert.ok(!SECRETS.test(JSON.stringify(s)) && !JSON.stringify(s).includes("private upstream") && !JSON.stringify(s).includes("secret_table"));
});

test("authVerdict: proxy not invoked / no join ⇒ unknown; SDK token change without a captured epoch ⇒ unknown; anon ⇒ observed_false; all good ⇒ proven", () => {
  const ep = (o = {}) => ({ epoch: 0, t_ms: 0, present: true, role_authenticated: true, sub_matches: true, ...o });
  assert.equal(authVerdict({ proxyInvoked: false, snapshot: { join_seen: true, epochs: [ep()] } }).verdict, "unknown");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: false, epochs: [] } }).verdict, "unknown");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: true, epochs: [ep()] }, sdkTokenChanges: 1 }).verdict, "unknown", "missing epoch is never a false proof");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: true, epochs: [ep({ role_authenticated: false })] } }).verdict, "observed_false");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: true, epochs: [ep({ present: false })] } }).verdict, "observed_false");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: true, epochs: [ep({ sub_matches: false })] } }).verdict, "unknown");
  assert.equal(authVerdict({ proxyInvoked: true, snapshot: { join_seen: true, epochs: [ep(), ep({ epoch: 1 })] }, sdkTokenChanges: 1 }).verdict, "proven");
  assert.equal(whitelistText(null), null);
});

test("conclusion table: positive evidence only; absence alone ⇒ UNKNOWN_H3_POSSIBLE, H3 only with a whitelisted RLS error", () => {
  const ok = { auth: { verdict: "proven" }, join: { all_match: true }, system: [] };
  assert.deepEqual(conclude([{ name: "app-4", verdict: "join_refused", error_message: "mismatch between server and client bindings for postgres changes" }, { name: "pub-3", verdict: "event_received", ...ok }]).map((c) => c.code), ["H1a"]);
  assert.deepEqual(conclude([{ name: "int-1", verdict: "no_event", ...ok }]).map((c) => c.code), ["UNKNOWN_H3_POSSIBLE"]);
  assert.deepEqual(conclude([{ name: "int-1", verdict: "no_event", ...ok, system: [{ status: "error", message: "RLS" }] }]).map((c) => c.code), ["H3"]);
  assert.deepEqual(conclude([{ name: "int-1", verdict: "no_event", auth: { verdict: "unknown" }, join: { all_match: true }, system: [] }]).map((c) => c.code), ["INCONCLUSIVE"]);
  assert.deepEqual(conclude([{ name: "int-1", verdict: "join_refused" }]).map((c) => c.code), ["INCONCLUSIVE"]);
});

test("args: confirm flag, measurements, sdk format", () => {
  assert.ok(parseArgs(["--credentials", "/c", "--project", PROJECT, "--playwright", "/pw"]).errors.some((e) => /confirm-no-active-cohort/.test(e)));
  assert.deepEqual(parseArgs(["--credentials", "/c", "--project", PROJECT, "--playwright", "/pw", "--confirm-no-active-cohort", "--only", "int-1"]).options.measurements, ["int-1"]);
  assert.ok(parseArgs(["--credentials", "/c", "--project", PROJECT, "--playwright", "/pw", "--confirm-no-active-cohort", "--only", "x"]).errors.some((e) => /unknown measurement/.test(e)));
});

test("intents journal: exact validation (malformed ⇒ refused)", () => {
  const e = { id: randomUUID(), op: "createAuthUser", kind: "service", state: "open", outcome: null };
  assert.equal(validateIntentsJournal({ version: 2, intents: [e] }).ok, true);
  for (const bad of [null, { version: 2 }, { version: 2, intents: null }, { version: 1, intents: [] }, { version: 2, intents: [{ ...e, state: "x" }] }, { version: 2, intents: [{ ...e, id: "x" }] }, { version: 2, intents: [(({ kind, ...r }) => r)(e)] }]) assert.equal(validateIntentsJournal(bad).ok, false);
});

// ---------------------------------------------------------------- REAL main
function creds(dir, url, { publishable = true } = {}) {
  const file = path.join(dir, "credentials.json");
  writeFileSync(file, JSON.stringify({ supabase: { url, project_ref: PROJECT, service_role_key: "k".repeat(40), ...(publishable ? { publishable_key: "publishable-key-fake-000000000" } : {}) } }), { mode: 0o600 });
  return file;
}
const baseArgs = (c, out) => ["--credentials", c, "--project", PROJECT, "--playwright", PW, "--chromium", CHROMIUM, "--confirm-no-active-cohort", "--app-dir", APP_DIR, "--out", out];

test("main preflight refusals ⇒ exit 2 before any mutation (no --out): no confirm flag, no publishable key, SDK mismatch, auth health 503", async () => {
  const dir = tmp();
  const c = creds(dir, "http://127.0.0.1:9");
  const out = path.join(dir, "out");
  assert.equal(await main(["--credentials", c, "--project", PROJECT, "--playwright", PW, "--out", out]), 2);
  assert.equal(await main(baseArgs(creds(tmp(), "http://127.0.0.1:9", { publishable: false }), out)), 2);
  assert.equal(await main(baseArgs(c, out), { sdkVersions: () => ({ realtime_js: "2.117.0" }) }), 2);
  assert.equal(await main(baseArgs(c, out), { fetch: async () => new Response("{}", { status: 503 }) }), 2);
  assert.equal(await main(baseArgs(c, out), { fetch: async () => { throw new TypeError("fetch failed"); } }), 2);
  assert.equal(existsSync(out), false, "nothing written");
});

function fakeBackend(fake, { loseCreateReply = false, listMalformed = false } = {}) {
  const users = new Map(); // id → email
  const rows = [];
  let clock = 0;
  const db = {
    async createAuthUser({ email, password }) {
      const id = fake.addUser(email, password);
      users.set(id, email);
      if (loseCreateReply) throw Object.assign(new Error("socket hang up"), { status: 502 }); // committed, reply lost
      return id;
    },
    async update(table, f) { return table === "profiles" ? [{ id: f.id.slice(3) }] : []; },
    async upsert() { return []; },
    async insert(table, list) { if (table !== "interventions") return []; for (const r of list) { rows.push(r); fake.insert(r.id, r.client_id); } return list; },
    async select(table, f) {
      if (table !== "interventions") return [];
      if (f.id?.startsWith("eq.")) return rows.filter((r) => r.id === f.id.slice(3)).map((r) => ({ id: r.id, client_id: r.client_id }));
      if (f.id?.startsWith("in.(")) return rows.filter((r) => f.id.includes(r.id)).map((r) => ({ id: r.id, client_id: r.client_id, artisan_id: null }));
      if (f.client_id) return rows.filter((r) => f.client_id.includes(r.client_id)).map((r) => ({ id: r.id }));
      return [];
    },
    deletes: [],
    async delete(table) { this.deletes.push(table); }, async count() { return 0; }, async storageRemove() {}, async storageList() { return []; },
    async deleteAuthUser(id) { this.deletes.push(`auth:${id}`); }, async authUserExists() { return false; },
  };
  const fetchFn = async (url) => {
    const u = new URL(url);
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(u.pathname);
    if (m) return users.has(m[1]) ? Response.json({ id: m[1], email: users.get(m[1]) }) : Response.json({ code: 404, error_code: "user_not_found", msg: "User not found" }, { status: 404 });
    if (listMalformed) return Response.json({ nope: true }); // the Auth list cannot be read ⇒ unknown
    return Response.json({ users: [...users].map(([id, email]) => ({ id, email })) }, { headers: { "x-total-count": String(users.size) } });
  };
  const auth = createAuthAdmin({ url: fake.url, serviceKey: "service-key-not-used-for-real-x", fetchFn, now: () => clock, sleep: async (ms) => { clock += ms; }, search: { perPage: 50, maxPages: 5, attempts: 2, intervalMs: 10, deadlineMs: 100 } });
  return { db, auth, users };
}

test("main end-to-end (real Chromium, real SDK, fake Supabase ok): exit 0, one INSERT per confirmed join, scalars only, no secret in any file, 0700/0600", { skip: SKIP, timeout: 240000 }, async () => {
  const fake = await startFakeSupabase({ mode: "ok" });
  try {
    const dir = tmp();
    const out = path.join(dir, "out");
    const be = fakeBackend(fake);
    const code = await main([...baseArgs(creds(dir, fake.url), out), "--only", "app-4,int-1"], { makeDb: () => be.db, makeAuth: () => be.auth, limits: { joinTimeoutMs: 8000, windowMs: 2500 } });
    assert.equal(code, 0);
    const report = JSON.parse(readFileSync(path.join(out, "report.json"), "utf8"));
    assert.equal(report.blocked, null);
    assert.deepEqual(report.measurements.map((m) => m.verdict), ["event_received", "event_received"]);
    assert.ok(report.measurements.every((m) => m.auth.verdict === "proven"));
    assert.equal(report.context.sdk.realtime_js, "2.118.0");
    assert.equal(report.cleanup.ok, true);
    assert.equal(statSync(out).mode & 0o777, 0o700);
    for (const f of readdirSync(out)) {
      const p = path.join(out, f);
      if (statSync(p).isDirectory()) continue;
      assert.equal(statSync(p).mode & 0o777, 0o600, f);
      assert.ok(!SECRETS.test(readFileSync(p, "utf8")), `no secret in ${f}`);
    }
    assert.ok(be.db.deletes.some((d) => d.startsWith("auth:")), "the QA account was cleaned up by B1");
  } finally {
    fake.close();
  }
});

test("main: lost createAuthUser reply + account FOUND by exact e-mail ⇒ UID persisted then deleted, intent reconciled; the crash is FATAL 1 with a complete cleanup", { skip: SKIP, timeout: 240000 }, async () => {
  const fake = await startFakeSupabase({ mode: "ok" });
  try {
    const dir = tmp();
    const out = path.join(dir, "out");
    const be = fakeBackend(fake, { loseCreateReply: true });
    const code = await main(baseArgs(creds(dir, fake.url), out), { makeDb: () => be.db, makeAuth: () => be.auth });
    assert.equal(code, 1);
    const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
    const [uid] = [...be.users.keys()];
    assert.ok(manifest.created.auth_users.includes(uid), "recovered UID persisted in the manifest");
    assert.ok(be.db.deletes.includes(`auth:${uid}`), "and deleted by B1");
    assert.equal(JSON.parse(readFileSync(path.join(out, "cleanup.json"), "utf8")).ok, true);
  } finally {
    fake.close();
  }
});

test("main: lost createAuthUser reply + Auth list UNREADABLE ⇒ intent stays OPEN, no deletion of an unproven id ⇒ exit 3 (never 0, never empty)", { skip: SKIP, timeout: 240000 }, async () => {
  const fake = await startFakeSupabase({ mode: "ok" });
  try {
    const dir = tmp();
    const out = path.join(dir, "out");
    const be = fakeBackend(fake, { loseCreateReply: true, listMalformed: true });
    const code = await main(baseArgs(creds(dir, fake.url), out), { makeDb: () => be.db, makeAuth: () => be.auth });
    assert.equal(code, 3);
    assert.equal(JSON.parse(readFileSync(path.join(out, "intents.json"), "utf8")).intents.find((e) => e.op === "createAuthUser").state, "open");
    assert.equal(be.db.deletes.filter((d) => d.startsWith("auth:")).length, 0);
    assert.equal(JSON.parse(readFileSync(path.join(out, "cleanup.json"), "utf8")).ok, false);
  } finally {
    fake.close();
  }
});

test("main --cleanup-manifest: strict manifest (exit 2 before credentials), malformed journal (exit 3, zero reads)", async () => {
  const dir = tmp();
  const manifestPath = path.join(dir, "manifest.json");
  const c = creds(dir, "http://127.0.0.1:9");
  let reads = 0;
  const cleanupDeps = { makeDb: () => new Proxy({}, { get: () => async () => { reads++; return []; } }), makeAuth: () => new Proxy({}, { get: () => async () => { reads++; return { state: "unknown" }; } }) };
  writeFileSync(manifestPath, JSON.stringify({ version: 2, run_id: "0123456789ab", project: PROJECT, created: {} }));
  assert.equal(await main(["--cleanup-manifest", manifestPath, "--credentials", c, "--project", PROJECT], { cleanupDeps }), 2);
  writeFileSync(manifestPath, JSON.stringify({ version: 1, run_id: "0123456789ab", project: PROJECT, created: {} }));
  writeFileSync(path.join(dir, "intents.json"), JSON.stringify({ version: 2, intents: null }));
  assert.equal(await main(["--cleanup-manifest", manifestPath, "--credentials", c, "--project", PROJECT], { cleanupDeps }), 3);
  assert.equal(reads, 0);
  writeFileSync(path.join(dir, "intents.json"), JSON.stringify({ version: 2, intents: [] }));
  assert.equal(await main(["--cleanup-manifest", manifestPath, "--credentials", c, "--project", PROJECT], { cleanupDeps }), 0);
});
