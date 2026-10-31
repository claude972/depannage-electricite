// Full-cycle tests of scripts/qa-gateway/run.mjs main() with an injected runtime: a fake Supabase
// (Auth admin, password grant, PostgREST, Storage) and a fake Edge function behind `fetch`, a fake
// clock, fast reconcile timings, REAL private files on disk (0700 dirs, 0600 files, symlinks) and
// injected throws. These exercise the real try/catch/finally of the runner — not source regexes.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type Runner = { main: (argv: string[], deps: unknown) => Promise<number> };
let runnerPromise: Promise<Runner> | null = null;
const runner = () =>
  // @ts-expect-error run.mjs is plain JavaScript without a declaration file; its surface is typed by Runner.
  (runnerPromise ??= import("../scripts/qa-gateway/run.mjs") as Promise<Runner>);
const REF = "abcdefghijklmnopqrst";
const BASE_URL = `https://${REF}.supabase.co`;
const FN = `${BASE_URL}/functions/v1/native-document-upload`;
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const FAST = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };

type FakeUser = { id: string; email: string; password: string; banned_until?: string; deleted_at?: string };
class FakeCloud {
  clock = 1_800_000_000;
  ttl = 3600;
  health = 200;
  users = new Map<string, FakeUser>();
  deleted: string[] = [];
  calls: string[] = [];
  throwOnBearerProbe = false;
  private seq = 0;
  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers as HeadersInit | undefined);
    this.calls.push(`${method} ${url.pathname}`);
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(method === "HEAD" ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
    if (url.pathname === "/auth/v1/health") return json(this.health, {});
    if (url.href.startsWith(FN)) {
      if (method === "OPTIONS") return new Response(null, { status: 204 });
      const auth = headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ")) return json(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER", message: "Missing authorization header" });
      if (this.throwOnBearerProbe) throw new TypeError("fetch failed");
      const token = auth.slice(7);
      const parts = token.split(".");
      let claims: Record<string, unknown> | null = null;
      try {
        claims = parts.length === 3 ? JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) : null;
      } catch {
        claims = null;
      }
      if (!claims || typeof claims.exp !== "number") return json(401, { code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "Invalid JWT" });
      if (claims.exp <= this.clock) return json(401, { code: "UNAUTHORIZED_JWT_EXPIRED", message: "JWT expired" });
      return json(422, { error: "Le contenu envoyé est invalide." });
    }
    if (url.pathname === "/auth/v1/admin/users" && method === "POST") {
      const body = JSON.parse(String(init.body));
      const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`;
      this.users.set(id, { id, email: body.email, password: body.password });
      return json(200, { id, email: body.email });
    }
    const adminUser = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (adminUser) {
      const u = this.users.get(adminUser[1]);
      if (method === "DELETE") {
        if (u) {
          this.users.delete(u.id);
          this.deleted.push(u.id);
        }
        return json(u ? 200 : 404, {});
      }
      return u ? json(200, { id: u.id, email: u.email, ...(u.banned_until ? { banned_until: u.banned_until } : {}), ...(u.deleted_at ? { deleted_at: u.deleted_at } : {}) }) : json(404, { message: "User not found" });
    }
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init.body));
      const u = [...this.users.values()].find((x) => x.email === body.email && x.password === body.password);
      if (!u) return json(400, { error: "invalid_grant" });
      const exp = this.clock + this.ttl;
      const token = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: `${BASE_URL}/auth/v1`, sub: u.id, aud: "authenticated", role: "authenticated", exp }))}.${b64url("fake-signature")}`;
      return json(200, { access_token: token, refresh_token: `refresh-${u.id}`, expires_in: this.ttl, expires_at: exp, token_type: "bearer" });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (method === "DELETE") return new Response(null, { status: 204 });
      return json(200, [], { "Content-Range": "*/0" });
    }
    if (url.pathname.startsWith("/storage/v1/object/list/")) return json(200, []);
    if (url.pathname.startsWith("/storage/v1/object/") && method === "DELETE") return json(200, []);
    return json(500, { message: `route inconnue ${method} ${url.pathname}` });
  };
}

