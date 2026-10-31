// QA-DOCUMENTS-B2B-004 — pure tests of the business acceptance harness: cleanup FK order
// (015/016/017 children), refusal to delete on an unknown outcome, durable intents before Auth,
// the finally cycle with fake clients and injected errors, dry-run and argument exit codes,
// build-id preflight parsing and PDF byte inspection. No network, no Playwright, no Supabase.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Dynamic imports keep the ESM harness modules untyped for tsc (the harness is plain Node ESM).
const lib = (name: string) => import(new URL(`../scripts/qa-business/lib/${name}.mjs`, import.meta.url).href);
const qaLib = (name: string) => import(new URL(`../scripts/qa/lib/${name}.mjs`, import.meta.url).href);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any;
let cleanup: Mod, args: Mod, preflight: Mod, pdf: Mod, orchestrateModule: Mod, fixturesModule: Mod, authModule: Mod, lifecycleModule: Mod, reportModule: Mod, redactModule: Mod, cohortModule: Mod, runModule: Mod;
before(async () => {
  [cleanup, args, preflight, pdf, orchestrateModule, fixturesModule, authModule] = await Promise.all(["cleanup", "args", "preflight", "pdf", "orchestrate", "fixtures", "auth"].map(lib));
  [lifecycleModule, reportModule, redactModule, cohortModule] = await Promise.all(["lifecycle", "report", "redact", "cohort"].map(qaLib));
  runModule = await import(new URL("../scripts/qa-business/run.mjs", import.meta.url).href);
});

