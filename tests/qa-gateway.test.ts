import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SEED_URGENCY,
  UsageError,
  assertCredentialsProject,
  assertFunctionProject,
  assertScenario,
  cleanupPlan,
  cohortEmail,
  cohortPassword,
  computeVerdict,
  emptyCreated,
  fixtures,
  leakCheck,
  makeRedactor,
  manifestJson,
  normalizeCredentials,
  parseArgs,
  parseContentRangeTotal,
  parseManifest,
  projectRef,
  runId,
  scenarioPlan,
  summaryMarkdown,
  discoverCohort,
  runCleanup,
  interruptGuard,
  cleanupRerunMessage,
  unknownLeftover,
  parseStorageListing,
  isPlatformUnauthorizedEnvelope,
  PLATFORM_UNAUTHORIZED_CODES,
  reconcileWindowMs,
  verifyKnownAbsent,
  type CleanupClient,
  type CleanupEntry,
  type Created,
  type RunResult,
  type StepStatus,
  type Unknown,
} from "../scripts/qa-gateway/lib.ts";
import { detectType, MAX_DOCUMENT_BYTES } from "../lib/shared/document-policy";

const REF = "abcdefghijklmnopqrst";
const URL_ = `https://${REF}.supabase.co`;
const FN = `${URL_}/functions/v1/native-document-upload`;
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const D1 = "11111111-1111-4111-8111-111111111111";
const base = ["--function-url", FN, "--project", REF, "--credentials", "/p/creds.json", "--out", "/p/out"];

