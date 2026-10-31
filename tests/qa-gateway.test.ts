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
  type RunResult,
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