const uuid = (n: number, prefix = "a0000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = Record<string, unknown>;

// ---------------------------------------------------------------- cleanup plan
test("cleanup order: 015/016/017 children precede their parents, storage precedes documents, auth last", () => {
  assert.deepEqual(cleanup.orderViolations(cleanup.CLEANUP_STEPS, cleanup.FK_PARENTS), []);
  const tables = cleanup.CLEANUP_STEPS.filter((s: Row) => s.kind === "table").map((s: Row) => s.table as string);
  const idx = (t: string) => tables.indexOf(t);
  const last = (t: string) => tables.lastIndexOf(t);
  assert.ok(idx("quote_document_events") < idx("quote_documents") && idx("quote_documents") < idx("quote_amendments"), "events → documents → amendments");
  assert.ok(last("quote_terms") < idx("quotes") && last("quote_amendments") < idx("quotes"), "015 rows before quotes");
  assert.ok(last("quote_document_events") < idx("interventions"));
  assert.ok(idx("site_sla_pauses") < idx("site_sla_cases") && idx("site_sla_cases") < idx("site_sla_policies") && idx("site_sla_policies") < idx("organization_sla_calendars"));
  assert.ok(idx("site_maintenance_visits") < idx("site_maintenance_plans") && idx("site_maintenance_plans") < idx("site_equipment"));
  assert.ok(idx("site_budget_lines") < idx("organization_fiscal_years"));
  assert.ok(last("site_erp_checklists") < idx("sites") && last("organization_fiscal_years") < idx("organizations"));
  assert.ok(last("notifications") < idx("interventions") && last("notifications") < idx("profiles"));
  assert.ok(last("organization_contract_grids") < idx("contracts"), "grids reference contracts");
  assert.equal(cleanup.CLEANUP_STEPS.at(-1).kind, "auth");
});
test("order violations are detected when a child is moved after its parent", () => {
  const broken = cleanup.CLEANUP_STEPS.filter((s: Row) => s.table !== "quote_terms");
  broken.splice(broken.findIndex((s: Row) => s.table === "interventions") + 1, 0, { kind: "table", table: "quote_terms", column: "quote_id", ids: "quotes" });
  const violations = cleanup.orderViolations(broken, cleanup.FK_PARENTS);
  assert.ok(violations.some((v: string) => /quote_terms must be deleted before quotes/.test(v)), violations.join("; "));
});
test("the plan deletes only manifest ids and refuses a non-UUID id", () => {
  const manifest = cleanup.emptyManifest({ project: "qaproject12345678" });
  manifest.created.sites.push(uuid(1));
  manifest.created.profiles.push("not-a-uuid");
  assert.throws(() => cleanup.planCleanup(manifest), /non-UUID/);
  manifest.created.profiles = [];
  const ops = cleanup.planCleanup(manifest);
  assert.ok(ops.every((op: Row) => op.ids === "sites"), "only site-filtered steps are planned");
  assert.ok(ops.some((op: Row) => op.table === "site_equipment" && (op.values as string[]).includes(uuid(1))));
  assert.equal(manifest.version, 2);
  assert.deepEqual(manifest.intents, []);
});

function fakeDb(behaviour: { failDeleteOn?: string; failCountOn?: string; failKind?: "timeout" | "refusal" } = {}) {
  const calls: string[] = [];
  const rows = new Map<string, number>();
  const err = (label: string) => {
    if (behaviour.failKind === "refusal") return Object.assign(new Error(`${label} refused`), { status: 403 });
    return Object.assign(new Error(`${label}: no answer within 10 ms`), { name: "TimeoutError" });
  };
  return {
    calls,
    rows,
    async delete(table: string) {
      calls.push(`delete:${table}`);
      if (behaviour.failDeleteOn === table) throw err(`DELETE ${table}`);
      rows.set(table, 0);
    },
    async count(table: string) {
      calls.push(`count:${table}`);
      if (behaviour.failCountOn === table) throw err(`COUNT ${table}`);
      return rows.get(table) ?? 0;
    },
    async storageRemove() {
      calls.push("storage:remove");
    },
    async storageList() {
      return [];
    },
    async deleteAuthUser(id: string) {
      calls.push(`auth:delete:${id}`);
    },
    async authUserExists() {
      calls.push("auth:exists");
      return false;
    },
  };
}
const manifestWith = () => {
  const manifest = cleanup.emptyManifest({ project: "qaproject12345678" });
  manifest.created.interventions.push(uuid(1, "b0000000"));
  manifest.created.quotes.push(uuid(2, "b0000000"));
  manifest.created.sites.push(uuid(3, "b0000000"));
  manifest.created.organizations.push(uuid(4, "b0000000"));
  manifest.created.profiles.push(uuid(5, "b0000000"));
  manifest.created.auth_users.push(uuid(5, "b0000000"));
  return manifest;
};
test("a delete with an unknown outcome halts the plan: later steps are skipped, nothing more is deleted, ok=false", async () => {
  const db = fakeDb({ failDeleteOn: "site_equipment" });
  const result = await cleanup.runCleanup(db, manifestWith());
  assert.equal(result.ok, false);
  assert.equal(result.halted, "site_equipment by site_id");
  const unknown = result.steps.find((s: Row) => s.table === "site_equipment");
  assert.equal(unknown.status, "unknown");
  assert.match(unknown.error, /manifest kept/);
  const after = result.steps.slice(result.steps.indexOf(unknown) + 1);
  assert.ok(after.length > 0 && after.every((s: Row) => s.status === "skipped-unknown"), "every later step skipped");
  assert.ok(!db.calls.some((c) => c === "delete:interventions" || c === "delete:profiles" || c.startsWith("auth:delete")), "parents were deleted after an unknown outcome");
});
test("a readback with an unknown outcome also halts; a definite refusal (4xx) records a fail and continues", async () => {
  const halted = await cleanup.runCleanup(fakeDb({ failCountOn: "quote_terms" }), manifestWith());
  assert.equal(halted.ok, false);
  assert.equal(halted.steps.find((s: Row) => s.table === "quote_terms").status, "unknown");
  assert.ok(halted.steps.filter((s: Row) => s.status === "skipped-unknown").length > 0);
  const refused = await cleanup.runCleanup(fakeDb({ failDeleteOn: "quote_terms", failKind: "refusal" }), manifestWith());
  assert.equal(refused.ok, false);
  assert.equal(refused.halted, null);
  assert.equal(refused.steps.find((s: Row) => s.table === "quote_terms").status, "fail");
  assert.ok(refused.steps.some((s: Row) => s.table === "interventions" && s.status === "pass"), "definite refusals do not stop the plan");
  const complete = await cleanup.runCleanup(fakeDb(), manifestWith());
  assert.equal(complete.ok, true);
  assert.equal(complete.steps.at(-1).table, "auth.users");
});
test("intents are resolved only when the Auth account carries exactly the intent email", async () => {
  const manifest = cleanup.emptyManifest({});
  manifest.intents.push({ id: uuid(1, "c0000000"), label: "a", email: "qa-x-a@qa.invalid", status: "pending" }, { id: uuid(2, "c0000000"), label: "b", email: "qa-x-b@qa.invalid", status: "pending" }, { id: uuid(3, "c0000000"), label: "c", email: "qa-x-c@qa.invalid", status: "pending" });
  const auth = {
    async getUser(id: string) {
      if (id === uuid(1, "c0000000")) return { id, email: "qa-x-a@qa.invalid" };
      if (id === uuid(2, "c0000000")) return { id, email: "someone-else@example.invalid" };
      return null;
    },
  };
  const entries = await cleanup.resolveIntents(auth, manifest);
  assert.deepEqual(entries.map((e: Row) => e.status), ["resolved", "mismatch", "absent"]);
  assert.deepEqual(manifest.created.auth_users, [uuid(1, "c0000000")]);
  assert.deepEqual(manifest.created.profiles, [uuid(1, "c0000000")]);
  assert.equal(manifest.intents[1].status, "pending", "a mismatching account is never claimed");
});

// ---------------------------------------------------------------- durable intents before Auth
test("createUser writes the intent (pre-generated id) to the manifest BEFORE calling Auth, then tracks the id", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-"));
  const manifestPath = path.join(dir, "manifest.json");
  const order: string[] = [];
  let intentOnDiskAtAuthCall: Row | null = null;
  const auth = {
    async createUser({ id, email }: { id: string; email: string }) {
      const saved = JSON.parse(await readFile(manifestPath, "utf8"));
      intentOnDiskAtAuthCall = saved.intents.find((i: Row) => i.id === id && i.email === email) ?? null;
      order.push("auth");
      return id;
    },
    async getUser() {
      return null;
    },
  };
  const db = {
    async update(table: string) {
      order.push(`update:${table}`);
      return [{ id: "x" }];
    },
    async upsert(table: string) {
      order.push(`upsert:${table}`);
      return [];
    },
    async insert() {
      return [];
    },
    async select() {
      return [];
    },
    async count() {
      return 0;
    },
    async delete() {},
    async createAuthUser() {
      throw new Error("the base createAuthUser (no id) must not be used");
    },
  };
  const redactor = redactModule.createRedactor();
  const cohort = cohortModule.createCohort("0123456789ab");
  const fixtures = new fixturesModule.BusinessFixtures({ db, auth, cohort, manifestPath, context: { project: "qaproject12345678" }, redactor });
  const user = await fixtures.createUser("artisan", "artisan");
  assert.ok(intentOnDiskAtAuthCall, "intent must be persisted before the Auth call");
  assert.equal((intentOnDiskAtAuthCall as Row).status, "pending");
  assert.equal(user.id, (intentOnDiskAtAuthCall as Row).id);
  assert.deepEqual(order, ["auth", "update:profiles", "upsert:artisan_profiles"]);
  const final = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(final.intents[0].status, "resolved");
  assert.deepEqual(final.created.auth_users, [user.id]);
  assert.deepEqual(final.created.profiles, [user.id]);
  assert.ok(!JSON.stringify(final).includes(user.password), "password never persisted");
  await assert.rejects(() => fixtures.createUser("admin", "admin"), /never creates an administrator/);
});
test("the admin auth client passes the pre-generated id and treats a 404 as absent", async () => {
  const calls: { url: string; body: Row | null }[] = [];
  const fetchImpl = async (url: string, init: { body?: string }) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/auth/v1/admin/users")) return new Response(JSON.stringify({ id: calls[0].body?.id }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const auth = authModule.createAdminAuth({ url: "https://qaproject12345678.supabase.co", serviceKey: "service-key-xxxxxxxxxxxxxxxxxxxx", fetchImpl, timeoutMs: 1000 });
  const id = await auth.createUser({ id: uuid(9, "d0000000"), email: "qa@qa.invalid", password: "p", fullName: "QA", role: "client" });
  assert.equal(id, uuid(9, "d0000000"));
  assert.equal(calls[0].body?.id, uuid(9, "d0000000"));
  assert.equal(calls[0].body?.email_confirm, true);
  assert.equal(await auth.getUser(uuid(9, "d0000000")), null);
});