test("arguments: required options, dry-run, cleanup-manifest mode and refusals", () => {
  const args = parseArgs(base);
  assert.equal(args.functionUrl, FN);
  assert.equal(args.dryRun, false);
  assert.equal(parseArgs([...base, "--dry-run"]).dryRun, true);
  const cleanup = parseArgs(["--cleanup-manifest", "/p/out/manifest.json", "--project", REF, "--credentials", "/p/c.json", "--out", "/p/o2"]);
  assert.equal(cleanup.cleanupManifest, "/p/out/manifest.json");
  assert.equal(cleanup.functionUrl, "");
  assert.throws(() => parseArgs(base.slice(2)), UsageError);
  assert.throws(() => parseArgs([...base, "--bogus"]), UsageError);
  assert.throws(() => parseArgs([...base, "--dry-run", "--cleanup-manifest", "x"]), UsageError);
  assert.throws(() => parseArgs(["--function-url", "http://insecure", ...base.slice(2)]), UsageError);
  assert.throws(() => parseArgs([...base.slice(0, 2), "--project", "short", ...base.slice(4)]), UsageError);
  assert.equal(parseArgs(["--help"]).help, true);
});
test("credentials: aliases accepted, incomplete or foreign urls refused", () => {
  const c = normalizeCredentials({ url: `${URL_}/`, anon_key: "sb_publishable_x", secret_key: "sb_secret_y" });
  assert.deepEqual(c, { url: URL_, publishableKey: "sb_publishable_x", serviceRoleKey: "sb_secret_y" });
  assert.throws(() => normalizeCredentials({ url: URL_, publishable_key: "a" }), UsageError);
  assert.throws(() => normalizeCredentials({ url: "https://evil.example/x", publishable_key: "a", service_role_key: "b" }), UsageError);
  assert.throws(() => normalizeCredentials({ url: `${URL_}/rest`, publishable_key: "a", service_role_key: "b" }), UsageError);
  assert.throws(() => normalizeCredentials([]), UsageError);
});
test("project reference guard refuses any mismatch between --project, credentials and function url", () => {
  assert.equal(projectRef(URL_), REF);
  assert.equal(projectRef(`https://${REF}.functions.supabase.co/native-document-upload`), REF);
  assert.equal(projectRef("https://supabase.co"), null);
  assert.equal(projectRef(`http://${REF}.supabase.co`), null);
  assert.doesNotThrow(() => assertCredentialsProject(REF, URL_));
  assert.throws(() => assertCredentialsProject("zzzzzzzzzzzzzzzzzzzz", URL_), /Refus/);
  assert.doesNotThrow(() => assertFunctionProject(REF, FN));
  assert.doesNotThrow(() => assertFunctionProject(REF, `https://${REF}.functions.supabase.co/native-document-upload`));
  assert.throws(() => assertFunctionProject(REF, "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/native-document-upload"), /Refus/);
  assert.throws(() => assertFunctionProject(REF, `${URL_}/functions/v1/other-function`), UsageError);
});
test("cohort naming is unique per run and passwords are long and random", () => {
  const id = runId(new Date("2026-10-31T06:30:00Z"), new Uint8Array([1, 2, 3]));
  assert.equal(id, "20261031t0630010203");
  assert.equal(cohortEmail(id, "viewer"), `qa-gw-${id}-viewer@example.invalid`);
  assert.notEqual(cohortEmail(id, "client"), cohortEmail(id, "third"));
  const pw = cohortPassword(new Uint8Array(32).map((_, i) => i * 7));
  assert.ok(pw.length >= 28);
  assert.throws(() => cohortPassword(new Uint8Array(3)), UsageError);
  assert.equal(SEED_URGENCY, "scheduled");
});
test("redaction removes keys, JWTs, bearer values and password fields", () => {
  const redact = makeRedactor(["sb_secret_SERVICEKEY123", "sb_publishable_PUB123"]);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz";
  const text = `key sb_secret_SERVICEKEY123 pub sb_publishable_PUB123 Authorization: Bearer ${jwt} {"password":"hunter2hunter2","access_token":"${jwt}"}`;
  const out = redact(text);
  assert.doesNotMatch(out, /SERVICEKEY123|PUB123|hunter2|eyJ/);
  assert.match(out, /\[REDACTED\]/);
});
test("cleanup plan follows the foreign-key order and covers action_limits by actor_id", () => {
  const created = emptyCreated();
  created.userIds.push(U1, U2);
  created.documentIds.push(D1);
  created.objectPaths.push(`${U1}/${D1}`);
  created.interventionIds.push("22222222-2222-4222-8222-222222222222");
  created.organizationIds.push("33333333-3333-4333-8333-333333333333");
  created.siteIds.push("44444444-4444-4444-8444-444444444444");
  const plan = cleanupPlan(created);
  const labels = plan.map((s) => s.label);
  const index = (label: string) => {
    const i = labels.findIndex((l) => l === label);
    assert.ok(i >= 0, label);
    return i;
  };
  assert.equal(plan[0].kind, "storage");
  assert.ok(index("documents par id") < index("interventions par id"));
  assert.ok(index("audit_log par intervention_id") < index("interventions par id"));
  assert.ok(index("interventions par id") < index("organization_members par organization_id"));
  assert.ok(index("organization_members par organization_id") < index("sites par id"));
  assert.ok(index("sites par id") < index("organizations par id"));
  assert.ok(index("organizations par id") < index("action_limits par actor_id"));
  assert.ok(index("audit_log par actor_id") < index(`utilisateur Auth ${U1}`));
  assert.ok(index("artisan_profiles par user_id") < index(`utilisateur Auth ${U1}`));
  assert.equal(plan.at(-1)?.kind, "auth");
  const limits = plan.find((s) => s.label === "action_limits par actor_id");
  assert.equal(limits?.kind === "rest" && limits.filter, `actor_id=in.(${U1},${U2})`);
  assert.equal(cleanupPlan(emptyCreated()).length, 0);
});
test("manifest round-trip and refusals", () => {
  const created = emptyCreated();
  created.userIds.push(U1);
  created.objectPaths.push(`${U1}/${D1}`);
  const json = manifestJson("run1", REF, created, new Date("2026-10-31T06:00:00Z"));
  const parsed = parseManifest(JSON.parse(json), REF);
  assert.deepEqual(parsed.created, created);
  assert.equal(parsed.runId, "run1");
  assert.throws(() => parseManifest(JSON.parse(json), "zzzzzzzzzzzzzzzzzzzz"), /Refus/);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: { userIds: ["not-a-uuid"] } }, REF), UsageError);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: { objectPaths: ["../etc"] } }, REF), UsageError);
  assert.throws(() => parseManifest("nope", REF), UsageError);
});
test("fixtures satisfy the shared magic-byte policy", () => {
  assert.equal(detectType(fixtures.jpeg(2048)), "image/jpeg");
  assert.equal(detectType(fixtures.png()), "image/png");
  assert.equal(fixtures.OVERSIZE, MAX_DOCUMENT_BYTES + 1);
  assert.equal(fixtures.jpeg(fixtures.OVERSIZE).length, MAX_DOCUMENT_BYTES + 1);
});
test("scenario plan covers the pilot's acceptance list", () => {
  const plan = scenarioPlan();
  assert.deepEqual(plan.map((s) => s.expected), [401, 401, 403, 403, 201, 201, 415, 413, 201]);
  assert.ok(plan.some((s) => s.actor === "anonymous"));
  assert.ok(plan.some((s) => s.actor === "invalid"));
  assert.ok(plan.some((s) => s.actor === "third" && s.expected === 403));
  assert.ok(plan.some((s) => s.actor === "viewer" && s.dossier === "site" && s.expected === 403));
  assert.ok(plan.some((s) => s.dossier === null && s.expected === 201));
  for (const s of plan) assert.equal(s.mustCreate, s.expected === 201);
});
test("response assertions catch wrong statuses, leaks and malformed 201 bodies", () => {
  const [anonymous, , , , owner, , fake] = scenarioPlan();
  assert.equal(assertScenario(anonymous, { status: 401, bodyText: '{"error":"Connectez-vous"}' }, []).pass, true);
  assert.match(assertScenario(anonymous, { status: 200, bodyText: "{}" }, []).reasons.join(), /statut 200|succès inattendu/);
  const leak = assertScenario(fake, { status: 415, bodyText: `{"error":"x ${U1}/${D1} 42501"}` }, ["sb_secret_SERVICEKEY123"]);
  assert.equal(leak.pass, false);
  assert.match(leak.reasons.join(), /chemin Storage/);
  assert.match(leak.reasons.join(), /code SQL/);
  assert.deepEqual(leakCheck("Bearer eyJaaaaaaaaaaaaaaaaa.bbb", []), ["contient un JWT"]);
  assert.deepEqual(leakCheck("service_role", []), ["contient un nom de clé serveur"]);
  assert.equal(assertScenario(owner, { status: 201, bodyText: `{"document":{"id":"${D1}","name":"photo.jpg"}}`, document: { id: D1 } }, []).pass, true);
  assert.match(assertScenario(owner, { status: 201, bodyText: "{}", document: null }, []).reasons.join(), /sans document\.id/);
  assert.match(assertScenario(owner, { status: 201, bodyText: `{"document":{"id":"${D1}","path":"x"}}`, document: { id: D1 } }, []).reasons.join(), /expose path/);
});
test("verdict: any failed step fails the run and is never masked by later successes", () => {
  const ok = (): Pick<RunResult, "steps" | "scenarios" | "cleanup" | "leftovers" | "mode"> => ({
    mode: "run",
    steps: [{ step: "a", status: "pass", detail: "", at: "" }],
    scenarios: [{ name: "s", expected: 201, status: 201, pass: true, reasons: [] }],
    cleanup: [{ label: "c", ok: true, remaining: 0, detail: "" }],
    leftovers: [],
  });
  assert.equal(computeVerdict(ok(), true), "pass");
  assert.equal(computeVerdict(ok(), false), "incomplete");
  const failedRead = ok();
  failedRead.steps.push({ step: "relecture", status: "fail", detail: "", at: "" }, { step: "later", status: "pass", detail: "", at: "" });
  assert.equal(computeVerdict(failedRead, true), "fail");
  const failedCleanup = ok();
  failedCleanup.cleanup.push({ label: "x", ok: false, remaining: null, detail: "relecture en erreur" });
  assert.equal(computeVerdict(failedCleanup, true), "fail");
  const leftovers = ok();
  leftovers.leftovers.push("auth user");
  assert.equal(computeVerdict(leftovers, true), "fail");
  const unexecuted = ok();
  unexecuted.scenarios.push({ name: "t", expected: 403, status: null, pass: null, reasons: [] });
  assert.equal(computeVerdict(unexecuted, true), "incomplete");
  const dry = ok();
  dry.mode = "dry-run";
  dry.scenarios = [];
  assert.equal(computeVerdict(dry, true), "pass");
});
test("content-range totals: exact counts only, unknown never reads as zero", () => {
  assert.equal(parseContentRangeTotal("0-0/5"), 5);
  assert.equal(parseContentRangeTotal("*/0"), 0);
  assert.equal(parseContentRangeTotal("*/*"), null);
  assert.equal(parseContentRangeTotal("0-24/*"), null);
  assert.equal(parseContentRangeTotal(null), null);
});
test("summary is redacted markdown with verdict, scenarios, cleanup and leftovers", () => {
  const result: RunResult = {
    runId: "r1",
    project: REF,
    mode: "run",
    startedAt: "t0",
    finishedAt: "t1",
    steps: [{ step: "x", status: "fail", detail: "HTTP 500", at: "t0" }],
    scenarios: [{ name: "s", expected: 201, status: 503, pass: false, reasons: ["statut 503 au lieu de 201"] }],
    cleanup: [{ label: "documents par id", ok: false, remaining: null, detail: "relecture en erreur" }],
    leftovers: ["documents (id=in.(x)) : relecture impossible"],
    verdict: "fail",
  };
  const md = makeRedactor(["sb_secret_SERVICEKEY123"])(summaryMarkdown(result));
  assert.match(md, /verdict \*\*fail\*\*/);
  assert.match(md, /FAIL : statut 503/);
  assert.match(md, /relecture impossible/);
  assert.match(md, /--cleanup-manifest/);
  assert.doesNotMatch(md, /SERVICEKEY/);
});
test("the orchestrator never logs headers or tokens and uses scheduled urgency", async () => {
  const source = await readFile(new URL("../scripts/qa-gateway/run.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.log\([^)]*(headers|token|serviceRoleKey|publishableKey|password)/);
  assert.doesNotMatch(source, /p_urgency: "normal"|urgency: "normal"/);
  assert.match(source, /p_urgency: SEED_URGENCY/);
  assert.match(source, /await record\("userIds", r\.json\.id\);\n\s+await log/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /mode: 0o700/);
  assert.doesNotMatch(source, /from ["'](@supabase|npm:)/);
});

// ---------------------------------------------------------------------------------------------
// GW-HARNESS-003: cleanup discovery with an injected fake Storage/DB client.
// ---------------------------------------------------------------------------------------------
const I1 = "22222222-2222-4222-8222-222222222222";
const D2 = "11111111-1111-4111-8111-111111111112";
const D3 = "11111111-1111-4111-8111-111111111113";
type Row = { id: string; owner_id: string; intervention_id: string | null; path: string };
type FakeState = { rows: Row[]; objects: string[]; users: string[] };
const inIds = (filter: string): [keyof Row, string[]] => {
  const m = /^(\w+)=in\.\((.*)\)$/.exec(filter);
  assert.ok(m, `filtre inattendu ${filter}`);
  return [m[1] as keyof Row, m[2] ? m[2].split(",") : []];
};
function fakeClient(state: FakeState, calls: string[], overrides: Partial<CleanupClient> = {}): CleanupClient {
  const base: CleanupClient = {
    async listDocuments(filter, from, to) {
      calls.push(`list:documents:${filter}:${from}-${to}`);
      const [column, ids] = inIds(filter);
      const rows = state.rows.filter((r) => ids.includes(String(r[column]))).sort((a, b) => a.id.localeCompare(b.id));
      return { ok: true, items: rows.slice(from, to + 1), total: rows.length, detail: "HTTP 200" };
    },
    async listObjects(prefix, { limit, offset, search }) {
      calls.push(`list:storage:${prefix}:${limit}:${offset}${search ? `:${search}` : ""}`);
      const names = state.objects.filter((o) => o.startsWith(`${prefix}/`)).map((o) => o.slice(prefix.length + 1)).filter((n) => !search || n.includes(search)).sort();
      return { ok: true, items: names.slice(offset, offset + limit), total: null, detail: "HTTP 200" };
    },
    async deleteObjects(paths) {
      calls.push(`delete:storage:${paths.join(",")}`);
      state.objects = state.objects.filter((o) => !paths.includes(o));
      return { status: 200, detail: "" };
    },
    async deleteRows(table, filter) {
      calls.push(`delete:rows:${table}:${filter}`);
      if (table === "documents") {
        const [column, ids] = inIds(filter);
        state.rows = state.rows.filter((r) => !ids.includes(String(r[column])));
      }
      return { status: 204, detail: "" };
    },
    async countRows(table, filter) {
      calls.push(`count:${table}:${filter}`);
      if (table !== "documents") return 0;
      const [column, ids] = inIds(filter);
      return state.rows.filter((r) => ids.includes(String(r[column]))).length;
    },
    async deleteUser(userId) {
      calls.push(`delete:user:${userId}`);
      state.users = state.users.filter((u) => u !== userId);
      return { status: 200 };
    },
    async userRemaining(userId) {
      calls.push(`check:user:${userId}`);
      return state.users.includes(userId) ? 1 : 0;
    },
  };
  return { ...base, ...overrides };
}
type Hooked = { manifests: { created: Created; unknown: Unknown[] }[]; notes: { status: StepStatus; step: string; detail: string }[]; entries: CleanupEntry[]; leftovers: string[] };
function hooks(calls: string[]): Hooked & { hooks: Parameters<typeof runCleanup>[2] } {
  const h: Hooked = { manifests: [], notes: [], entries: [], leftovers: [] };
  return {
    ...h,
    hooks: {
      async saveManifest(created, unknown) {
        calls.push("manifest");
        h.manifests.push({ created: structuredClone(created), unknown: structuredClone(unknown) });
      },
      async note(status, step, detail) {
        h.notes.push({ status, step, detail });
      },
      async step(entry, leftover) {
        h.entries.push(entry);
        if (leftover) h.leftovers.push(leftover);
      },
    },
  };
}
const committedUpload = (): FakeState => ({ rows: [{ id: D1, owner_id: U1, intervention_id: I1, path: `${U1}/${D1}` }], objects: [`${U1}/${D1}`], users: [U1] });
const manifestAfterTimeout = (): Created => {
  // The upload was committed server-side but the HTTP call timed out before record("documentIds").
  const created = emptyCreated();
  created.userIds.push(U1);
  created.interventionIds.push(I1);
  return created;
};

test("cleanup: an upload committed before an HTTP timeout is discovered, manifested before any deletion, and deleted objects-first", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const h = hooks(calls);
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json" });
  assert.equal(outcome.clean, true);
  assert.deepEqual(outcome.leftovers, []);
  assert.deepEqual(outcome.discovery.added, { documentIds: [D1], objectPaths: [`${U1}/${D1}`] });
  assert.equal(h.manifests.length, 1);
  assert.deepEqual(h.manifests[0].created.documentIds, [D1]);
  assert.deepEqual(h.manifests[0].created.objectPaths, [`${U1}/${D1}`]);
  assert.deepEqual(h.manifests[0].unknown, []);
  const firstDelete = calls.findIndex((c) => c.startsWith("delete:"));
  assert.ok(firstDelete > calls.indexOf("manifest"), "manifeste écrit avant toute suppression");
  assert.ok(calls.slice(0, firstDelete).every((c) => c.startsWith("list:") || c === "manifest"), "aucune écriture avant la fin de la découverte");
  const storageDelete = calls.indexOf(`delete:storage:${U1}/${D1}`);
  const rowDelete = calls.findIndex((c) => c.startsWith("delete:rows:documents:"));
  assert.ok(storageDelete >= 0 && storageDelete < rowDelete, "objets Storage supprimés avant les lignes documents");
  assert.ok(calls.indexOf(`delete:user:${U1}`) > rowDelete);
  assert.deepEqual(state, { rows: [], objects: [], users: [] });
  assert.ok(outcome.entries.length > 0 && outcome.entries.every((e) => e.ok));
  assert.equal(h.notes[0].status, "pass");
  assert.match(h.notes[0].detail, /1 ligne\(s\) documents et 1 objet\(s\) Storage/);
});
test("cleanup: discovery also covers rows reached by intervention id and objects never written to the manifest", async () => {
  const state: FakeState = {
    rows: [{ id: D1, owner_id: U1, intervention_id: I1, path: `${U1}/${D1}` }, { id: D2, owner_id: U2, intervention_id: I1, path: `${U2}/${D2}` }],
    objects: [`${U1}/${D1}`, `${U2}/${D2}`, `${U1}/${D3}`],
    users: [U1],
  };
  const calls: string[] = [];
  const h = hooks(calls);
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks);
  assert.equal(outcome.clean, true);
  assert.deepEqual([...outcome.created.documentIds].sort(), [D1, D2]);
  assert.deepEqual([...outcome.created.objectPaths].sort(), [`${U1}/${D1}`, `${U1}/${D3}`, `${U2}/${D2}`]);
  assert.deepEqual(state.rows, []);
  assert.deepEqual(state.objects, []);
});
test("cleanup: a failed Storage listing forbids every deletion and the clean verdict, and tells the pilot what to re-run", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const h = hooks(calls);
  const client = fakeClient(state, calls, { listObjects: async () => ({ ok: false, detail: "HTTP 403 bucket access denied" }) });
  const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json" });
  assert.equal(outcome.clean, false);
  assert.equal(outcome.discovery.complete, false);
  assert.ok(calls.every((c) => !c.startsWith("delete:")), "aucune suppression quand une lecture est inconnue");
  assert.deepEqual(outcome.entries, []);
  assert.deepEqual(state, committedUpload());
  assert.equal(h.manifests.length, 1);
  assert.deepEqual(h.manifests[0].created.documentIds, [D1], "les lignes lues sont tout de même fusionnées");
  assert.equal(h.manifests[0].unknown.length, 1);
  assert.match(h.manifests[0].unknown[0].scope, new RegExp(`^Storage ${U1}/`));
  assert.match(h.manifests[0].unknown[0].detail, /HTTP 403/);
  assert.deepEqual(outcome.leftovers, [unknownLeftover(h.manifests[0].unknown[0])]);
  assert.equal(h.notes[0].status, "fail");
  assert.match(h.notes[0].detail, /aucune suppression effectuée/);
  assert.match(h.notes[0].detail, /--cleanup-manifest \/p\/out\/manifest\.json/);
  assert.equal(cleanupRerunMessage("/x/m.json").includes("--cleanup-manifest /x/m.json"), true);
});
test("cleanup: a documents read that throws, times out or has no exact count is unknown, never empty", async () => {
  for (const listDocuments of [
    async () => { throw new Error("The operation was aborted due to timeout"); },
    async () => ({ ok: false as const, detail: "HTTP 500" }),
    async () => ({ ok: true as const, items: [], total: null, detail: "HTTP 200" }),
  ]) {
    const state = committedUpload();
    const calls: string[] = [];
    const h = hooks(calls);
    const outcome = await runCleanup(fakeClient(state, calls, { listDocuments }), manifestAfterTimeout(), h.hooks);
    assert.equal(outcome.clean, false);
    assert.ok(calls.every((c) => !c.startsWith("delete:")));
    assert.ok(outcome.discovery.unknown.length >= 1);
    assert.ok(outcome.discovery.unknown.every((u) => u.scope.startsWith("documents par ")));
    assert.deepEqual(state, committedUpload());
  }
});
test("discovery: pagination merges every page and reports truncation or short pages as unknown", async () => {
  const objects = [D1, D2, D3, "11111111-1111-4111-8111-111111111114", "11111111-1111-4111-8111-111111111115"].map((d) => `${U1}/${d}`);
  const rows: Row[] = [D1, D2, D3].map((id) => ({ id, owner_id: U1, intervention_id: null, path: `${U1}/${id}` }));
  const calls: string[] = [];
  const found = await discoverCohort(fakeClient({ rows, objects, users: [U1] }, calls), manifestAfterTimeout(), { pageSize: 2 });
  assert.equal(found.complete, true);
  assert.deepEqual([...found.created.objectPaths].sort(), [...objects].sort());
  assert.deepEqual([...found.created.documentIds].sort(), [D1, D2, D3]);
  assert.equal(calls.filter((c) => c.startsWith(`list:storage:${U1}:2:`)).length, 3);
  assert.equal(calls.filter((c) => c.startsWith("list:documents:owner_id")).length, 2);
  // Endless pages: the cap turns into an explicit unknown instead of a silent partial listing.
  const endless = fakeClient({ rows: [], objects: [], users: [] }, [], { listObjects: async () => ({ ok: true, items: [D1], total: null, detail: "" }) });
  const truncated = await discoverCohort(endless, manifestAfterTimeout(), { pageSize: 1, maxPages: 3 });
  assert.equal(truncated.complete, false);
  assert.match(truncated.unknown[0].detail, /pagination tronquée après 3 page/);
  // A total of 3 with an empty page is a contradiction: unknown.
  const short = fakeClient({ rows: [], objects: [], users: [] }, [], { listDocuments: async () => ({ ok: true, items: [], total: 3, detail: "" }) });
  const contradiction = await discoverCohort(short, manifestAfterTimeout());
  assert.equal(contradiction.complete, false);
  assert.match(contradiction.unknown[0].detail, /page vide avant le total annoncé/);
});
test("discovery: rows or objects outside the <uid>/<id> convention are unknown and block deletion", async () => {
  const calls: string[] = [];
  const h = hooks(calls);
  const state: FakeState = { rows: [{ id: D1, owner_id: U1, intervention_id: null, path: "legacy/photo.jpg" }], objects: [`${U1}/.emptyFolderPlaceholder`], users: [U1] };
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks);
  assert.equal(outcome.clean, false);
  assert.deepEqual(outcome.created.documentIds, [D1]);
  assert.deepEqual(outcome.created.objectPaths, []);
  assert.equal(outcome.discovery.unknown.length, 2);
  assert.match(outcome.discovery.unknown.map((u) => u.detail).join(), /hors convention/);
  assert.ok(calls.every((c) => !c.startsWith("delete:")));
});
test("cleanup: nothing to discover when the manifest is empty; a failed readback after deletion still fails the cleanup", async () => {
  const calls: string[] = [];
  const h = hooks(calls);
  const empty = await runCleanup(fakeClient({ rows: [], objects: [], users: [] }, calls), emptyCreated(), h.hooks);
  assert.equal(empty.clean, true);
  assert.deepEqual(calls, ["manifest"]);
  assert.deepEqual(empty.entries, []);
  const state = committedUpload();
  const calls2: string[] = [];
  const h2 = hooks(calls2);
  const client = fakeClient(state, calls2, { countRows: async () => null });
  const outcome = await runCleanup(client, manifestAfterTimeout(), h2.hooks);
  assert.equal(outcome.clean, false);
  assert.ok(outcome.entries.some((e) => !e.ok && e.remaining === null));
  assert.ok(outcome.leftovers.some((l) => /relecture impossible/.test(l)));
});
test("manifest: unknown reads round-trip and malformed entries are refused", () => {
  const created = emptyCreated();
  created.userIds.push(U1);
  const unknown: Unknown[] = [{ scope: `Storage ${U1}/`, detail: "listage en erreur : HTTP 500" }];
  const json = manifestJson("run1", REF, created, new Date("2026-10-31T06:00:00Z"), unknown);
  const parsed = parseManifest(JSON.parse(json), REF);
  assert.deepEqual(parsed.unknown, unknown);
  assert.deepEqual(parseManifest({ version: 1, runId: "x", project: REF, created: {} }, REF).unknown, []);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: {}, unknown: "nope" }, REF), UsageError);
  assert.throws(() => parseManifest({ version: 1, runId: "x", project: REF, created: {}, unknown: [{ scope: 1 }] }, REF), UsageError);
});
test("interruption: the first signal aborts the running phase (cleanup still runs), the second aborts cleanup, the third exits 130", async () => {
  const handlers: Record<string, () => void> = {};
  const aborts: string[] = [];
  const exits: number[] = [];
  const active = new AbortController();
  const guard = interruptGuard((event, handler) => { handlers[event] = handler; }, { abort: (reason) => { aborts.push(reason.message); active.abort(reason); }, exit: (code) => exits.push(code) });
  assert.deepEqual(Object.keys(handlers).sort(), ["SIGINT", "SIGTERM"]);
  handlers.SIGINT();
  assert.equal(active.signal.aborted, true);
  assert.match(aborts[0], /découverte de cohorte puis nettoyage/);
  assert.deepEqual(exits, []);
  // The aborted run phase does not prevent discovery: cleanup uses the injected client directly.
  const state = committedUpload();
  const calls: string[] = [];
  const h = hooks(calls);
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks);
  assert.equal(outcome.clean, true);
  assert.deepEqual(h.manifests[0].created.objectPaths, [`${U1}/${D1}`]);
  handlers.SIGTERM();
  assert.match(aborts[1], /manifeste conservé/);
  assert.deepEqual(exits, []);
  handlers.SIGINT();
  assert.deepEqual(exits, [130]);
  assert.equal(guard.count(), 3);
});
test("the orchestrator wires discovery-first cleanup into every exit path", async () => {
  const source = await readFile(new URL("../scripts/qa-gateway/run.mjs", import.meta.url), "utf8");
  assert.match(source, /interruptGuard\(\(event, handler\) => process\.on\(event, handler\)/);
  assert.match(source, /AbortSignal\.any\(\[active\.signal, AbortSignal\.timeout\(TIMEOUT_MS\)\]\)/);
  assert.match(source, /\} finally \{\n\s+if \(mode !== "dry-run"\) \{\n\s+try \{\n\s+await cleanup\(\);/);
  assert.match(source, /async function cleanup\(\) \{\n[^]*?active = new AbortController\(\);\n[^]*?await runCleanup\(client, created, \{/);
  assert.match(source, /saveManifest: \(nextCreated, unknown\) => saveManifest\(nextCreated, unknown\)/);
  assert.match(source, /reconcile: interrupted \|\| mode === "cleanup-manifest" \? RECONCILE : undefined/);
  assert.match(source, /\} catch \(error\) \{\n\s+interrupted = true;/);
  assert.match(source, /parseStorageListing\(r\.json\)/);
  assert.doesNotMatch(source, /\.map\(\(o\) => o\?\.name\)\.filter/);
  assert.doesNotMatch(source, /process\.exit\(\)/);
  assert.doesNotMatch(source, /cleanupPlan/);
});

// ---------------------------------------------------------------------------------------------
// Pilot follow-ups on 981aec3: malformed Storage rows are unknown; late reconciliation after an
// aborted/timed-out phase.
// ---------------------------------------------------------------------------------------------
test("storage listing: a row without a name (or of any other shape) is malformed, never absent", () => {
  const parsed = parseStorageListing([{ name: D1, id: "x" }, { id: "y", metadata: null }, null, "str", { name: "" }]);
  assert.deepEqual(parsed.items, [D1]);
  assert.equal(parsed.malformed.length, 4);
  assert.match(parsed.malformed[0], /entrée 1 sans name/);
  assert.match(parsed.malformed[1], /entrée 2 sans name \(object\)/);
  assert.deepEqual(parseStorageListing({}).items, []);
  assert.equal(parseStorageListing({}).malformed.length, 1);
  assert.deepEqual(parseStorageListing([]), { items: [], malformed: [] });
});
test("cleanup: a nameless Storage row is persisted as unknown, forbids every deletion and fails with the re-run message", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const h = hooks(calls);
  const client = fakeClient(state, calls, { listObjects: async () => ({ ok: true, items: [D1], total: null, detail: "HTTP 200", malformed: ["entrée 1 sans name (clés id,metadata)"] }) });
  const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json" });
  assert.equal(outcome.clean, false);
  assert.ok(calls.every((c) => !c.startsWith("delete:")));
  assert.deepEqual(outcome.created.objectPaths, [`${U1}/${D1}`], "the well-formed name is still merged");
  assert.equal(h.manifests[0].unknown.length, 1);
  assert.equal(h.manifests[0].unknown[0].scope, `Storage ${U1}/`);
  assert.match(h.manifests[0].unknown[0].detail, /forme inattendue dans le listage : entrée 1 sans name/);
  assert.match(h.notes[0].detail, /--cleanup-manifest \/p\/out\/manifest\.json/);
  assert.deepEqual(state, committedUpload());
  // Same shape during the post-delete readback: the readback is unknown, never "gone".
  const state2 = committedUpload();
  const calls2: string[] = [];
  const h2 = hooks(calls2);
  let listings = 0;
  const base = fakeClient(state2, calls2);
  const flaky = { ...base, listObjects: async (prefix: string, o: { limit: number; offset: number; search?: string }) => { const page = await base.listObjects(prefix, o); return o.search && ++listings ? { ...page, malformed: ["entrée 0 sans name (clés id)"] } : page; } };
  const outcome2 = await runCleanup(flaky, manifestAfterTimeout(), h2.hooks);
  assert.equal(outcome2.clean, false);
  const storage = outcome2.entries.find((e) => e.label === "objets Storage de la cohorte");
  assert.equal(storage?.ok, false);
  assert.equal(storage?.remaining, null);
});
const reconcile = (delays: number[], onSleep?: (attempt: number) => void, calls?: string[]) => ({ attempts: 3, baseDelayMs: 10, sleep: async (ms: number) => { delays.push(ms); calls?.push(`sleep:${ms}`); onSleep?.(delays.length); } });
test("cleanup: after an aborted phase the late reconcile finds the settled upload, manifests it and deletes it", async () => {
  const state: FakeState = { rows: [], objects: [], users: [U1] };
  const calls: string[] = [];
  const delays: number[] = [];
  const h = hooks(calls);
  // The upload/finalization that timed out settles remotely during the first backoff.
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json", reconcile: reconcile(delays, (attempt) => { if (attempt === 1) { state.rows.push({ id: D1, owner_id: U1, intervention_id: I1, path: `${U1}/${D1}` }); state.objects.push(`${U1}/${D1}`); } }, calls) });
  assert.deepEqual(delays, [10, 20, 40], "the full backoff window is observed even though attempt 2 already found nothing new");
  assert.ok(calls.indexOf("sleep:40") < calls.findIndex((c) => c.startsWith("delete:")), "every backoff elapsed before the first deletion");
  assert.equal(calls.filter((c) => c.startsWith("sleep:")).length, 3);
  assert.equal(outcome.clean, true);
  assert.deepEqual(outcome.created.documentIds, [D1]);
  assert.deepEqual(outcome.created.objectPaths, [`${U1}/${D1}`]);
  const settledManifest = h.manifests.findIndex((m) => m.created.objectPaths.includes(`${U1}/${D1}`));
  assert.ok(settledManifest >= 0);
  const manifestCall = calls.map((c, i) => [c, i] as const).filter(([c]) => c === "manifest")[settledManifest][1];
  assert.ok(manifestCall < calls.findIndex((c) => c.startsWith("delete:")), "settled object manifested before any deletion");
  assert.ok(calls.indexOf(`delete:storage:${U1}/${D1}`) < calls.findIndex((c) => c.startsWith("delete:rows:documents:")));
  assert.deepEqual(state, { rows: [], objects: [], users: [] });
  assert.ok(h.notes.some((n) => /règlement tardif détecté/.test(n.step)));
  assert.ok(h.notes.some((n) => n.status === "pass" && /fenêtre complète observée avant toute suppression \(3 passes, 70 ms de replis\)/.test(n.step)));
  assert.ok(h.notes.some((n) => /réconciliation tardive 3\/3 : rien de nouveau/.test(n.step)));
  assert.ok(h.notes.some((n) => n.status === "pass" && /réconciliation finale/.test(n.step)));
  // No reconcile requested: no sleep, single discovery (unchanged nominal behaviour).
  const calls2: string[] = [];
  await runCleanup(fakeClient(committedUpload(), calls2), manifestAfterTimeout(), hooks(calls2).hooks);
  assert.equal(calls2.filter((c) => c.startsWith(`list:storage:${U1}:1000:0`) && !c.includes(`:${D1}`)).length, 1);
});
test("cleanup: a late reconcile whose reads keep failing exhausts the window, deletes nothing and fails with the re-run message", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const delays: number[] = [];
  const h = hooks(calls);
  const base = fakeClient(state, calls);
  let discoveries = 0;
  const client = { ...base, listObjects: async (prefix: string, o: { limit: number; offset: number; search?: string }) => (o.offset === 0 && !o.search && ++discoveries > 1 ? { ok: false as const, detail: "HTTP 503 storage unavailable" } : base.listObjects(prefix, o)) };
  const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json", reconcile: reconcile(delays) });
  assert.deepEqual(delays, [10, 20, 40]);
  assert.equal(outcome.clean, false);
  assert.ok(calls.every((c) => !c.startsWith("delete:")));
  assert.deepEqual(state, committedUpload());
  const last = h.manifests.at(-1)!;
  assert.equal(last.unknown.length, 1);
  assert.match(last.unknown[0].detail, /HTTP 503/);
  assert.deepEqual(last.created.objectPaths, [`${U1}/${D1}`], "the first discovery stays merged");
  const fail = h.notes.find((n) => n.status === "fail");
  assert.match(fail?.step ?? "", /réconciliation tardive incomplète/);
  assert.match(fail?.detail ?? "", /--cleanup-manifest \/p\/out\/manifest\.json/);
  assert.deepEqual(outcome.leftovers, [unknownLeftover(last.unknown[0])]);
});
test("cleanup: a cohort that keeps settling inside the window is not stable: no deletion, fail", async () => {
  const state: FakeState = { rows: [], objects: [], users: [U1] };
  const calls: string[] = [];
  const delays: number[] = [];
  const h = hooks(calls);
  const ids = [D1, D2, D3];
  const outcome = await runCleanup(fakeClient(state, calls), manifestAfterTimeout(), h.hooks, { reconcile: reconcile(delays, (attempt) => state.objects.push(`${U1}/${ids[attempt - 1]}`)) });
  assert.deepEqual(delays, [10, 20, 40]);
  assert.equal(outcome.clean, false);
  assert.ok(calls.every((c) => !c.startsWith("delete:")));
  assert.equal(outcome.created.objectPaths.length, 3, "everything seen is manifested");
  assert.match(h.manifests.at(-1)!.unknown[0].detail, /non stabilisée : règlement tardif encore trouvé à la dernière passe 3\/3 \(fenêtre 70 ms\)/);
});
test("cleanup: a settle that lands after the deletion pass is caught by the final reconcile and reported for re-run", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const delays: number[] = [];
  const h = hooks(calls);
  const base = fakeClient(state, calls);
  const client = { ...base, deleteUser: async (userId: string) => { state.objects.push(`${U1}/${D2}`); return base.deleteUser(userId); } };
  const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json", reconcile: reconcile(delays) });
  assert.deepEqual(delays, [10, 20, 40]);
  assert.equal(outcome.clean, false);
  assert.ok(outcome.created.objectPaths.includes(`${U1}/${D2}`));
  assert.ok(h.manifests.at(-1)!.created.objectPaths.includes(`${U1}/${D2}`));
  assert.match(h.manifests.at(-1)!.unknown[0].detail, /règlement tardif après nettoyage/);
  const fail = h.notes.find((n) => /réconciliation finale/.test(n.step));
  assert.equal(fail?.status, "fail");
  assert.match(fail?.detail ?? "", /--cleanup-manifest \/p\/out\/manifest\.json/);
  assert.ok(outcome.leftovers.some((l) => /règlement tardif après nettoyage/.test(l)));
  assert.ok(calls.filter((c) => c.startsWith("delete:")).length > 0, "the known cohort was still deleted before the final check");
});

// ---------------------------------------------------------------------------------------------
// Pilot follow-ups on 71dd522: reappearance of KNOWN items after deletion; full window always.
// ---------------------------------------------------------------------------------------------
test("reconcile window: the guaranteed wait is the sum of all backoffs (run.mjs: 2+4+8+16 s = 30 s)", () => {
  assert.equal(reconcileWindowMs({ attempts: 4, baseDelayMs: 2000 }), 30000);
  assert.equal(reconcileWindowMs({ attempts: 3, baseDelayMs: 10 }), 70);
  assert.equal(reconcileWindowMs({ attempts: 0, baseDelayMs: 10 }), 10);
});
test("final reconciliation: a KNOWN object or row that reappears after the deletion pass fails, never clean", async () => {
  for (const what of ["object", "row", "both"] as const) {
    const state = committedUpload();
    const calls: string[] = [];
    const delays: number[] = [];
    const h = hooks(calls);
    const base = fakeClient(state, calls);
    // Reappearance of items already in the manifest, right after the last deletion step.
    const client = { ...base, deleteUser: async (userId: string) => {
      const r = await base.deleteUser(userId);
      if (what !== "row") state.objects.push(`${U1}/${D1}`);
      if (what !== "object") state.rows.push({ id: D1, owner_id: U1, intervention_id: I1, path: `${U1}/${D1}` });
      return r;
    } };
    const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { manifestPath: "/p/out/manifest.json", reconcile: reconcile(delays) });
    assert.equal(outcome.clean, false, what);
    assert.ok(outcome.entries.every((e) => e.ok), "every deletion step had read back clean before the reappearance");
    const last = h.manifests.at(-1)!;
    assert.deepEqual(last.created.documentIds, [D1]);
    assert.deepEqual(last.created.objectPaths, [`${U1}/${D1}`]);
    const details = last.unknown.map((u) => u.detail).join(" | ");
    if (what !== "row") assert.match(details, new RegExp(`réapparition : objet Storage ${U1}/${D1} présent après nettoyage`));
    if (what !== "object") assert.match(details, new RegExp(`réapparition : ligne documents ${D1} présente après nettoyage`));
    assert.equal(last.unknown.length, what === "both" ? 2 : 1);
    const fail = h.notes.find((n) => /réconciliation finale/.test(n.step));
    assert.equal(fail?.status, "fail");
    assert.match(fail?.detail ?? "", /--cleanup-manifest \/p\/out\/manifest\.json/);
    assert.equal(outcome.leftovers.length, last.unknown.length);
  }
});
test("final reconciliation: a read that cannot confirm the absence of a known item is unknown (fail), a clean one verifies every known id/path", async () => {
  const state = committedUpload();
  const calls: string[] = [];
  const h = hooks(calls);
  const base = fakeClient(state, calls);
  let afterDeletion = false;
  const client = { ...base,
    deleteUser: async (userId: string) => { afterDeletion = true; return base.deleteUser(userId); },
    listDocuments: async (filter: string, from: number, to: number) => (afterDeletion && filter.startsWith("id=in.") ? { ok: false as const, detail: "HTTP 500" } : base.listDocuments(filter, from, to)),
  };
  const outcome = await runCleanup(client, manifestAfterTimeout(), h.hooks, { reconcile: reconcile([]) });
  assert.equal(outcome.clean, false);
  assert.match(h.manifests.at(-1)!.unknown[0].scope, /documents par id/);
  assert.match(h.manifests.at(-1)!.unknown[0].detail, /HTTP 500/);
  // Direct check of the presence helper.
  const present = await verifyKnownAbsent(fakeClient(committedUpload(), []), { ...emptyCreated(), documentIds: [D1, D2], objectPaths: [`${U1}/${D1}`, `${U1}/${D2}`] });
  assert.deepEqual(present.present, { documentIds: [D1], objectPaths: [`${U1}/${D1}`] });
  assert.deepEqual(present.unknown, []);
  const nameless = await verifyKnownAbsent(fakeClient({ rows: [], objects: [], users: [] }, [], { listObjects: async () => ({ ok: true, items: [], total: null, detail: "", malformed: ["entrée 0 sans name (clés id)"] }) }), { ...emptyCreated(), objectPaths: [`${U1}/${D1}`] });
  assert.equal(nameless.unknown.length, 1);
  assert.match(nameless.unknown[0].detail, /forme inattendue/);
  // Clean path: the known cohort is verified absent after deletion (note names the counts).
  const calls2: string[] = [];
  const h2 = hooks(calls2);
  const clean = await runCleanup(fakeClient(committedUpload(), calls2), manifestAfterTimeout(), h2.hooks, { reconcile: reconcile([]) });
  assert.equal(clean.clean, true);
  assert.ok(calls2.some((c) => c.startsWith("list:documents:id=in.(") ), "known rows re-read by id after deletion");
  assert.ok(h2.notes.some((n) => n.status === "pass" && /réconciliation finale/.test(n.step) && /1 ligne\(s\) et 1 objet\(s\) connus vérifiés absents/.test(n.detail)));
});

// ---------------------------------------------------------------------------------------------
// verify_jwt: true — the platform answers missing/invalid JWT before the function (cloud run of d7abd8c).
// ---------------------------------------------------------------------------------------------
test("platform 401 envelope: accepted strictly (non-empty message, optional numeric code 401), never generic", () => {
  assert.equal(isPlatformUnauthorizedEnvelope('{"message":"Invalid JWT"}'), true);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":401,"message":"Invalid JWT"}'), true);
  assert.equal(isPlatformUnauthorizedEnvelope('{"message":"Missing authorization header","hint":"x"}'), true);
  assert.equal(isPlatformUnauthorizedEnvelope('{}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope(''), false);
  assert.equal(isPlatformUnauthorizedEnvelope('null'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('[]'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('"Unauthorized"'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"message":""}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"message":"   "}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"message":42}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":"401","message":"Invalid JWT"}'), false);
  // Real bodies published by the pilot (verify_jwt: true), verbatim.
  const NO_HEADER = '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}';
  const BAD_JWT = '{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}';
  assert.deepEqual(PLATFORM_UNAUTHORIZED_CODES, { anonymous: "UNAUTHORIZED_NO_AUTH_HEADER", invalid: "UNAUTHORIZED_INVALID_JWT_FORMAT" });
  assert.equal(isPlatformUnauthorizedEnvelope(NO_HEADER), true);
  assert.equal(isPlatformUnauthorizedEnvelope(BAD_JWT), true);
  assert.equal(isPlatformUnauthorizedEnvelope(NO_HEADER, "anonymous"), true);
  assert.equal(isPlatformUnauthorizedEnvelope(BAD_JWT, "invalid"), true);
  // Bound to the scenario: swapped codes are refused.
  assert.equal(isPlatformUnauthorizedEnvelope(NO_HEADER, "invalid"), false);
  assert.equal(isPlatformUnauthorizedEnvelope(BAD_JWT, "anonymous"), false);
  // No other string code, with or without binding.
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":"UNAUTHORIZED_OTHER","message":"Unauthorized"}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":"UNAUTHORIZED_OTHER","message":"Unauthorized"}', "anonymous"), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":"unauthorized_no_auth_header","message":"x"}', "anonymous"), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":""}', "anonymous"), false);
  // The numeric form stays accepted for both scenarios.
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":401,"message":"Invalid JWT"}', "anonymous"), true);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":401,"message":"Invalid JWT"}', "invalid"), true);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":403,"message":"Forbidden"}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('{"code":500,"message":"boom"}'), false);
  assert.equal(isPlatformUnauthorizedEnvelope('not json'), false);
});
test("anonymous and invalid-token scenarios pass on a 401 with either the function or the platform envelope", () => {
  const [anonymous, invalid] = scenarioPlan();
  const observed = { anonymous: '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}', invalid: '{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}' } as const;
  assert.equal(assertScenario(anonymous, { status: 401, bodyText: observed.anonymous }, []).pass, true, "anonymous: observed platform body");
  assert.equal(assertScenario(invalid, { status: 401, bodyText: observed.invalid }, []).pass, true, "invalid: observed platform body");
  // Swapped codes fail on both scenarios; a foreign string code fails too.
  for (const [scenario, body] of [[anonymous, observed.invalid], [invalid, observed.anonymous]] as const) {
    const swapped = assertScenario(scenario, { status: 401, bodyText: body }, []);
    assert.equal(swapped.pass, false, `${scenario.actor} swapped code`);
    assert.deepEqual(swapped.reasons, ["corps d’erreur sans message"]);
  }
  for (const scenario of [anonymous, invalid]) {
    assert.equal(assertScenario(scenario, { status: 401, bodyText: '{"code":"UNAUTHORIZED_OTHER","message":"Unauthorized"}' }, []).pass, false, `${scenario.actor} other string code`);
    // A 403 with the observed codes is still a wrong status (and not a function body).
    const forbiddenObserved = assertScenario(scenario, { status: 403, bodyText: observed[scenario.actor as "anonymous" | "invalid"] }, []);
    assert.equal(forbiddenObserved.pass, false);
    assert.match(forbiddenObserved.reasons.join(), /statut 403 au lieu de 401/);
    assert.match(forbiddenObserved.reasons.join(), /corps d’erreur sans message/);
    assert.equal(assertScenario(scenario, { status: 401, bodyText: '{"error":"Connectez-vous"}' }, []).pass, true, `${scenario.actor} function envelope`);
    assert.equal(assertScenario(scenario, { status: 401, bodyText: '{"message":"Invalid JWT"}' }, []).pass, true, `${scenario.actor} platform message`);
    assert.equal(assertScenario(scenario, { status: 401, bodyText: '{"code":401,"message":"Invalid JWT"}' }, []).pass, true, `${scenario.actor} platform code+message`);
    // Generic or empty 401 bodies still fail.
    for (const body of ["", "{}", "Unauthorized", '{"message":""}', '{"code":401}', '{"code":500,"message":"x"}']) {
      const v = assertScenario(scenario, { status: 401, bodyText: body }, []);
      assert.equal(v.pass, false, `${scenario.actor} generic body ${JSON.stringify(body)}`);
      assert.match(v.reasons.join(), /corps d’erreur sans message/);
    }
    // Leak checks still apply to the platform envelope.
    const leak = assertScenario(scenario, { status: 401, bodyText: `{"message":"token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz rejected"}` }, []);
    assert.equal(leak.pass, false);
    assert.match(leak.reasons.join(), /contient un JWT/);
  }
});
test("negative: a platform message never rescues a wrong status, and other refusals keep the function envelope", () => {
  const [anonymous, invalid, third, viewer, , , fake] = scenarioPlan();
  for (const scenario of [anonymous, invalid]) {
    const ok200 = assertScenario(scenario, { status: 200, bodyText: '{"message":"ok"}' }, []);
    assert.equal(ok200.pass, false);
    assert.match(ok200.reasons.join(), /statut 200 au lieu de 401/);
    assert.match(ok200.reasons.join(), /succès inattendu/);
    const forbidden403 = assertScenario(scenario, { status: 403, bodyText: '{"message":"Forbidden"}' }, []);
    assert.equal(forbidden403.pass, false);
    assert.match(forbidden403.reasons.join(), /statut 403 au lieu de 401/);
    assert.match(forbidden403.reasons.join(), /corps d’erreur sans message/);
  }
  // Third party / viewer (403) and fake MIME (415) are not broadened: the platform envelope is not a function body.
  for (const [scenario, status] of [[third, 403], [viewer, 403], [fake, 415]] as const) {
    const v = assertScenario(scenario, { status, bodyText: '{"message":"Forbidden"}' }, []);
    assert.equal(v.pass, false, scenario.name);
    assert.deepEqual(v.reasons, ["corps d’erreur sans message"]);
    assert.equal(assertScenario(scenario, { status, bodyText: '{"error":"Refusé"}' }, []).pass, true, scenario.name);
  }
  for (const [scenario, status] of [[third, 403], [viewer, 403]] as const) {
    const v = assertScenario(scenario, { status, bodyText: '{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}' }, []);
    assert.equal(v.pass, false, `${scenario.name} observed code on 403`);
    assert.deepEqual(v.reasons, ["corps d’erreur sans message"]);
  }
  // A 401 on a scenario that expects 403 is still a wrong status even with a platform envelope.
  const wrong = assertScenario(third, { status: 401, bodyText: '{"code":401,"message":"Invalid JWT"}' }, []);
  assert.equal(wrong.pass, false);
  assert.match(wrong.reasons.join(), /statut 401 au lieu de 403/);
});