async function privateDir(root: string, name: string) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}
async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-gw-runner-"));
  await chmod(root, 0o700);
  const creds = path.join(root, "creds.json");
  await writeFile(creds, JSON.stringify({ url: BASE_URL, publishable_key: "sb_publishable_test_key_123456", service_role_key: "sb_secret_test_key_1234567890" }), { mode: 0o600 });
  const cloud = new FakeCloud();
  const printed: string[] = [];
  const deps = () => ({ fetch: cloud.fetch, now: () => cloud.clock, reconcile: FAST, on: () => {}, exit: () => {}, print: (line: string) => printed.push(line) });
  const run = async (args: string[]) => (await runner()).main(args, deps());
  const common = (out: string) => ["--function-url", FN, "--project", REF, "--credentials", creds, "--out", out];
  const prepare = async (name = "exp-1") => {
    const out = await privateDir(root, name);
    const code = await run(["--suite", "expiry-prepare", ...common(out)]);
    return { out, code, lease: path.join(out, "lease.json"), manifest: path.join(out, "manifest.json") };
  };
  const verify = async (lease: string, name: string) => {
    const out = await privateDir(root, name);
    const code = await run(["--suite", "expiry-verify", "--lease", lease, ...common(out)]);
    return { out, code };
  };
  const result = async (out: string) => JSON.parse(await readFile(path.join(out, "result.json"), "utf8"));
  const summary = (out: string) => readFile(path.join(out, "summary.md"), "utf8");
  const cleanup = () => rm(root, { recursive: true, force: true });
  return { root, cloud, run, common, prepare, verify, result, summary, cleanup };
}
const mode = async (file: string) => (await lstat(file)).mode & 0o777;

test("runner full cycle: prepare → PREPARED (account kept, 0600 lease) → verify too early (exit 2, nothing touched) → verify after exp + 60 s → OBSERVED, account deleted, consumedAt on the ORIGINAL lease", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    assert.equal(p.code, 0);
    const r1 = await h.result(p.out);
    assert.equal(r1.verdict, "prepared");
    assert.equal(r1.mode, "expiry-prepare");
    assert.equal(h.cloud.users.size, 1, "one technical account, kept on purpose");
    assert.deepEqual(h.cloud.deleted, []);
    assert.equal(await mode(p.lease), 0o600);
    assert.equal(await mode(p.manifest), 0o600);
    const lease = JSON.parse(await readFile(p.lease, "utf8"));
    const manifest = JSON.parse(await readFile(p.manifest, "utf8"));
    assert.equal(manifest.suite, "expiry");
    assert.deepEqual(manifest.created.userIds, [lease.userId]);
    assert.equal(manifest.expiry.userId, lease.userId);
    assert.doesNotMatch(JSON.stringify(manifest), /eyJ/);
    assert.match(await h.summary(p.out), /PREPARED — expiration non encore prouvée/);
    assert.doesNotMatch(await h.summary(p.out), new RegExp(lease.token.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "token redacted in summary");
    assert.ok(!h.cloud.calls.some((c) => c.includes("/rest/v1/rpc/")), "the nine scenarios are not replayed under --suite");
    // Too early: refused with exit 2, no Auth read of the account, nothing deleted.
    h.cloud.clock = lease.claimExp + 30;
    h.cloud.calls.length = 0;
    const early = await h.verify(p.lease, "exp-early");
    assert.equal(early.code, 2);
    assert.deepEqual(h.cloud.deleted, []);
    assert.ok(!h.cloud.calls.some((c) => /^(GET|DELETE) \/auth\/v1\/admin\/users\//.test(c)), "too early: no account read or delete");
    assert.equal((await h.result(early.out)).verdict, "incomplete");
    // After exp + 60 s: proof, record, probe → observed; cleanup deletes the validated uid.
    h.cloud.clock = lease.claimExp + 120;
    h.cloud.calls.length = 0;
    const v = await h.verify(p.lease, "exp-2");
    assert.equal(v.code, 0);
    const r2 = await h.result(v.out);
    assert.equal(r2.verdict, "observed");
    assert.equal(r2.expiry.observedCode, "UNAUTHORIZED_JWT_EXPIRED");
    assert.deepEqual(h.cloud.deleted, [lease.userId]);
    assert.equal(h.cloud.users.size, 0);
    const getIdx = h.cloud.calls.findIndex((c) => c === `GET /auth/v1/admin/users/${lease.userId}`);
    // The first POST is the preflight anonymous probe; the bearer probe is the last one.
    const probeIdx = h.cloud.calls.lastIndexOf("POST /functions/v1/native-document-upload");
    const delIdx = h.cloud.calls.findIndex((c) => c === `DELETE /auth/v1/admin/users/${lease.userId}`);
    assert.ok(getIdx >= 0 && getIdx < probeIdx && probeIdx < delIdx, "cohort lookup → probe → delete");
    const original = JSON.parse(await readFile(p.lease, "utf8"));
    assert.equal(original.consumedAt, lease.claimExp + 120, "consumedAt written on the ORIGINAL --lease file");
    assert.equal(JSON.parse(await readFile(path.join(v.out, "lease.json"), "utf8")).consumedAt, lease.claimExp + 120);
    assert.equal(await mode(p.lease), 0o600);
    assert.match(await h.summary(v.out), /OBSERVED — pas un PASS/);
    assert.ok(r2.cleanup.some((c: { label: string; ok: boolean }) => c.label === `utilisateur Auth ${lease.userId}` && c.ok), "auth deletion read back 404");
    // A consumed lease cannot be replayed.
    const replay = await h.verify(p.lease, "exp-3");
    assert.equal(replay.code, 1);
    assert.deepEqual(h.cloud.deleted, [lease.userId], "no second deletion");
  } finally {
    await h.cleanup();
  }
});

test("runner: a throw in the probe (Edge call) AFTER the cohort proof still reaches the finally cleanup with the validated uid recorded", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    const lease = JSON.parse(await readFile(p.lease, "utf8"));
    h.cloud.clock = lease.claimExp + 120;
    h.cloud.throwOnBearerProbe = true;
    const v = await h.verify(p.lease, "exp-2");
    assert.equal(v.code, 1);
    const r = await h.result(v.out);
    assert.equal(r.verdict, "fail");
    assert.ok(r.steps.some((s: { step: string }) => s.step === "interruption"));
    assert.deepEqual(h.cloud.deleted, [lease.userId], "validated uid deleted by the finally cleanup");
    const manifest = JSON.parse(await readFile(path.join(v.out, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.created.userIds, [lease.userId], "uid recorded durably before the probe");
    assert.equal(JSON.parse(await readFile(p.lease, "utf8")).consumedAt, undefined, "lease not consumed: the proof was interrupted");
  } finally {
    await h.cleanup();
  }
});

test("runner: a throw in writeLease (original lease dir not writable) after the probe still cleans the validated uid", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    const lease = JSON.parse(await readFile(p.lease, "utf8"));
    h.cloud.clock = lease.claimExp + 120;
    await chmod(p.out, 0o500);
    let v;
    try {
      v = await h.verify(p.lease, "exp-2");
    } finally {
      await chmod(p.out, 0o700);
    }
    assert.equal(v.code, 1);
    assert.ok((await h.result(v.out)).steps.some((s: { step: string; detail: string }) => s.step === "interruption" && /EACCES|permission/i.test(s.detail)));
    assert.deepEqual(h.cloud.deleted, [lease.userId]);
    assert.equal(JSON.parse(await readFile(p.lease, "utf8")).consumedAt, undefined);
  } finally {
    await h.cleanup();
  }
});