// ---------------------------------------------------------------- finally cycle with fakes
function harness(options: { cleanupOk?: boolean; cleanupThrows?: boolean } = {}) {
  const redactor = redactModule.createRedactor();
  const report = reportModule.createReport({ run_id: "x" }, redactor);
  let cleanups = 0;
  let written = 0;
  const lifecycle = lifecycleModule.createLifecycle({
    cleanup: async () => {
      cleanups++;
      if (options.cleanupThrows) throw new Error("cleanup crashed");
      return { ok: options.cleanupOk !== false, halted: options.cleanupOk === false ? "site_equipment by site_id" : null, steps: [] };
    },
    writeResults: async () => {
      written++;
    },
    drainTimeoutMs: 100,
  });
  return { report, lifecycle, counts: () => ({ cleanups, written }) };
}
const ok = { name: "ok", description: "passes", needsCredentials: false, async run({ report }: { report: Row }) { await (report.scenario as (a: string, b: string, c: () => Promise<void>) => Promise<void>)("ok", "fine", async () => {}); } };
test("a suite that throws an assertion is recorded as FAIL, cleanup runs exactly once, exit 1", async () => {
  const { report, lifecycle, counts } = harness();
  const failing = { name: "fail", description: "throws", needsCredentials: false, async run() { assert.equal(1, 2, "injected assertion"); } };
  const result = await orchestrateModule.orchestrate({ suites: [failing, ok], ctx: { fixtures: {}, report }, lifecycle, report });
  assert.equal(result.code, 1);
  assert.deepEqual(result.summary, { total: 2, pass: 1, fail: 1, anomaly: 0 });
  assert.deepEqual(counts(), { cleanups: 1, written: 1 });
  assert.equal(report.scenarios[0].name, "suite setup");
  await lifecycle.finalize("again");
  assert.equal(counts().cleanups, 1, "finalisation is idempotent");
});
test("a harness crash (non-assertion) is an ANOMALY, not a FAIL: exit 0 with the cleanup done once", async () => {
  const { report, lifecycle, counts } = harness();
  const crashing = { name: "crash", description: "timeout", needsCredentials: false, async run() { throw Object.assign(new Error("Timeout 90000ms exceeded"), { name: "TimeoutError" }); } };
  const result = await orchestrateModule.orchestrate({ suites: [crashing], ctx: { fixtures: {}, report }, lifecycle, report });
  assert.equal(result.code, 0);
  assert.deepEqual(result.summary, { total: 1, pass: 0, fail: 0, anomaly: 1 });
  assert.equal(counts().cleanups, 1);
});
test("an unknown cleanup outcome yields exit 3 even when every scenario passed; a cleanup crash is contained", async () => {
  const a = harness({ cleanupOk: false });
  const resultA = await orchestrateModule.orchestrate({ suites: [ok], ctx: { fixtures: {}, report: a.report }, lifecycle: a.lifecycle, report: a.report });
  assert.equal(resultA.code, 3);
  assert.equal(resultA.cleanup.halted, "site_equipment by site_id");
  const b = harness({ cleanupThrows: true });
  const resultB = await orchestrateModule.orchestrate({ suites: [ok], ctx: { fixtures: {}, report: b.report }, lifecycle: b.lifecycle, report: b.report });
  assert.equal(resultB.code, 3);
  assert.equal(resultB.cleanup.ok, false);
  assert.match(resultB.cleanup.error, /cleanup crashed/);
});
test("a stopping lifecycle skips the remaining suites; a suite needing credentials without fixtures is a preflight anomaly; the browser stops before finalisation", async () => {
  const { report, lifecycle, counts } = harness();
  const events: string[] = [];
  const first = { name: "first", description: "stops the run", needsCredentials: false, async run() { lifecycle.gate.stop("fatal:test"); } };
  const second = { name: "second", description: "must not run", needsCredentials: false, async run() { events.push("second ran"); } };
  const result = await orchestrateModule.orchestrate({ suites: [first, second], ctx: { fixtures: {}, report }, lifecycle, report, stopBrowser: async () => events.push("browser stopped"), log: (line: string) => events.push(line) });
  assert.ok(!events.includes("second ran"));
  assert.ok(events.some((e) => /second skipped: run stopping/.test(e)));
  assert.equal(events.indexOf("browser stopped") >= 0, true);
  assert.equal(result.code, 0);
  assert.equal(counts().cleanups, 1);
  const c = harness();
  const needs = { name: "needs", description: "needs credentials", needsCredentials: true, async run() { events.push("needs ran"); } };
  const r2 = await orchestrateModule.orchestrate({ suites: [needs], ctx: { fixtures: null }, lifecycle: c.lifecycle, report: c.report });
  assert.ok(!events.includes("needs ran"));
  assert.equal(c.report.scenarios[0].name, "preconditions");
  assert.equal(r2.summary.anomaly, 1);
});

