// QA-FIXTURES-DURABILITY — docs/QA_FIXTURES_DURABILITY_CONTRACT.md (+ amendment c89758b).
// Offline: base Fixtures, the REAL BusinessFixtures (scripts/qa-business) and the REAL tracking
// makeManifestDurable (scripts/qa-tracking), imported by relative repository paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as fsp from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Fixtures, atomicWriteJson, ignorableDirFsyncError } from "../lib/fixtures.mjs";
import { createStopGate, StopRequestedError } from "../lib/lifecycle.mjs";
import { createCohort } from "../lib/cohort.mjs";
import { createRedactor } from "../lib/redact.mjs";
import { BusinessFixtures } from "../../qa-business/lib/fixtures.mjs";
import { makeManifestDurable } from "../../qa-tracking/lib/durable.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const redactor = createRedactor();
async function tmp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-durability-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const readManifest = (file) => JSON.parse(readFileSync(file, "utf8"));
function fakeDb(onWrite = () => {}) {
  let seq = 100;
  const calls = [];
  return {
    calls,
    async insert(table, rows) {
      calls.push(["insert", table]);
      await onWrite("insert", table);
      return rows.map((r) => ({ id: uuid(++seq), ...r }));
    },
    async update(table, filters, patch) {
      calls.push(["update", table]);
      await onWrite("update", table);
      return [{ id: String(filters.id).replace(/^eq\./, ""), ...patch }];
    },
    async upsert(table, rows) {
      calls.push(["upsert", table]);
      await onWrite("upsert", table);
      return rows;
    },
    async select() {
      return [];
    },
    async createAuthUser() {
      calls.push(["createAuthUser"]);
      await onWrite("createAuthUser");
      return uuid(++seq);
    },
  };
}
const base = (dir, db, extra = {}) => new Fixtures({ db, cohort: createCohort("abcdef123456"), manifestPath: path.join(dir, "manifest.json"), context: { sha: "x" }, redactor, ...extra });

test("constructor writes nothing; the manifest is on disk BEFORE the first service write; init() is idempotent", async () =>
  tmp(async (dir) => {
    let onDiskAtFirstWrite = null;
    const writes = [];
    const spy = async (file, value) => {
      writes.push(value);
      return atomicWriteJson(file, value);
    };
    const db = fakeDb(() => {
      if (onDiskAtFirstWrite === null) onDiskAtFirstWrite = existsSync(path.join(dir, "manifest.json"));
    });
    const f = base(dir, db, { writeJson: spy });
    assert.equal(existsSync(f.manifestPath), false, "no write from the constructor");
    await Promise.all([f.init(), f.init(), f.init()]);
    assert.equal(writes.length, 1, "init writes once");
    await f.createSite({ id: uuid(1) }, "Site A");
    assert.equal(onDiskAtFirstWrite, true, "manifest existed before the first insert");
    assert.equal(writes.length, 2, "one initial write + one track write");
    assert.deepEqual(readManifest(f.manifestPath).created.sites.length, 1);
    assert.equal((await stat(f.manifestPath)).mode & 0o777, 0o600);
  }));

test("a failed initial write refuses the creation (no service call); a later call retries", async () =>
  tmp(async (dir) => {
    let fail = true;
    const writeJson = async (file, value) => {
      if (fail) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      return atomicWriteJson(file, value);
    };
    const db = fakeDb();
    const f = base(dir, db, { writeJson });
    await assert.rejects(f.createSite({ id: uuid(1) }, "Site A"), /disk full/);
    assert.equal(db.calls.length, 0, "no mutation without a manifest on disk");
    fail = false;
    await f.createSite({ id: uuid(1) }, "Site A");
    assert.equal(db.calls.length, 1);
    assert.equal(readManifest(f.manifestPath).created.sites.length, 1);
  }));

test("50 concurrent track() calls: a looping reader never sees invalid or regressing content; final file has all 50", async () =>
  tmp(async (dir) => {
    const f = base(dir, fakeDb());
    await f.init();
    let stop = false;
    let reads = 0;
    let maxSeen = 0;
    const reader = (async () => {
      while (!stop) {
        const text = await readFile(f.manifestPath, "utf8");
        const parsed = JSON.parse(text); // throws on a torn file
        const n = parsed.created.sites.length;
        assert.ok(n >= maxSeen, `regressing content: ${n} < ${maxSeen}`);
        maxSeen = n;
        reads++;
        await new Promise((r) => setImmediate(r));
      }
    })();
    await Promise.all(Array.from({ length: 50 }, (_, i) => f.track("sites", uuid(1000 + i))));
    stop = true;
    await reader;
    assert.ok(reads > 0);
    const final = readManifest(f.manifestPath).created.sites;
    assert.equal(final.length, 50);
    assert.equal(new Set(final).size, 50);
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".tmp")), [], "no temp file left");
  }));

