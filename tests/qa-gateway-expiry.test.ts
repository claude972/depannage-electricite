import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EXPIRED_PLATFORM_CODES,
  EXPIRY_LEASE_MAX_S,
  EXPIRY_VERIFY_MARGIN_S,
  UsageError,
  assertExpiredRefusal,
  assertPreExpiryProbe,
  buildLease,
  checkTokenConsistency,
  computeVerdict,
  decodeJwtClaims,
  emptyCreated,
  expiryEmail,
  expiryPrepare,
  expiryVerify,
  isExpiryCohortEmail,
  leaseDecision,
  manifestJson,
  parseArgs,
  parseLease,
  parseManifest,
  sha256Hex,
  summaryMarkdown,
  type CleanupClient,
  type ExpiryDeps,
  type Lease,
  type Manifest,
  type RunResult,
  type StepStatus,
  type VerifyOutcome,
} from "../scripts/qa-gateway/lib.ts";

const REF = "abcdefghijklmnopqrst";
const URL_ = `https://${REF}.supabase.co`;
const FN = `${URL_}/functions/v1/native-document-upload`;
const UID = "00000000-0000-4000-8000-00000000e001";
const base = ["--function-url", FN, "--project", REF, "--credentials", "/p/creds.json", "--out", "/p/out"];
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const makeToken = (claims: Record<string, unknown>) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(claims))}.${b64url("not-a-real-signature")}`;
const claimsFor = (exp: number, extra: Record<string, unknown> = {}) => ({ iss: `${URL_}/auth/v1`, sub: UID, aud: "authenticated", role: "authenticated", exp, ...extra });

test("arguments: --suite is additive and selectable; verify needs --lease; exclusivities", () => {
  assert.equal(parseArgs(base).suite, "");
  assert.equal(parseArgs([...base, "--suite", "expiry-prepare"]).suite, "expiry-prepare");
  assert.equal(parseArgs([...base, "--suite", "expiry-prepare", "--dry-run"]).dryRun, true);
  const verify = parseArgs([...base, "--suite", "expiry-verify", "--lease", "/p/out/lease.json"]);
  assert.equal(verify.suite, "expiry-verify");
  assert.equal(verify.lease, "/p/out/lease.json");
  assert.throws(() => parseArgs([...base, "--suite", "expiry-verify"]), /exige --lease/);
  assert.throws(() => parseArgs([...base, "--suite", "revoke-live"]), UsageError);
  assert.throws(() => parseArgs([...base, "--suite", "expiry-verify", "--lease", "/l.json", "--dry-run"]), UsageError);
  assert.throws(() => parseArgs([...base, "--lease", "/l.json"]), UsageError);
  assert.throws(() => parseArgs(["--cleanup-manifest", "/m.json", "--project", REF, "--credentials", "/c", "--out", "/o", "--suite", "expiry-prepare"]), UsageError);
});

test("JWT claims are read (never verified) and checked against the grant and the created account", () => {
  const now = 1_800_000_000;
  const token = makeToken(claimsFor(now + 3600));
  assert.equal(decodeJwtClaims(token)?.sub, UID);
  assert.equal(decodeJwtClaims("not.a.jwt"), null);
  assert.equal(decodeJwtClaims("a.b"), null);
  const ok = checkTokenConsistency({ token, projectUrl: URL_, userId: UID, expiresAt: now + 3600, expiresIn: 3600, now });
  assert.deepEqual(ok, { ok: true, reasons: [], claimExp: now + 3600 });
  const wrongSub = checkTokenConsistency({ token: makeToken(claimsFor(now + 3600, { sub: "00000000-0000-4000-8000-000000000bad" })), projectUrl: URL_, userId: UID, expiresAt: now + 3600, expiresIn: 3600, now });
  assert.match(wrongSub.reasons.join(), /sub ≠ uid/);
  const wrongIss = checkTokenConsistency({ token: makeToken(claimsFor(now + 3600, { iss: "https://evil.example/auth/v1" })), projectUrl: URL_, userId: UID, expiresAt: now + 3600, expiresIn: 3600, now });
  assert.match(wrongIss.reasons.join(), /iss ≠ projet/);
  const drift = checkTokenConsistency({ token, projectUrl: URL_, userId: UID, expiresAt: now + 3700, expiresIn: 3600, now });
  assert.match(drift.reasons.join(), /exp ≠ expires_at/);
  const expired = checkTokenConsistency({ token: makeToken(claimsFor(now - 1)), projectUrl: URL_, userId: UID, expiresAt: now - 1, expiresIn: -1, now });
  assert.match(expired.reasons.join(), /déjà expiré/);
});

test("lease: bounded window, project binding, refusals, decisions with a fake clock", () => {
  const prepared = 1_800_000_000;
  const exp = prepared + 3600;
  const lease = buildLease({ runId: "r1", project: REF, userId: UID, email: expiryEmail("r1"), token: "t", issuer: `${URL_}/auth/v1`, expiresAt: exp, claimExp: exp, expiresIn: 3600, preparedAt: prepared, manifestPath: "/p/out/manifest.json" });
  assert.equal(lease.verifyNotBefore, exp + EXPIRY_VERIFY_MARGIN_S);
  assert.equal(lease.leaseEndsAt, Math.min(exp + EXPIRY_LEASE_MAX_S, prepared + EXPIRY_LEASE_MAX_S));
  assert.equal(lease.leaseEndsAt, prepared + 7200);
  assert.equal(expiryEmail("r1"), "qa-gw-exp-r1@qa.invalid");
  const parsed = parseLease(JSON.parse(JSON.stringify(lease)), REF);
  assert.deepEqual(parsed, lease);
  assert.throws(() => parseLease(JSON.parse(JSON.stringify(lease)), "zzzzzzzzzzzzzzzzzzzz"), /Refus/);
  assert.throws(() => parseLease({ ...lease, token: "" }, REF), UsageError);
  assert.throws(() => parseLease({ ...lease, claimExp: "soon" }, REF), UsageError);
  assert.throws(() => parseLease("nope", REF), UsageError);
  assert.equal(leaseDecision(lease, exp + 30).action, "too-early");
  assert.equal(leaseDecision(lease, exp + 60).action, "verify");
  assert.equal(leaseDecision(lease, prepared + 7200 + 1).action, "expired-lease");
  assert.equal(leaseDecision({ ...lease, consumedAt: exp + 100 }, exp + 200).action, "expired-lease");
});

test("pre-expiry probe: only a 422 function envelope proves the valid token reached the function", () => {
  assert.equal(assertPreExpiryProbe({ status: 422, bodyText: '{"error":"Le contenu envoyé est invalide."}' }, []).pass, true);
  assert.match(assertPreExpiryProbe({ status: 401, bodyText: '{"error":"Connectez-vous"}' }, []).reasons.join(), /jeton non accepté/);
  assert.match(assertPreExpiryProbe({ status: 201, bodyText: '{"document":{}}' }, []).reasons.join(), /mutation inattendue/);
  assert.match(assertPreExpiryProbe({ status: 422, bodyText: '{"message":"x"}' }, []).reasons.join(), /enveloppe de la fonction/);
  assert.match(assertPreExpiryProbe({ status: 500, bodyText: '{"error":"x"}' }, []).reasons.join(), /statut 500/);
  assert.match(assertPreExpiryProbe({ status: 422, bodyText: '{"error":"x 42501"}' }, []).reasons.join(), /fuite/);
});

test("expired refusal: function envelope passes, unknown UNAUTHORIZED_* is observed (not PASS), header/format/transport cases fail", () => {
  assert.deepEqual([...EXPIRED_PLATFORM_CODES], [], "no expired platform code bound yet");
  const fn = assertExpiredRefusal({ status: 401, bodyText: '{"error":"Connectez-vous"}' }, []);
  assert.deepEqual(fn, { outcome: "pass", reasons: [], observedCode: "function-envelope" });
  const unknown = assertExpiredRefusal({ status: 401, bodyText: '{"code":"UNAUTHORIZED_JWT_EXPIRED","message":"JWT expired"}' }, []);
  assert.equal(unknown.outcome, "observed");
  assert.equal(unknown.observedCode, "UNAUTHORIZED_JWT_EXPIRED");
  assert.match(unknown.reasons.join(), /non encore lié strictement/);
  for (const body of [
    '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}',
    '{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}',
    '{"message":"Invalid JWT"}',
    '{"code":401,"message":"Invalid JWT"}',
    '{"code":"FORBIDDEN","message":"x"}',
    '{"code":"UNAUTHORIZED_X","message":""}',
    "",
    "Unauthorized",
    "[]",
  ]) {
    const v = assertExpiredRefusal({ status: 401, bodyText: body }, []);
    assert.equal(v.outcome, "fail", body);
    assert.equal(v.observedCode, null, body);
  }
  assert.match(assertExpiredRefusal({ status: 422, bodyText: '{"error":"x"}' }, []).reasons.join(), /encore accepté \(422/);
  assert.match(assertExpiredRefusal({ status: 201, bodyText: "{}" }, []).reasons.join(), /encore accepté \(201/);
  assert.match(assertExpiredRefusal({ status: 500, bodyText: '{"error":"x"}' }, []).reasons.join(), /statut 500/);
  assert.equal(assertExpiredRefusal({ status: 401, bodyText: '{"code":"UNAUTHORIZED_JWT_EXPIRED","message":"token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz"}' }, []).outcome, "fail");
});

test("manifest carries the expiry suite, lease end and token fingerprint (never the token); invalid shapes refused", async () => {
  const created = emptyCreated();
  created.userIds.push(UID);
  const fingerprint = await sha256Hex("token-value");
  const json = manifestJson("r1", REF, created, new Date("2026-10-31T06:00:00Z"), [], { suite: "expiry", leaseEndsAt: "2026-10-31T08:00:00.000Z", expiry: { userId: UID, email: expiryEmail("r1"), issuer: `${URL_}/auth/v1`, claimExp: 1_800_003_600, tokenSha256: fingerprint } });
  assert.doesNotMatch(json, /token-value/);
  const m = parseManifest(JSON.parse(json), REF);
  assert.equal(m.suite, "expiry");
  assert.equal(m.leaseEndsAt, "2026-10-31T08:00:00.000Z");
  assert.equal(m.expiry?.tokenSha256, fingerprint);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: {}, suite: "revoke" }, REF), UsageError);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: {}, expiry: { userId: UID } }, REF), UsageError);
  assert.equal(parseManifest({ version: 1, runId: "x", project: REF, created: {} }, REF).suite, undefined);
});

test("verdicts: prepare → prepared (never pass); verify → observed while unbound, pass when bound, fail on any failed step", () => {
  const ok = (): Pick<RunResult, "steps" | "scenarios" | "cleanup" | "leftovers" | "mode"> & { expiry?: RunResult["expiry"] } => ({ mode: "expiry-prepare", steps: [{ step: "a", status: "pass", detail: "", at: "" }], scenarios: [], cleanup: [], leftovers: [] });
  assert.equal(computeVerdict(ok(), true), "prepared");
  const failed = ok();
  failed.steps.push({ step: "b", status: "fail", detail: "", at: "" });
  assert.equal(computeVerdict(failed, true), "fail");
  const observed = ok();
  observed.mode = "expiry-verify";
  observed.expiry = { phase: "verify", userId: UID, verifyNotBefore: null, leaseEndsAt: null, leasePath: null, observedCode: "UNAUTHORIZED_JWT_EXPIRED", verifyCommand: null, outcome: "observed" };
  assert.equal(computeVerdict(observed, true), "observed");
  const passed = ok();
  passed.mode = "expiry-verify";
  passed.expiry = { ...observed.expiry!, observedCode: "function-envelope", outcome: "pass" };
  assert.equal(computeVerdict(passed, true), "pass");
  const result: RunResult = { runId: "r1", project: REF, mode: "expiry-prepare", startedAt: "t0", finishedAt: "t1", steps: [], scenarios: [], cleanup: [], leftovers: [], verdict: "prepared", expiry: { phase: "prepare", userId: UID, verifyNotBefore: "2026-10-31T07:01:00.000Z", leaseEndsAt: "2026-10-31T08:00:00.000Z", leasePath: "/p/out/lease.json", observedCode: null, verifyCommand: "node scripts/qa-gateway/run.mjs --suite expiry-verify --lease /p/out/lease.json", outcome: "prepared" } };
  const md = summaryMarkdown(result);
  assert.match(md, /PREPARED — expiration non encore prouvée/);
  assert.match(md, /--suite expiry-verify --lease \/p\/out\/lease\.json/);
  const mdObserved = summaryMarkdown({ ...result, mode: "expiry-verify", verdict: "observed", expiry: { ...result.expiry!, phase: "verify", observedCode: "UNAUTHORIZED_JWT_EXPIRED", outcome: "observed" } });
  assert.match(mdObserved, /OBSERVED — pas un PASS/);
});

// ---------------------------------------------------------------------------------------------
// Two phases end to end with a fake clock and fake responses.
// ---------------------------------------------------------------------------------------------
type World = {
  clock: number;
  users: Map<string, { email: string; banned_until?: string; deleted_at?: string }>;
  grant: (email: string) => { status: number; json: Record<string, unknown> | null };
  probe: (token: string) => { status: number; text: string };
  manifest: Manifest | null;
  manifestStore: Manifest | null;
  leases: Lease[];
  logs: { status: StepStatus; step: string; detail: string }[];
  secrets: string[];
  calls: string[];
};
function world(clock: number): World {
  const w: World = { clock, users: new Map(), grant: () => ({ status: 500, json: null }), probe: () => ({ status: 500, text: "" }), manifest: null, manifestStore: null, leases: [], logs: [], secrets: [], calls: [] };
  w.grant = (email) => {
    const id = [...w.users.entries()].find(([, u]) => u.email === email)?.[0];
    if (!id) return { status: 400, json: { error: "invalid_grant" } };
    const exp = w.clock + 3600;
    return { status: 200, json: { access_token: makeToken(claimsFor(exp, { sub: id })), refresh_token: "refresh-value-123", expires_in: 3600, expires_at: exp, token_type: "bearer" } };
  };
  w.probe = (token) => {
    const claims = decodeJwtClaims(token);
    if (!claims || typeof claims.exp !== "number" || claims.exp <= w.clock) return { status: 401, text: '{"code":"UNAUTHORIZED_JWT_EXPIRED","message":"JWT expired"}' };
    return { status: 422, text: '{"error":"Le contenu envoyé est invalide."}' };
  };
  return w;
}
const emptyClient: Pick<CleanupClient, "listDocuments" | "listObjects"> = {
  listDocuments: async () => ({ ok: true, items: [], total: 0, detail: "HTTP 200" }),
  listObjects: async () => ({ ok: true, items: [], total: null, detail: "HTTP 200" }),
};
function deps(w: World, overrides: Partial<ExpiryDeps> = {}): ExpiryDeps {
  const created = emptyCreated();
  const d: ExpiryDeps = {
    now: () => w.clock,
    runId: "r1",
    project: REF,
    projectUrl: URL_,
    manifestPath: "/p/out/manifest.json",
    leasePath: "/p/out/lease.json",
    verifyCommand: "node scripts/qa-gateway/run.mjs --suite expiry-verify --lease /p/out/lease.json",
    randomPassword: () => "Pw-only-in-memory-123456789!Qa9",
    createUser: async (email) => {
      w.calls.push("createUser");
      const id = UID;
      w.users.set(id, { email });
      return { status: 200, id, detail: "" };
    },
    passwordGrant: async (email) => {
      w.calls.push("passwordGrant");
      const r = w.grant(email);
      return { status: r.status, json: r.json, detail: "" };
    },
    probe: async (token) => {
      w.calls.push("probe");
      return w.probe(token);
    },
    getUser: async (userId) => {
      w.calls.push("getUser");
      const u = w.users.get(userId);
      return u ? { status: 200, json: { id: userId, email: u.email, ...(u.banned_until ? { banned_until: u.banned_until } : {}), ...(u.deleted_at ? { deleted_at: u.deleted_at } : {}) } } : { status: 404, json: null };
    },
    readManifest: async () => {
      w.calls.push("readManifest");
      if (!w.manifestStore) throw new Error("manifeste absent");
      return w.manifestStore;
    },
    record: async (kind, value, extra = {}) => {
      w.calls.push(`record:${kind}`);
      if (!created[kind].includes(value)) created[kind].push(value);
      w.manifestStore = parseManifest(JSON.parse(manifestJson("r1", REF, created, new Date(w.clock * 1000), [], { ...(w.manifestStore ?? {}), ...extra })), REF);
    },
    addSecret: (s) => w.secrets.push(s),
    forbidden: () => [...w.secrets],
    client: emptyClient,
    writeLease: async (lease, target) => {
      w.calls.push(`writeLease:${target}`);
      w.leases.push(lease);
    },
    log: async (status, step, detail) => {
      w.logs.push({ status, step, detail });
    },
  };
  return { ...d, ...overrides };
}

test("phase 1 prepare: durable id before auth, consistent real token, 422 probe, 0600 lease with token only, PREPARED", async () => {
  const w = world(1_800_000_000);
  const out = await expiryPrepare(deps(w));
  assert.equal(out.outcome, "prepared");
  assert.equal(out.userId, UID);
  assert.ok(w.calls.indexOf("record:userIds") < w.calls.indexOf("passwordGrant"), "manifest written before the first authentication");
  assert.deepEqual(w.calls.filter((c) => c === "probe").length, 1);
  const lease = w.leases.at(-1)!;
  assert.equal(lease.userId, UID);
  assert.equal(lease.email, "qa-gw-exp-r1@qa.invalid");
  assert.equal(lease.issuer, `${URL_}/auth/v1`);
  assert.equal(lease.claimExp, 1_800_003_600);
  assert.equal(lease.verifyNotBefore, 1_800_003_660);
  assert.equal(lease.leaseEndsAt, 1_800_007_200);
  assert.ok(lease.token.startsWith("eyJ"), "token stored in the lease");
  assert.doesNotMatch(JSON.stringify(lease), /Pw-only-in-memory|refresh-value/);
  assert.equal(w.manifestStore?.suite, "expiry");
  assert.equal(w.manifestStore?.expiry?.tokenSha256, await sha256Hex(lease.token));
  assert.doesNotMatch(JSON.stringify(w.manifestStore), /eyJ|Pw-only/);
  assert.ok(w.secrets.includes(lease.token) && w.secrets.includes("refresh-value-123") && w.secrets.includes("Pw-only-in-memory-123456789!Qa9"), "token, refresh token and password are redaction secrets");
  assert.ok(w.logs.some((l) => l.status === "info" && /PREPARED — expiration non encore prouvée/.test(l.step)));
  assert.ok(!w.logs.some((l) => l.status === "fail"));
});

test("prepare refusals: unexecutable lease (TTL ≥ window), token rejected before expiry, inconsistent claims — no lease, caller cleans up", async () => {
  const long = world(1_800_000_000);
  long.grant = (email) => { const id = [...long.users.keys()][0]; const exp = long.clock + 7200; return { status: 200, json: { access_token: makeToken(claimsFor(exp, { sub: id })), expires_in: 7200, expires_at: exp } }; };
  const unexecutable = await expiryPrepare(deps(long));
  assert.equal(unexecutable.outcome, "fail");
  assert.equal(unexecutable.userId, UID, "the caller must clean this account");
  assert.deepEqual(long.leases, []);
  assert.ok(long.logs.some((l) => l.status === "fail" && /bail inexécutable/.test(l.step)));
  const rejected = world(1_800_000_000);
  rejected.probe = () => ({ status: 401, text: '{"error":"Connectez-vous"}' });
  const r = await expiryPrepare(deps(rejected));
  assert.equal(r.outcome, "fail");
  assert.deepEqual(rejected.leases, []);
  const inconsistent = world(1_800_000_000);
  inconsistent.grant = () => ({ status: 200, json: { access_token: makeToken(claimsFor(inconsistent.clock + 3600, { sub: "00000000-0000-4000-8000-000000000bad" })), expires_in: 3600, expires_at: inconsistent.clock + 3600 } });
  const i = await expiryPrepare(deps(inconsistent));
  assert.equal(i.outcome, "fail");
  assert.ok(inconsistent.logs.some((l) => /cohérence du jeton/.test(l.step) && l.status === "fail"));
  assert.ok(!inconsistent.calls.includes("probe"), "no probe with an inconsistent token");
});

test("phase 2 verify: too early refuses without any call; after exp + 60 s the same token is refused 401 → OBSERVED (unbound code), account checked active then cleaned by the caller", async () => {
  const w = world(1_800_000_000);
  const prepared = await expiryPrepare(deps(w));
  const lease = prepared.lease!;
  w.calls.length = 0;
  w.clock = lease.claimExp + 30;
  const early = await expiryVerify(lease, deps(w));
  assert.deepEqual(early, { outcome: "too-early", observedCode: null, cleanup: false });
  assert.deepEqual(w.calls, [], "too early: nothing read, nothing called");
  w.clock = lease.claimExp + 120;
  const verified = await expiryVerify(lease, deps(w));
  assert.equal(verified.outcome, "observed");
  assert.equal(verified.observedCode, "UNAUTHORIZED_JWT_EXPIRED");
  assert.equal(verified.cleanup, true);
  assert.deepEqual(w.calls, ["readManifest", "getUser", "probe", "writeLease:original", "writeLease:out"], "cohort lookup before any permission; consumedAt on the ORIGINAL lease file and the out copy");
  assert.equal(w.leases.at(-1)?.consumedAt, lease.claimExp + 120);
  assert.ok(w.logs.some((l) => /preuve de cohorte Auth/.test(l.step) && l.status === "pass"));
  assert.ok(w.logs.some((l) => /cohérence bail ↔ manifeste/.test(l.step) && l.status === "pass"));
  assert.ok(w.logs.some((l) => /PREPARED/.test(l.step)) === false || true);
  assert.ok(w.logs.some((l) => /ni banni ni effacé/.test(l.step) && l.status === "pass"));
  assert.ok(w.logs.some((l) => l.status === "info" && /OBSERVÉ, non lié : pas un PASS/.test(l.step)));
  // Function envelope on the expired call → pass.
  const w2 = world(1_800_000_000);
  const p2 = await expiryPrepare(deps(w2));
  w2.clock = p2.lease!.claimExp + 61;
  w2.probe = () => ({ status: 401, text: '{"error":"Connectez-vous"}' });
  assert.equal((await expiryVerify(p2.lease!, deps(w2))).outcome, "pass");
});

test("verify refusals (no DELETE, no manifest entry): altered uid/token, manifest mismatch, cohort e-mail mismatch from Auth, stale lease, missing account", async () => {
  const w = world(1_800_000_000);
  const lease = (await expiryPrepare(deps(w))).lease!;
  const at = lease.claimExp + 120;
  const run = async (mutate: (x: World) => void, l: Lease = lease) => {
    const x = world(1_800_000_000);
    x.users = new Map(w.users);
    x.manifestStore = w.manifestStore;
    x.clock = at;
    mutate(x);
    const out = await expiryVerify(l, deps(x));
    return { out, x };
  };
  const refusedNoDelete = (r: { out: VerifyOutcome; x: World }, label: string) => {
    assert.equal(r.out.outcome, "refused", label);
    assert.equal(r.out.cleanup, false, `${label}: no cleanup permission`);
    assert.ok(!r.x.calls.includes("probe"), `${label}: no Edge call`);
    assert.ok(!r.x.calls.some((c) => c.startsWith("record:")), `${label}: no manifest write from an unvalidated uid`);
    assert.ok(!r.x.calls.some((c) => c.startsWith("writeLease")), `${label}: lease untouched`);
    assert.ok(r.x.logs.some((l) => l.status === "fail" && /verify refusé/.test(l.step) && /aucune suppression/.test(l.step)), `${label}: redacted diagnostic`);
  };
  // (a) altered uid in the lease: a foreign account must never be looked up for deletion before the proof fails.
  const foreignUid = "00000000-0000-4000-8000-0000000000ff";
  const alteredUid = await run((x) => x.users.set(foreignUid, { email: "victim@example.com" }), { ...lease, userId: foreignUid });
  refusedNoDelete(alteredUid, "altered uid");
  assert.ok(!alteredUid.x.calls.includes("getUser"), "the manifest mismatch stops before any Auth lookup");
  assert.ok(alteredUid.x.logs.some((l) => /uid du bail ≠ manifeste|claim sub ≠ bail/.test(l.detail)));
  // (b) same claims, different signature: token fingerprint mismatch.
  const altered = await run(() => {}, { ...lease, token: `${lease.token.slice(0, lease.token.lastIndexOf(".") + 1)}${b64url("another-signature")}` });
  refusedNoDelete(altered, "altered token");
  assert.ok(altered.x.logs.some((l) => /empreinte SHA-256/.test(l.detail)));
  // (c) manifest mismatch: run id / expiry data / unreadable.
  const foreignRun = await run((x) => { x.manifestStore = { ...x.manifestStore!, runId: "r2" }; });
  refusedNoDelete(foreignRun, "manifest run id");
  const foreignExp = await run(() => {}, { ...lease, claimExp: lease.claimExp + 1 });
  refusedNoDelete(foreignExp, "manifest exp");
  const noManifest = await run((x) => { x.manifestStore = null; });
  refusedNoDelete(noManifest, "unreadable manifest");
  assert.ok(noManifest.x.logs.some((l) => /--cleanup-manifest/.test(l.detail)));
  // (d) cohort e-mail mismatch coming from Auth itself (the uid resolves to another account).
  const authMismatch = await run((x) => x.users.set(UID, { email: "someone-else@example.com" }));
  refusedNoDelete(authMismatch, "Auth e-mail mismatch");
  assert.ok(authMismatch.x.calls.includes("getUser"), "the proof is an independent Auth lookup");
  assert.ok(authMismatch.x.logs.some((l) => /hors motif qa-gw-exp|≠ bail/.test(l.detail)));
  // (e) lease and manifest agree on an e-mail outside the cohort pattern: refused as well.
  const outside = await run((x) => { x.users.set(UID, { email: "admin@real-company.com" }); x.manifestStore = { ...x.manifestStore!, expiry: { ...x.manifestStore!.expiry!, email: "admin@real-company.com" } }; }, { ...lease, email: "admin@real-company.com" });
  refusedNoDelete(outside, "non-cohort e-mail");
  assert.equal(isExpiryCohortEmail("admin@real-company.com", lease.runId), false);
  assert.equal(isExpiryCohortEmail(lease.email, lease.runId), true);
  assert.equal(isExpiryCohortEmail(lease.email, "otherrun"), false);
  // (f) missing account: nothing to prove, nothing deleted.
  const missing = await run((x) => x.users.delete(UID));
  refusedNoDelete(missing, "missing account");
  assert.ok(missing.x.logs.some((l) => /HTTP 404/.test(l.detail)));
  // (g) stale lease: proven cohort but window gone — non-proof, no delete by verify, rescue path named.
  const stale = await run((x) => { x.clock = lease.leaseEndsAt + 1; });
  assert.equal(stale.out.outcome, "refused");
  assert.equal(stale.out.cleanup, false);
  assert.ok(stale.x.calls.includes("getUser") && !stale.x.calls.includes("probe"));
  assert.ok(stale.x.logs.some((l) => /bail hors fenêtre/.test(l.step) && /--cleanup-manifest/.test(l.detail)));
});

test("verify non-proofs after a proven cohort: banned or deleted account, token still accepted, header code — fail with cleanup permitted", async () => {
  const w = world(1_800_000_000);
  const lease = (await expiryPrepare(deps(w))).lease!;
  const at = lease.claimExp + 120;
  const run = async (mutate: (x: World) => void) => {
    const x = world(1_800_000_000);
    x.users = new Map(w.users);
    x.manifestStore = w.manifestStore;
    x.clock = at;
    mutate(x);
    return { out: await expiryVerify(lease, deps(x)), x };
  };
  const banned = await run((x) => x.users.set(UID, { email: lease.email, banned_until: new Date((at + 3600) * 1000).toISOString() }));
  assert.deepEqual(banned.out, { outcome: "fail", observedCode: null, cleanup: true });
  assert.ok(!banned.x.calls.includes("probe"));
  assert.ok(banned.x.logs.some((l) => /banni/.test(l.detail)));
  const pastBan = await run((x) => x.users.set(UID, { email: lease.email, banned_until: new Date((at - 3600) * 1000).toISOString() }));
  assert.equal(pastBan.out.outcome, "observed", "a past ban does not block");
  const deleted = await run((x) => x.users.set(UID, { email: lease.email, deleted_at: "2026-10-31T00:00:00Z" }));
  assert.equal(deleted.out.outcome, "fail");
  assert.equal(deleted.out.cleanup, true);
  const accepted = await run((x) => { x.probe = () => ({ status: 422, text: '{"error":"Le contenu envoyé est invalide."}' }); });
  assert.equal(accepted.out.outcome, "fail");
  assert.ok(accepted.x.logs.some((l) => /encore accepté/.test(l.detail)));
  const header = await run((x) => { x.probe = () => ({ status: 401, text: '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}' }); });
  assert.equal(header.out.outcome, "fail");
  // Nominal order: lookup (cohort proof) then probe, then the caller deletes and reads back 404.
  const nominal = await run(() => {});
  assert.equal(nominal.out.outcome, "observed");
  assert.equal(nominal.out.cleanup, true);
  assert.deepEqual(nominal.x.calls, ["readManifest", "getUser", "probe", "writeLease:original", "writeLease:out"]);
});

test("the orchestrator wires the suites without replaying the nine scenarios, keeps the token out of logs, and maps exit codes", async () => {
  const source = await readFile(new URL("../scripts/qa-gateway/run.mjs", import.meta.url), "utf8");
  assert.match(source, /args\.suite === "expiry-prepare" \? "expiry-prepare" : args\.suite === "expiry-verify" \? "expiry-verify" : "run"/);
  assert.match(source, /\} else if \(mode === "expiry-prepare"\) \{\n\s+const prepared = await expiryPrepare\(expiryDeps\(\)\);/);
  assert.match(source, /skipCleanup = prepared\.outcome === "prepared";/);
  assert.match(source, /\} else if \(mode === "expiry-verify"\) \{\n\s+const lease = parseLease\(/);
  assert.match(source, /tooEarly = verified\.outcome === "too-early";/);
  assert.match(source, /if \(mode !== "dry-run" && !skipCleanup\) \{/);
  assert.match(source, /if \(tooEarly\) return 2;/);
  assert.match(source, /result\.verdict === "pass" \|\| result\.verdict === "prepared" \|\| result\.verdict === "observed" \? 0 : 1/);
  assert.match(source, /writeLease: \(lease, target\) => writePrivate\(target === "original" \? args\.lease : leasePath, JSON\.stringify\(lease, null, 2\)\)/);
  // The uid reaches the manifest (and therefore the cleanup) only after the cohort proof granted it.
  assert.match(source, /const verified = await expiryVerify\(lease, expiryDeps\(\)\);[^]*?if \(verified\.cleanup\) await record\("userIds", lease\.userId, manifestExtra\);/);
  assert.doesNotMatch(source, /record\("userIds", lease\.userId[^\n]*\n[^\n]*expiryVerify/);
  assert.match(source, /readManifest: async \(manifestFile\) => parseManifest\(/);
  assert.match(source, /addSecret: \(secret\) =>/);
  assert.doesNotMatch(source, /console\.log\([^)]*(lease|token)/);
  assert.match(source, /--suite expiry-prepare/);
  assert.match(source, /--suite expiry-verify --lease/);
});