test("runner: a failed preflight aborts prepare before any seed — no account, no lease, never PREPARED", async () => {
  const h = await harness();
  try {
    h.cloud.health = 503;
    const p = await h.prepare();
    assert.equal(p.code, 1);
    assert.equal(h.cloud.users.size, 0, "nothing seeded");
    assert.ok(!h.cloud.calls.includes("POST /auth/v1/admin/users"));
    await assert.rejects(readFile(p.lease));
    const r = await h.result(p.out);
    assert.equal(r.verdict, "fail");
    assert.ok(r.steps.some((s: { step: string; detail: string }) => s.step === "interruption" && /préalables en échec/.test(s.detail)));
    assert.doesNotMatch(await h.summary(p.out), /PREPARED/);
  } finally {
    await h.cleanup();
  }
});

test("runner: unexecutable lease (TTL ≥ 2 h) → prepare fails and cleans its own account; no lease written", async () => {
  const h = await harness();
  try {
    h.cloud.ttl = 7200;
    const p = await h.prepare();
    assert.equal(p.code, 1);
    assert.equal(h.cloud.deleted.length, 1);
    assert.equal(h.cloud.users.size, 0);
    await assert.rejects(readFile(p.lease));
    assert.ok((await h.result(p.out)).steps.some((s: { step: string }) => /bail inexécutable/.test(s.step)));
  } finally {
    await h.cleanup();
  }
});

test("runner: symlinked, group-readable or symlink-dir lease files are refused (exit 2) without any delete", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    const lease = JSON.parse(await readFile(p.lease, "utf8"));
    h.cloud.clock = lease.claimExp + 120;
    const link = path.join(await privateDir(h.root, "links"), "lease.json");
    await symlink(p.lease, link);
    const viaLink = await h.verify(link, "exp-link");
    assert.equal(viaLink.code, 2);
    assert.ok((await h.result(viaLink.out)).steps.some((s: { step: string; detail: string }) => s.step === "refus" && /lien symbolique/.test(s.detail)));
    await chmod(p.lease, 0o640);
    const readable = await h.verify(p.lease, "exp-perm");
    assert.equal(readable.code, 2);
    assert.ok((await h.result(readable.out)).steps.some((s: { detail: string }) => /lisible par le groupe/.test(s.detail)));
    await chmod(p.lease, 0o600);
    await chmod(p.out, 0o750);
    const dirPerm = await h.verify(p.lease, "exp-dirperm");
    assert.equal(dirPerm.code, 2);
    await chmod(p.out, 0o700);
    assert.deepEqual(h.cloud.deleted, [], "no deletion on any refusal");
    assert.ok(!h.cloud.calls.some((c) => c.startsWith("DELETE ")));
    // The genuine lease still verifies afterwards.
    assert.equal((await h.verify(p.lease, "exp-ok")).code, 0);
    assert.deepEqual(h.cloud.deleted, [lease.userId]);
  } finally {
    await h.cleanup();
  }
});