test("atomic write: a failing rename leaves the previous file intact and no temp file", async () =>
  tmp(async (dir) => {
    const file = path.join(dir, "manifest.json");
    await atomicWriteJson(file, { v: 1 });
    const brokenFs = { ...fsp, rename: async () => { throw Object.assign(new Error("rename failed"), { code: "EIO" }); } };
    await assert.rejects(atomicWriteJson(file, { v: 2 }, { fs: brokenFs }), /rename failed/);
    assert.deepEqual(readManifest(file), { v: 1 });
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".tmp")), []);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }));

test("directory fsync: only documented not-supported errnos are ignored; EIO/ENOSPC/EPERM propagate", async () =>
  tmp(async (dir) => {
    for (const code of ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EISDIR"]) assert.equal(ignorableDirFsyncError({ code }, "linux"), true, code);
    for (const code of ["EIO", "ENOSPC", "EDQUOT", "EROFS", "EACCES", "EPERM", "EBADF"]) assert.equal(ignorableDirFsyncError({ code }, "linux"), false, code);
    assert.equal(ignorableDirFsyncError({ code: "EPERM" }, "win32"), true);
    assert.equal(ignorableDirFsyncError({ code: "EBADF" }, "win32"), true);
    const file = path.join(dir, "m.json");
    const dirSyncFails = (code) => ({
      ...fsp,
      open: async (p, flags, mode) => {
        const handle = await fsp.open(p, flags, mode);
        if (p === dir) return { sync: async () => { throw Object.assign(new Error(`dir fsync ${code}`), { code }); }, close: () => handle.close() };
        return handle;
      },
    });
    await atomicWriteJson(file, { ok: 1 }, { fs: dirSyncFails("EINVAL"), platform: "linux" });
    assert.deepEqual(readManifest(file), { ok: 1 });
    await assert.rejects(atomicWriteJson(file, { ok: 2 }, { fs: dirSyncFails("EIO"), platform: "linux" }), /dir fsync EIO/);
    await assert.rejects(atomicWriteJson(file, { ok: 3 }, { fs: dirSyncFails("EPERM"), platform: "linux" }), /dir fsync EPERM/);
  }));

test("a save error reaches its caller and does not block the queue", async () =>
  tmp(async (dir) => {
    let failNext = false;
    const writeJson = async (file, value) => {
      if (failNext) {
        failNext = false;
        throw new Error("transient write failure");
      }
      return atomicWriteJson(file, value);
    };
    const f = base(dir, fakeDb(), { writeJson });
    await f.init();
    failNext = true;
    await assert.rejects(f.track("sites", uuid(1)), /transient write failure/);
    await f.track("sites", uuid(2));
    assert.deepEqual(readManifest(f.manifestPath).created.sites, [uuid(1), uuid(2)], "the next save writes the latest state");
  }));

test("REAL tracking makeManifestDurable: override written immediately, used by init/track, base queue never used", async () =>
  tmp(async (dir) => {
    let baseWrites = 0;
    const f = base(dir, fakeDb(), { writeJson: async () => { baseWrites++; } });
    makeManifestDurable(f);
    assert.equal(existsSync(f.manifestPath), true, "the override writes the manifest at once");
    await f.createSite({ id: uuid(1) }, "Site A");
    await Promise.all(Array.from({ length: 10 }, (_, i) => f.track("interventions", uuid(200 + i))));
    assert.equal(baseWrites, 0, "base atomic queue unused when the instance overrides save");
    const m = readManifest(f.manifestPath);
    assert.equal(m.created.sites.length, 1);
    assert.equal(m.created.interventions.length, 10);
  }));

/** Fake Auth admin for BusinessFixtures: createUser({id,…}) returns the pre-generated id. */
function fakeAuth({ onCreate = async () => {} } = {}) {
  return {
    async createUser({ id }) {
      await onCreate(id);
      return id;
    },
  };
}

test("REAL BusinessFixtures: the Auth intent is on disk BEFORE the Auth call; ids tracked after; intent resolved", async () =>
  tmp(async (dir) => {
    const manifestPath = path.join(dir, "manifest.json");
    let diskAtCreate = null;
    const auth = fakeAuth({
      onCreate: async (id) => {
        const m = readManifest(manifestPath);
        diskAtCreate = m.intents.find((i) => i.id === id) || null;
      },
    });
    const f = new BusinessFixtures({ db: fakeDb(), auth, cohort: createCohort("abcdef123456"), manifestPath, context: { project: "qaproject12345678" }, redactor });
    assert.equal(existsSync(manifestPath), false, "no write from the subclass constructor either");
    const user = await f.createUser("client-b", "client");
    assert.ok(diskAtCreate, "pending intent with the pre-generated id was on disk at the Auth call");
    assert.equal(diskAtCreate.status, "pending");
    const m = readManifest(manifestPath);
    assert.equal(m.version, 2, "business manifest shape kept (constructor override applied before init)");
    assert.ok(m.created.auth_users.includes(user.id));
    assert.equal(m.intents.find((i) => i.id === user.id).status, "resolved");
  }));

test("REAL BusinessFixtures: a lost Auth create leaves the pending intent on disk; the stop gate drains in-flight creations", async () =>
  tmp(async (dir) => {
    const manifestPath = path.join(dir, "manifest.json");
    // Lost create: the Auth call never answers usefully (transport error after sending).
    const lost = new BusinessFixtures({ db: fakeDb(), auth: fakeAuth({ onCreate: async () => { throw Object.assign(new Error("socket hang up"), { remoteUnknown: true }); } }), cohort: createCohort("abcdef123456"), manifestPath, context: { project: "qaproject12345678" }, redactor });
    await assert.rejects(lost.createUser("client-c", "client"), /socket hang up/);
    const m = readManifest(manifestPath);
    assert.equal(m.intents.length, 1);
    assert.equal(m.intents[0].status, "pending", "unknown outcome stays pending on disk (never resolved, never dropped)");
    assert.match(m.intents[0].id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(m.created.auth_users, [], "no id claimed without a confirmed answer");
    // Drain: a creation in flight when the run stops still records its ids before the drain ends.
    const gate = createStopGate();
    let release;
    const held = new Promise((r) => (release = r));
    let entered;
    const inAuth = new Promise((r) => (entered = r));
    const drained = new BusinessFixtures({ db: fakeDb(), auth: fakeAuth({ onCreate: () => { entered(); return held; } }), cohort: createCohort("abcdef123457"), manifestPath: path.join(dir, "m2.json"), context: { project: "qaproject12345678" }, redactor, gate });
    const pending = drained.createUser("client-d", "client");
    await inAuth; // the Auth request is in flight (intent already on disk)
    assert.equal(readManifest(path.join(dir, "m2.json")).intents[0].status, "pending");
    gate.stop("signal:SIGINT");
    const draining = gate.drain(5000);
    release();
    const result = await draining;
    assert.equal(result.pending, 0);
    // Business semantics kept: the Auth id is tracked, then the next guarded write (profile update)
    // is refused by the stop gate — the creation ends in StopRequestedError, its ids already on disk.
    await assert.rejects(pending, StopRequestedError);
    const m2 = readManifest(path.join(dir, "m2.json"));
    const intentId = m2.intents[0].id;
    assert.ok(m2.created.auth_users.includes(intentId) && m2.created.profiles.includes(intentId), "Auth id on disk before the drain ended");
    assert.equal(m2.intents[0].status, "resolved", "the confirmed Auth answer resolved its intent");
    await assert.rejects(drained.createUser("client-e", "client"), StopRequestedError, "no new creation after the stop");
  }));

test("base generic Fixtures: a lost Auth create is NOT auto-resolved (declared out of scope) — the manifest exists but cannot claim it", async () =>
  tmp(async (dir) => {
    const db = fakeDb(async (op) => {
      if (op === "createAuthUser") throw Object.assign(new Error("lost response"), { remoteUnknown: true });
    });
    const f = base(dir, db);
    await assert.rejects(f.createUser("client-x", "client"), /lost response/);
    const m = readManifest(f.manifestPath);
    assert.deepEqual(m.created.auth_users, [], "nothing recorded: complete cleanup can never be claimed from this manifest");
  }));