// ---------------------------------------------------------------- arguments and dry-run
test("arguments: suites docs|b2b|all, refusals, cleanup-manifest requirements", () => {
  const base = ["--base-url", "http://localhost:3017", "--sha", "a".repeat(40), "--project", "qaproject12345678"];
  assert.deepEqual(args.parseArgs([...base, "--dry-run"]).options.suites, ["docs", "b2b"]);
  assert.deepEqual(args.parseArgs([...base, "--dry-run", "--suite", "all"]).options.suites, ["docs", "b2b"]);
  assert.deepEqual(args.parseArgs([...base, "--dry-run", "--suite", "b2b"]).options.suites, ["b2b"]);
  assert.ok(args.parseArgs([...base, "--dry-run", "--suite", "captures"]).errors.some((e: string) => /unknown suite captures/.test(e)));
  assert.ok(args.parseArgs([...base, "--dry-run", "--suite", "all", "--suite", "docs"]).errors.some((e: string) => /cannot be combined/.test(e)));
  assert.ok(args.parseArgs([...base, "--dry-run", "--suite", "docs", "--suite", "docs"]).errors.some((e: string) => /duplicate/.test(e)));
  assert.ok(args.parseArgs(base).errors.some((e: string) => /--credentials is required/.test(e)), "a real run needs credentials");
  assert.ok(args.parseArgs(["--base-url", "https://example.com/app", "--sha", "x", "--project", "BAD", "--dry-run"]).errors.length >= 3);
  assert.ok(args.parseArgs(["--cleanup-manifest", "m.json"]).errors.some((e: string) => /requires --credentials/.test(e)));
  assert.deepEqual(args.parseArgs(["--cleanup-manifest", "m.json", "--credentials", "c.json", "--project", "qaproject12345678"]).errors, []);
  assert.ok(args.parseArgs([...base, "--dry-run", "--timeout-ms", "10"]).errors.some((e: string) => /--timeout-ms/.test(e)));
  assert.ok(args.parseArgs([...base, "--dry-run", "--bogus"]).errors.some((e: string) => /unknown argument/.test(e)));
});
test("dry-run plan lists fixtures, the full cleanup order, the unknown-outcome rule and the not-exercised list without touching the network", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("network call during dry-run");
  }) as typeof fetch;
  try {
    const plan = runModule.buildPlan({ run_id: "r", sha: "a".repeat(40), project: "qaproject12345678", base_url: "http://localhost:3017" }, runModule.SUITES, null);
    assert.equal(plan.mode, "dry-run (no network call made)");
    assert.deepEqual(plan.fixtures.map((f: Row) => f.suite), ["docs", "b2b"]);
    assert.ok(plan.cleanup_order[0].startsWith("quote_document_events by"));
    assert.equal(plan.cleanup_order.at(-1), "auth users");
    assert.match(plan.unknown_outcome, /halts the plan/);
    assert.ok(plan.not_exercised.some((l: string) => /état simulé, non produit par le circuit utilisateur/.test(l)));
    assert.deepEqual(plan.exit_codes[3], "cleanup incomplete or unknown outcome");
    assert.match(plan.build_id_check, /not verified/);
    assert.equal(runModule.defaultOutDir("a".repeat(40), "0123456789ab").includes("depannage-qa-business"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------- build id and PDF checks
test("build id: served document parsed, compared with the local build, mismatch is a defect", () => {
  const html = '<html><script src="/_next/static/chunks/main-app.js"></script><script src="/_next/static/AbC123xyz/_buildManifest.js"></script><script src="/_next/static/AbC123xyz/_ssgManifest.js"></script></html>';
  assert.equal(preflight.servedBuildId(html), "AbC123xyz");
  assert.equal(preflight.servedBuildId("<html>no next</html>"), null);
  assert.equal(preflight.servedBuildId('<link href="/_next/static/css/app.css"><script src="/_next/static/chunks/x.js">'), null);
  assert.deepEqual(preflight.compareBuildIds("AbC123xyz", "AbC123xyz"), { verified: true, reason: "" });
  assert.equal(preflight.compareBuildIds("AbC123xyz", "other").mismatch, true);
  assert.equal(preflight.compareBuildIds(null, "AbC123xyz").verified, false);
  assert.equal(preflight.compareBuildIds("AbC123xyz", null).verified, false);
});
test("PDF inspection: real bytes only — header, length, reference and amounts; the overview JSON is never enough", () => {
  const quoteId = "1a2b3c4d-0000-4000-8000-000000000000";
  assert.equal(pdf.quoteReference(quoteId), "DEV-1A2B3C");
  assert.equal(pdf.quoteReference(quoteId, 2), "AV-2-DEV-1A2B3C");
  assert.equal(pdf.euroDigits(12000), "120,00");
  assert.equal(pdf.euroDigits(6005), "60,05");
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj (DEVIS DEV-1A2B3C) Tj (Total TTC 120,00) Tj endobj\n%%EOF", "latin1");
  const good = pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", contentLength: String(bytes.length), expect: ["DEVIS", "DEV-1A2B3C", "120,00"] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.missing, []);
  assert.equal(pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", contentLength: String(bytes.length), expect: ["999,99"] }).ok, false, "a wrong amount fails");
  assert.equal(pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", contentLength: "5", expect: [] }).ok, false, "length mismatch fails");
  assert.equal(pdf.inspectPdf(Buffer.alloc(0), { status: 200, contentType: "application/pdf", expect: [] }).ok, false, "empty body fails");
  assert.equal(pdf.inspectPdf(Buffer.from('{"document":{"reference":"DEV-1A2B3C"}}'), { status: 200, contentType: "application/json", expect: ["DEV-1A2B3C"] }).ok, false, "JSON is not a PDF");
  assert.equal(pdf.inspectPdf(bytes, { status: 404, contentType: "application/pdf", expect: [] }).ok, false);
  assert.equal(pdf.expectedEtag({ snapshot_sha256: "f".repeat(64), revision: 3 }), `"${"f".repeat(32)}-r3"`);
});
test("Postgres month arithmetic helper matches date + interval semantics (day clamped to month end)", async () => {
  const b2b = await import(new URL("../scripts/qa-business/suites/b2b.mjs", import.meta.url).href);
  assert.equal(b2b.addMonthsLikePostgres("2026-01-31", 1), "2026-02-28");
  assert.equal(b2b.addMonthsLikePostgres("2026-08-31", 6), "2027-02-28");
  assert.equal(b2b.addMonthsLikePostgres("2026-10-10", 6), "2027-04-10");
});