test("runner: stale lease → refused without delete, rescue by --cleanup-manifest of the prepare manifest; REVIEW-001 crafted lease (arbitrary uid, foreign e-mail) → refused with zero Auth reads", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    const lease = JSON.parse(await readFile(p.lease, "utf8"));
    h.cloud.clock = lease.leaseEndsAt + 1;
    h.cloud.calls.length = 0;
    const stale = await h.verify(p.lease, "exp-stale");
    assert.equal(stale.code, 1);
    assert.deepEqual(h.cloud.deleted, []);
    assert.ok(!h.cloud.calls.some((c) => c.startsWith("DELETE ")));
    const r = await h.result(stale.out);
    assert.equal(r.verdict, "fail");
    assert.ok(r.steps.some((s: { step: string; detail: string }) => /bail hors fenêtre/.test(s.step) && /--cleanup-manifest/.test(s.detail)));
    assert.deepEqual(JSON.parse(await readFile(path.join(stale.out, "manifest.json"), "utf8")).created.userIds, [lease.userId], "cohort proven: uid recorded, but verify deletes nothing out of window");
    // Rescue path: the prepare manifest (uids written by prepare itself) cleans the account.
    const out = await privateDir(h.root, "rescue");
    const code = await h.run(["--cleanup-manifest", p.manifest, "--project", REF, "--credentials", path.join(h.root, "creds.json"), "--out", out]);
    assert.equal(code, 0);
    assert.deepEqual(h.cloud.deleted, [lease.userId]);
    // REVIEW-001 reproduction: arbitrary uid + non-cohort e-mail in a syntactically valid, stale lease.
    const victim = "00000000-0000-4000-8000-00000000beef";
    h.cloud.users.set(victim, { id: victim, email: "victim@example.com", password: "x" });
    const crafted = { ...lease, userId: victim, email: "victim@example.com" };
    const craftedDir = await privateDir(h.root, "crafted");
    const craftedPath = path.join(craftedDir, "lease.json");
    await writeFile(craftedPath, JSON.stringify(crafted), { mode: 0o600 });
    h.cloud.calls.length = 0;
    const c = await h.verify(craftedPath, "exp-crafted");
    assert.equal(c.code, 2);
    assert.ok(h.cloud.users.has(victim), "foreign account untouched");
    assert.ok(!h.cloud.calls.some((c) => /\/auth\/v1\/admin\/users\//.test(c)), "zero Auth reads/deletes for an unvalidated uid");
    assert.ok((await h.result(c.out)).steps.some((s: { step: string; detail: string }) => s.step === "refus" && /hors cohorte|Bail invalide/.test(s.detail)));
    // Same uid substitution but with the cohort e-mail kept: refused by the manifest check, still no Auth read.
    const crafted2 = { ...lease, userId: victim };
    await writeFile(craftedPath, JSON.stringify(crafted2), { mode: 0o600 });
    h.cloud.clock = lease.claimExp + 120;
    h.cloud.calls.length = 0;
    const c2 = await h.verify(craftedPath, "exp-crafted-2");
    assert.equal(c2.code, 1);
    assert.ok(h.cloud.users.has(victim));
    assert.ok(!h.cloud.calls.some((c) => /\/auth\/v1\/admin\/users\//.test(c)));
    assert.ok((await h.result(c2.out)).steps.some((s: { step: string }) => /verify refusé : cohérence bail/.test(s.step)));
    const manifest2 = await readFile(path.join(c2.out, "manifest.json"), "utf8").catch(() => null);
    assert.ok(manifest2 === null || JSON.parse(manifest2).created.userIds.length === 0, "unvalidated uid never recorded (no manifest written at all, or an empty one)");
  } finally {
    await h.cleanup();
  }
});

test("runner: out dir hygiene — every produced file is 0600 and the directory 0700", async () => {
  const h = await harness();
  try {
    const p = await h.prepare();
    assert.equal(await mode(p.out), 0o700);
    for (const f of await readdir(p.out)) assert.equal(await mode(path.join(p.out, f)), 0o600, f);
  } finally {
    await h.cleanup();
  }
});
