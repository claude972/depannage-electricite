// QA-DOCUMENTS-B2B-004 — pure tests of the business acceptance harness: cleanup FK order
// (015/016/017 children), refusal to delete on an unknown outcome, durable intents before Auth,
// the finally cycle with fake clients and injected errors, dry-run and argument exit codes,
// build-id preflight parsing and PDF byte inspection. No network, no Playwright, no Supabase.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { PdfDocument } from "../lib/features/quote-documents/pdf-writer";
import { renderQuoteDocumentPdf } from "../lib/features/quote-documents/pdf";
import { parseSnapshot } from "../lib/features/quote-documents/snapshot";
import { sampleSnapshot } from "./documents/harness";

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
/** Fake admin Auth: accounts by id; `fail` makes the named read throw (outcome unknown). */
function fakeAuth(accounts: { id: string; email: string }[], fail: { getUser?: boolean; list?: boolean } = {}) {
  return {
    async getUser(id: string) {
      if (fail.getUser) throw Object.assign(new Error("getAuthUser: no answer within 10 ms"), { name: "TimeoutError" });
      return accounts.find((a) => a.id === id) ?? null;
    },
    async findUsersByEmail(email: string) {
      if (fail.list) throw new Error("listAuthUsers: listing not exhausted");
      return accounts.filter((a) => a.email.toLowerCase() === email.toLowerCase());
    },
    async deleteAuthUser() {},
  };
}
const RUN = "0123456789ab";
const cohortEmail = (label: string) => `qa-${RUN}-${label}@qa.invalid`;
const intent = (n: number, label: string) => ({ id: uuid(n, "c0000000"), label, email: cohortEmail(label), status: "pending" });
const cohortManifest = () => cleanup.emptyManifest({ run_id: RUN, project: "qaproject12345678" });
test("intents: resolved by exact email (even if Auth ignored the pre-id), absent only after id 404 AND exhaustive email listing, else mismatch/unknown", async () => {
  const manifest = cohortManifest();
  manifest.intents.push(intent(1, "a"), intent(2, "b"), intent(3, "c"), intent(4, "d"), intent(5, "e"));
  const otherId = uuid(99, "c0000000");
  const auth = fakeAuth([
    { id: uuid(1, "c0000000"), email: cohortEmail("a") },
    { id: uuid(2, "c0000000"), email: "someone-else@example.invalid" },
    { id: otherId, email: cohortEmail("d") }, // Auth assigned another id than requested
    { id: uuid(98, "c0000000"), email: cohortEmail("e") },
    { id: uuid(97, "c0000000"), email: cohortEmail("e").toUpperCase() }, // two accounts: ambiguous
  ]);
  const entries = await cleanup.resolveIntents(auth, manifest);
  assert.deepEqual(entries.map((e: Row) => e.status), ["resolved", "mismatch", "absent", "resolved", "unknown"]);
  assert.deepEqual(manifest.created.auth_users, [uuid(1, "c0000000"), otherId], "the account found by exact email is tracked, never the pre-id guess");
  assert.equal(manifest.intents[1].status, "pending", "a mismatching account is never claimed");
  assert.equal(manifest.intents[3].server_id, otherId);
  const unreachable = cohortManifest();
  unreachable.intents.push(intent(6, "f"));
  const [timedOut] = await cleanup.resolveIntents(fakeAuth([], { getUser: true }), unreachable);
  assert.equal(timedOut.status, "unknown", "a 404 cannot be inferred from a timeout");
  const [partial] = await cleanup.resolveIntents(fakeAuth([], { list: true }), unreachable);
  assert.equal(partial.status, "unknown", "an id 404 without an exhausted email listing is not proof of absence");
});
test("finalizeCleanup: an unknown intent with an empty `created` list is INCOMPLETE (never ok:true, steps:0); manifest saved before deletion", async () => {
  const manifest = cohortManifest();
  manifest.intents.push(intent(7, "timeout"));
  const order: string[] = [];
  const db = fakeDb();
  const result = await cleanup.finalizeCleanup({ db, auth: fakeAuth([], { getUser: true }), manifest, save: async () => order.push("save") });
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 0);
  assert.ok(result.incomplete.some((r: string) => /intent timeout .* unknown/.test(r)));
  assert.deepEqual(order, ["save"]);
  // A resolved id is written to the manifest and saved BEFORE its deletion.
  const resolvedManifest = cohortManifest();
  resolvedManifest.intents.push(intent(8, "late"));
  const seen: string[] = [];
  const trackingDb = { ...fakeDb(), async deleteAuthUser(id: string) { seen.push(`delete:${id}`); }, async authUserExists() { return false; }, async delete(table: string) { seen.push(`delete:${table}`); } };
  const done = await cleanup.finalizeCleanup({
    db: trackingDb,
    auth: fakeAuth([{ id: uuid(8, "c0000000"), email: cohortEmail("late") }]),
    manifest: resolvedManifest,
    save: async (m: Row) => seen.push(`save:${JSON.stringify((m.created as Row).auth_users)}`),
  });
  assert.equal(done.ok, true);
  assert.equal(seen[0], `save:["${uuid(8, "c0000000")}"]`, "manifest saved with the resolved id first");
  assert.ok(seen.includes(`delete:${uuid(8, "c0000000")}`));
  const failingSave = await cleanup.finalizeCleanup({ db: trackingDb, auth: fakeAuth([]), manifest: cohortManifest(), save: async () => { throw new Error("ENOSPC"); } });
  assert.equal(failingSave.ok, false);
  assert.equal(failingSave.halted, "manifest save");
  const collectFails = await cleanup.finalizeCleanup({ db: fakeDb(), auth: fakeAuth([]), manifest: manifestWith(), collect: async () => { throw new Error("select timed out"); } });
  assert.equal(collectFails.ok, false, "an unknown indirect collection forbids a complete verdict");
  assert.ok(collectFails.incomplete.some((r: string) => /indirect collection failed/.test(r)));
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
// Representative fixture SHAPED like Next 16 App Router output (not a captured page): the Flight
// payload is pushed as JSON string chunks; the root row `0:` carries the build id under `b`.
// To be replaced by a public HTML excerpt from root's served page when provided.
function nextFlightHtml(rows: string[], options: { split?: boolean; staticId?: string; decoy?: boolean } = {}) {
  const flight = rows.join("\n") + "\n";
  const chunks = options.split ? [flight.slice(0, 25), flight.slice(25)] : [flight];
  const pushes = chunks.map((c) => `<script>self.__next_f.push(${JSON.stringify([1, c])})</script>`).join("");
  const legacy = options.staticId ? `<script src="/_next/static/${options.staticId}/_buildManifest.js" async></script>` : "";
  const decoy = options.decoy ? '<a href="/?b=QueryIdNotTrusted&buildId=AlsoIgnored">x</a><script>window.x={"b":"LooseSubstring"}</script>' : "";
  return `<!DOCTYPE html><html lang="fr"><head><link rel="stylesheet" href="/_next/static/css/app.css"/><script src="/_next/static/chunks/webpack-1a2b.js" async></script>${legacy}</head><body>${decoy}<script>(self.__next_f=self.__next_f||[]).push([0])</script>${pushes}</body></html>`;
}
const root = (id: string) => `0:${JSON.stringify({ P: null, b: id, p: "", c: ["", ""], i: false, f: [[["", { children: ["__PAGE__", {}] }, "$undefined", "$undefined", true]]], m: "$undefined", G: ["$2", []], s: false, S: true })}`;
const otherRows = ['1:"$Sreact.fragment"', '2:I[61234,["/_next/static/chunks/app/layout-9f.js"],"default"]', `3:${JSON.stringify({ b: "NotTheRootRow123" })}`];
test("build id from the Next 16 Flight root row: match verified, mismatch FAIL, split chunks, decoys ignored", () => {
  const id = "Aw8cMtqXjVJ3P-OZovGFa";
  const html = nextFlightHtml([...otherRows.slice(0, 2), root(id), otherRows[2]], { decoy: true });
  assert.deepEqual(preflight.servedBuildIdentity(html), { id, source: "flight", candidates: [id], ambiguous: false });
  assert.deepEqual(preflight.compareBuildIds(id, preflight.servedBuildId(html)), { verified: true, reason: "" });
  const mismatch = preflight.compareBuildIds("LocalBuild0000", preflight.servedBuildId(html));
  assert.equal(mismatch.mismatch, true, "mismatch with the local .next/BUILD_ID is a FAIL");
  assert.equal(preflight.servedBuildIdentity(nextFlightHtml([root(id), ...otherRows], { split: true })).id, id, "a row split across pushes is reassembled");
  assert.equal(preflight.servedBuildIdentity(nextFlightHtml([root("bad id with spaces")])).id, null, "value outside the build-id charset ignored");
});
test("build id: two different ids are ambiguous, none is unverified, the static manifest path is the fallback", () => {
  const two = nextFlightHtml([root("BuildIdOne111")], { staticId: "BuildIdTwo222" });
  const amb = preflight.servedBuildIdentity(two);
  assert.equal(amb.ambiguous, true);
  assert.equal(amb.id, null);
  const verdict = preflight.compareBuildIds("BuildIdOne111", amb.id, amb);
  assert.equal(verdict.verified, false);
  assert.equal(verdict.ambiguous, true);
  const none = preflight.servedBuildIdentity(nextFlightHtml(otherRows, { decoy: true }));
  assert.deepEqual(none, { id: null, source: "none", candidates: [], ambiguous: false }, "query params and loose substrings never count");
  assert.equal(preflight.compareBuildIds("X1234", none.id, none).verified, false);
  const legacy = '<script src="/_next/static/chunks/main-app.js"></script><script src="/_next/static/AbC123xyz/_buildManifest.js"></script><script src="/_next/static/AbC123xyz/_ssgManifest.js"></script>';
  assert.deepEqual(preflight.servedBuildIdentity(legacy), { id: "AbC123xyz", source: "static", candidates: ["AbC123xyz"], ambiguous: false });
  assert.equal(preflight.servedBuildId('<link href="/_next/static/css/app.css"><script src="/_next/static/chunks/x.js">'), null);
  const malformed = '<script>self.__next_f.push([1,"0:{\\"b\\":\\"Abcd1234\\""])</script>';
  assert.equal(preflight.servedBuildIdentity(malformed).id, null, "a truncated root row is not trusted");
  assert.equal(preflight.compareBuildIds(null, "AbC123xyz").verified, false);
});
test("PDF inspection on bytes from the CANONICAL writer: decoded text literals (octal ° and accents), EOF required", () => {
  const quoteId = "1a2b3c4d-0000-4000-8000-000000000000";
  assert.equal(pdf.quoteReference(quoteId), "DEV-1A2B3C");
  assert.equal(pdf.quoteReference(quoteId, 2), "AV-2-DEV-1A2B3C");
  assert.equal(pdf.euroDigits(12000), "120,00");
  const doc = new PdfDocument();
  const page = doc.addPage();
  page.text(40, 800, "AVENANT N° 1 AU DEVIS DEV-1A2B3C", { font: "bold" });
  page.text(40, 780, "Validité non renseignée par l’émetteur (état « QA »)");
  page.text(40, 760, "Total TTC 60,00 € (parenthèses \\ échappées)");
  const bytes = Buffer.from(doc.build({ title: "Avenant — QA" }));
  assert.ok(!bytes.toString("latin1").includes("N° 1"), "the writer octal-escapes °: raw-byte search would miss it");
  const verdict = pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", contentLength: String(bytes.length), expect: ["AVENANT N° 1 AU DEVIS DEV-1A2B3C", "Validité non renseignée par l’émetteur", "60,00 €", "(parenthèses \\ échappées)"] });
  assert.deepEqual(verdict.missing, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.has_eof, true);
  assert.equal(pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", expect: ["999,99"] }).ok, false, "a wrong amount fails");
  const truncated = bytes.subarray(0, bytes.length - 8);
  const cut = pdf.inspectPdf(truncated, { status: 200, contentType: "application/pdf", expect: [] });
  assert.equal(cut.has_eof, false);
  assert.equal(cut.ok, false, "a truncated PDF without %%EOF is refused");
  assert.equal(pdf.inspectPdf(bytes, { status: 200, contentType: "application/pdf", contentLength: "5", expect: [] }).ok, false, "length mismatch fails");
  assert.equal(pdf.inspectPdf(Buffer.alloc(0), { status: 200, contentType: "application/pdf", expect: [] }).ok, false, "empty body fails");
  assert.equal(pdf.inspectPdf(Buffer.from('{"document":{"reference":"DEV-1A2B3C"}}'), { status: 200, contentType: "application/json", expect: ["DEV-1A2B3C"] }).ok, false, "JSON is not a PDF");
  assert.equal(pdf.inspectPdf(bytes, { status: 404, contentType: "application/pdf", expect: [] }).ok, false);
  assert.equal(pdf.expectedEtag({ snapshot_sha256: "f".repeat(64), revision: 3 }), `"${"f".repeat(32)}-r3"`);
});
test("PDF inspection on a full amendment rendered by the application's renderer (renderQuoteDocumentPdf)", () => {
  const snapshot = parseSnapshot(sampleSnapshot({ kind: "amendment", lineCount: 3 }));
  const bytes = Buffer.from(renderQuoteDocumentPdf(snapshot, { revision: 1, generated_at: "2026-10-31T14:05:00Z", snapshot_sha256: "ab".repeat(32) }));
  const verdict = pdf.inspectPdf(bytes, {
    status: 200,
    contentType: "application/pdf",
    contentLength: String(bytes.length),
    expect: ["AVENANT N° 3 AU DEVIS DEV-100000", "Validité non renseignée par l’émetteur", "Total TTC des avenants acceptés antérieurs : 50,00 €."],
  });
  assert.deepEqual(verdict.missing, []);
  assert.equal(verdict.ok, true);
});
test("Postgres month arithmetic helper matches date + interval semantics (day clamped to month end)", async () => {
  const b2b = await import(new URL("../scripts/qa-business/suites/b2b.mjs", import.meta.url).href);
  assert.equal(b2b.addMonthsLikePostgres("2026-01-31", 1), "2026-02-28");
  assert.equal(b2b.addMonthsLikePostgres("2026-08-31", 6), "2027-02-28");
  assert.equal(b2b.addMonthsLikePostgres("2026-10-10", 6), "2027-04-10");
});

// ---------------------------------------------------------------- real finalizer path (makeRunCleanup / runCleanupOnly)
async function realRun(options: { auth: Row; collectFails?: boolean; created?: (m: Row) => void }) {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-final-"));
  const manifestPath = path.join(dir, "manifest.json");
  const redactor = redactModule.createRedactor();
  const cohort = cohortModule.createCohort("0123456789ab");
  const noop = async () => [];
  const db = { ...fakeDb(), select: noop, insert: noop, upsert: noop, update: noop };
  const fixtures = new fixturesModule.BusinessFixtures({ db, auth: options.auth, cohort, manifestPath, context: { project: "qaproject12345678" }, redactor });
  fixtures.manifest.intents.push(intent(20, "auth-timeout"));
  options.created?.(fixtures.manifest);
  if (options.collectFails) fixtures.collectIndirect = async () => { throw new Error("collect: no answer within 10 ms"); };
  await fixtures.save();
  const events: string[] = [];
  const report = reportModule.createReport({ run_id: "x" }, redactor);
  const lifecycle = lifecycleModule.createLifecycle({
    cleanup: runModule.makeRunCleanup({ fixtures, db, auth: options.auth, outDir: dir, redactor, log: (l: string) => events.push(l), stopBrowser: async () => { events.push("browser stopped"); } }),
    writeResults: async () => { events.push("results written"); },
    drainTimeoutMs: 100,
  });
  const passing = { name: "ok", description: "passes", needsCredentials: false, async run({ report: r }: { report: Row }) { await (r.scenario as (a: string, b: string, c: () => Promise<void>) => Promise<void>)("ok", "fine", async () => {}); } };
  const result = await orchestrateModule.orchestrate({ suites: [passing], ctx: { fixtures, report }, lifecycle, report });
  return { result, dir, manifestPath, events };
}
test("real finalizer: an Auth intent of unknown fate makes the run exit 3 with the manifest kept on disk, even with every scenario PASS", async () => {
  const { result, manifestPath, dir, events } = await realRun({ auth: fakeAuth([], { getUser: true }) });
  assert.deepEqual(result.summary, { total: 1, pass: 1, fail: 0, anomaly: 0 });
  assert.equal(result.code, 3);
  assert.equal(result.cleanup.ok, false);
  const kept = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(kept.intents[0].status, "pending", "the unresolved intent stays actionable in the manifest");
  const written = JSON.parse(await readFile(path.join(dir, "cleanup.json"), "utf8"));
  assert.equal(written.ok, false);
  assert.ok(events.some((e) => /^INCOMPLETE: intent auth-timeout/.test(e)));
  assert.ok(events.indexOf("browser stopped") < events.indexOf("results written"), "browser stopped before results/cleanup");
});
test("real finalizer: a failed indirect collection is INCOMPLETE (exit 3); a fully resolved run is complete (exit 0)", async () => {
  const collect = await realRun({ auth: fakeAuth([]), collectFails: true });
  assert.equal(collect.result.code, 3);
  assert.ok(collect.result.cleanup.incomplete.some((r: string) => /indirect collection failed/.test(r)));
  const clean = await realRun({ auth: fakeAuth([]) });
  assert.equal(clean.result.code, 0, "id 404 + exhausted email listing = absent: complete");
  assert.equal(clean.result.cleanup.ok, true);
});
test("--cleanup-manifest path: unknown intent → 3 and manifest rewritten with resolved ids before deletion; complete → 0; wrong project refused", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-only-"));
  const manifestPath = path.join(dir, "manifest.json");
  const redactor = redactModule.createRedactor();
  const write = async (intents: Row[]) => {
    const m = cohortManifest();
    m.intents.push(...intents);
    await writeFile(manifestPath, JSON.stringify(m));
  };
  await write([intent(30, "unknown")]);
  assert.equal(await runModule.runCleanupOnly({ manifestPath, project: "qaproject12345678", db: fakeDb(), auth: fakeAuth([], { list: true }), redactor }), 3);
  await write([intent(31, "found")]);
  const deleted: string[] = [];
  const db = { ...fakeDb(), async deleteAuthUser(id: string) { const saved = JSON.parse(await readFile(manifestPath, "utf8")); deleted.push(saved.created.auth_users.includes(id) ? "saved-first" : "not-saved"); }, async authUserExists() { return false; } };
  assert.equal(await runModule.runCleanupOnly({ manifestPath, project: "qaproject12345678", db, auth: fakeAuth([{ id: uuid(31, "c0000000"), email: cohortEmail("found") }]), redactor }), 0);
  assert.deepEqual(deleted, ["saved-first"]);
  await assert.rejects(() => runModule.runCleanupOnly({ manifestPath, project: "otherproject123456", db: fakeDb(), auth: fakeAuth([]), redactor }), /created for project/);
});
test("build identity is explicit: attributable only when SHA and served BUILD_ID are both verified", () => {
  assert.equal(runModule.buildIdentity({ sha: "a", sha_verified: true, build_id: "B", build_id_served: "B", build_id_verified: true }).attributable, true);
  for (const ctx of [{ sha_verified: true, build_id: null, build_id_verified: false }, { sha_verified: false, build_id: "B", build_id_verified: true }, { sha_verified: true, build_id: "B", build_id_served: null, build_id_verified: false }]) {
    const id = runModule.buildIdentity(ctx);
    assert.equal(id.attributable, false);
    assert.match(id.note, /NOT VERIFIED/);
  }
  const md = runModule.renderIdentityAndCleanup({ context: { sha_verified: true, build_id_verified: false }, cleanup: { incomplete: ["intent x unknown"] } });
  assert.match(md, /attributable to --sha: NO/);
  assert.match(md, /Cleanup incomplete — manifest kept/);
});
test("admin auth email discovery: exact email only, pages until exhausted, unexhausted listing throws (unknown)", async () => {
  const pages: Record<number, { id: string; email: string }[]> = {
    1: [{ id: uuid(1, "e0000000"), email: "qa-x-a@qa.invalid" }, { id: uuid(2, "e0000000"), email: "qa-x-ab@qa.invalid" }],
    2: [{ id: uuid(3, "e0000000"), email: "QA-X-A@qa.invalid" }],
  };
  const fetchImpl = async (url: string) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify({ users: pages[page] ?? [] }), { status: 200 });
  };
  const auth = authModule.createAdminAuth({ url: "https://qaproject12345678.supabase.co", serviceKey: "service-key-xxxxxxxxxxxxxxxxxxxx", fetchImpl, timeoutMs: 1000 });
  const found = await auth.findUsersByEmail("qa-x-a@qa.invalid", { perPage: 2 });
  assert.deepEqual(found.map((u: Row) => u.id), [uuid(1, "e0000000"), uuid(3, "e0000000")], "prefix-similar email excluded, case-insensitive exact match kept");
  const full = async () => new Response(JSON.stringify({ users: [{ id: "x", email: "z@qa.invalid" }, { id: "y", email: "w@qa.invalid" }] }), { status: 200 });
  const endless = authModule.createAdminAuth({ url: "https://qaproject12345678.supabase.co", serviceKey: "service-key-xxxxxxxxxxxxxxxxxxxx", fetchImpl: full, timeoutMs: 1000 });
  await assert.rejects(() => endless.findUsersByEmail("qa-x-a@qa.invalid", { perPage: 2, maxPages: 3 }), /not exhausted/);
});

// ---------------------------------------------------------------- cohort validation: zero deletion on any non-cohort intent/account
function recordingDb() {
  const calls: string[] = [];
  const db = { ...fakeDb(), async delete(table: string) { calls.push(`delete:${table}`); }, async deleteAuthUser(id: string) { calls.push(`auth:${id}`); }, async storageRemove() { calls.push("storage"); } };
  return { db, calls };
}
const REAL = uuid(500, "f0000000");
test("cohort email is recomputed from the manifest run id and label; anything else is rejected before any lookup", () => {
  const m = cohortManifest();
  assert.equal(cleanup.expectedIntentEmail(m, intent(1, "owner")), cohortEmail("owner"));
  assert.equal(cleanup.expectedIntentEmail(m, { ...intent(1, "owner"), email: "real-user@example.com" }), null);
  assert.equal(cleanup.expectedIntentEmail(m, { ...intent(1, "owner"), label: "tiers" }), null, "label must match the email");
  assert.equal(cleanup.expectedIntentEmail({ ...m, run_id: "fedcba987654" }, intent(1, "owner")), null, "other run id");
  assert.equal(cleanup.expectedIntentEmail({ ...m, run_id: "not-a-run" }, intent(1, "owner")), null, "malformed run id");
  assert.equal(cleanup.expectedIntentEmail(m, { ...intent(1, "owner"), id: "x" }), null, "malformed UUID");
  assert.equal(cleanup.expectedIntentEmail(m, { ...intent(1, "Manager Site A"), email: cohortEmail("manager-site-a") }), cohortEmail("manager-site-a"), "same slug as creation");
});
const tampered: [string, (m: Row) => void, Row][] = [
  ["edited intent email (real-looking address)", (m) => (m.intents as Row[]).push({ ...intent(40, "owner"), email: "real-user@example.com" }), fakeAuth([{ id: REAL, email: "real-user@example.com" }])],
  ["corrupted manifest run id", (m) => { m.run_id = "../../etc"; (m.intents as Row[]).push(intent(41, "owner")); }, fakeAuth([{ id: REAL, email: cohortEmail("owner") }])],
  ["intent label edited", (m) => (m.intents as Row[]).push({ ...intent(42, "owner"), label: "admin" }), fakeAuth([{ id: REAL, email: cohortEmail("owner") }])],
  ["divergent UID: pre-id resolves to another email", (m) => (m.intents as Row[]).push(intent(43, "owner")), fakeAuth([{ id: uuid(43, "c0000000"), email: "real-user@example.com" }, { id: REAL, email: cohortEmail("owner") }])],
  ["listing returns a non-cohort account", (m) => (m.intents as Row[]).push(intent(44, "owner")), { async getUser() { return null; }, async findUsersByEmail() { return [{ id: REAL, email: "real-user@example.com" }]; } }],
  ["listing returns a non-UUID id", (m) => (m.intents as Row[]).push(intent(45, "owner")), { async getUser() { return null; }, async findUsersByEmail() { return [{ id: "1", email: cohortEmail("owner") }]; } }],
];
for (const [name, mutate, auth] of tampered)
  test(`zero deletion, no adoption, incomplete: ${name}`, async () => {
    const m = cohortManifest();
    m.created.sites.push(uuid(1, "b0000000"));
    m.created.profiles.push(uuid(2, "b0000000"));
    m.created.auth_users.push(uuid(2, "b0000000"));
    mutate(m);
    const { db, calls } = recordingDb();
    const result = await cleanup.finalizeCleanup({ db, auth, manifest: m });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, [], "nothing at all was deleted");
    assert.ok(!m.created.auth_users.includes(REAL) && !m.created.profiles.includes(REAL), "the foreign account was never adopted");
    assert.ok(["rejected", "mismatch"].includes(result.intents[0].status), result.intents[0].status);
    assert.equal(result.halted, "untrusted manifest");
  });
test("--cleanup-manifest with an edited intent email: exit 3, manifest kept, zero deletion", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-tamper-"));
  const manifestPath = path.join(dir, "manifest.json");
  const m = cohortManifest();
  m.intents.push({ ...intent(50, "owner"), email: "real-user@example.com" });
  m.created.sites.push(uuid(1, "b0000000"));
  await writeFile(manifestPath, JSON.stringify(m));
  const { db, calls } = recordingDb();
  const code = await runModule.runCleanupOnly({ manifestPath, project: "qaproject12345678", db, auth: fakeAuth([{ id: REAL, email: "real-user@example.com" }]), redactor: redactModule.createRedactor() });
  assert.equal(code, 3);
  assert.deepEqual(calls, []);
  const kept = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(!kept.created.auth_users.includes(REAL));
  assert.equal(kept.intents[0].email, "real-user@example.com", "manifest kept as found for manual review");
});

// ---------------------------------------------------------------- stop race and diagnostics (root run of 947e299)
test("stop during a scenario: the running scenario ends at its next step, no mutating call after stop, no later scenario starts, drain waits before cleanup", async () => {
  const events: string[] = [];
  const gate = lifecycleModule.createStopGate();
  const redactor = redactModule.createRedactor();
  const report = reportModule.createReport({ run_id: "x" }, redactor);
  const guarded = orchestrateModule.guardReport(report, gate, { log: (l: string) => events.push(l) });
  let mutations = 0;
  const post = async () => {
    gate.check();
    mutations++;
  };
  let release: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => (release = resolve));
  const lifecycle = lifecycleModule.createLifecycle({ gate, cleanup: async () => { events.push("cleanup"); return { ok: true, steps: [] }; }, writeResults: async () => {}, drainTimeoutMs: 5000 });
  const suiteA = {
    name: "docs",
    description: "first",
    needsCredentials: false,
    async run({ report: r }: { report: Row }) {
      const scenario = r.scenario as (a: string, b: string, c: (s: Row) => Promise<void>) => Promise<unknown>;
      await scenario("docs", "scenario 1", async (s) => {
        const step = s.step as (l: string, t: () => Promise<unknown>) => Promise<unknown>;
        await step("slow read in flight when the signal arrives", async () => {
          await inFlight;
          events.push("step 1 settled");
        });
        await step("mutating step after the signal", async () => post());
      });
      await scenario("docs", "scenario 2 (third party)", async () => {
        events.push("scenario 2 ran");
        await post();
      });
    },
  };
  const suiteB = { name: "b2b", description: "second", needsCredentials: false, async run() { events.push("suite b2b ran"); } };
  const running = orchestrateModule.orchestrate({ suites: [suiteA, suiteB], ctx: { fixtures: {}, report: guarded }, lifecycle, report: guarded, log: (l: string) => events.push(l) });
  await new Promise((r) => setTimeout(r, 10));
  // Simulated SIGINT: the signal handler raises the gate then finalises (drain → cleanup).
  gate.stop("signal:SIGINT");
  const finalizing = lifecycle.finalize("signal:SIGINT");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!events.includes("cleanup"), "cleanup must wait for the running scenario");
  release();
  await finalizing;
  const result = await running;
  assert.equal(mutations, 0, "no mutating call after the stop");
  assert.ok(!events.includes("scenario 2 ran") && !events.includes("suite b2b ran"));
  assert.ok(events.indexOf("step 1 settled") < events.indexOf("cleanup"), "drain waited for the in-flight step");
  assert.equal(events.filter((e) => e === "cleanup").length, 1, "single finalisation");
  assert.deepEqual(report.scenarios.map((x: Row) => [x.name, x.status]), [["scenario 1", "ANOMALY"]], "only the interrupted scenario is recorded, as an anomaly (stop), never PASS");
  assert.equal((report.scenarios[0].error as Row).name, "StopRequestedError");
  assert.deepEqual(guarded.skipped.map((x: Row) => x.name), ["scenario 2 (third party)"]);
  assert.equal(result.code, 0);
});
test("diagnostics on the first failing step: private screenshot + main-region text (redacted) + network summary; the FAIL stays FAIL", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-diag-"));
  const { writeFile: wf, chmod, stat } = await import("node:fs/promises");
  const redactor = redactModule.createRedactor();
  const report = reportModule.createReport({ run_id: "x" }, redactor);
  const gate = lifecycleModule.createStopGate();
  const diagnose = orchestrateModule.createDiagnose({ out: dir, redactor, writeFile: wf, chmod, join: path.join });
  const guarded = orchestrateModule.guardReport(report, gate, { diagnose });
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJlLXFh";
  const fakePage = {
    url: () => "http://localhost:3017/?token=secret#quote/abc",
    locator: (sel: string) => ({ count: async () => (sel === "main" ? 1 : 0), first: () => ({ innerText: async () => `Devis introuvable ${jwt}` }), innerText: async () => "body" }),
    screenshot: async ({ path: file }: { path: string }) => { await wf(file, "png"); },
  };
  const handle = { page: fakePage, network: [{ method: "GET", path: "/api/quote-documents", status: 403, headers: { authorization: "x" } }], pageErrors: [] };
  let calls = 0;
  await guarded.scenario("docs", "client reads the quote", async (s: Row) => {
    (s.track as (h: unknown) => unknown)(handle);
    const step = s.step as (l: string, t: () => Promise<unknown>) => Promise<unknown>;
    try {
      await step("documents panel visible", async () => assert.fail("expected visible: documents panel"));
    } catch (e) {
      await step("second failure", async () => { calls++; throw new Error("x"); }).catch(() => {});
      throw e;
    }
  });
  const entry = report.scenarios[0];
  assert.equal(entry.status, "FAIL", "diagnostics never change the verdict");
  const json = path.join(dir, "diag-docs-client-reads-the-quote-1.json");
  const png = path.join(dir, "diag-docs-client-reads-the-quote-1.png");
  assert.equal((await stat(json)).mode & 0o777, 0o600);
  assert.equal((await stat(png)).mode & 0o777, 0o600);
  const record = JSON.parse(await readFile(json, "utf8"));
  assert.equal(record.failed_step, "documents panel visible");
  assert.equal(record.location, "/#quote/abc", "no query string recorded");
  assert.ok(record.main_text.startsWith("Devis introuvable") && !record.main_text.includes(jwt), "text captured and redacted");
  assert.deepEqual(record.network, [{ method: "GET", path: "/api/quote-documents", status: 403 }], "method/path/status only");
  assert.deepEqual(entry.evidence.map((e: Row) => e.kind), ["diagnostic", "diagnostic"], "diagnostics captured once (first failure)");
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------- root review of c97a018: drain timeout and await-then-emit gaps
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
test("P2-1 repro cleanupWhilePending=1 → drain timeout with a pending producer: zero delete calls, manifest bytes intact, exit 3, recovery command printed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-business-pending-"));
  const manifestPath = path.join(dir, "manifest.json");
  const redactor = redactModule.createRedactor();
  const cohort = cohortModule.createCohort(RUN);
  const gate = lifecycleModule.createStopGate();
  const { db, calls } = recordingDb();
  const auth = { ...fakeAuth([]), async getUser() { calls.push("auth:get"); return null; }, async findUsersByEmail() { calls.push("auth:list"); return []; } };
  const fixtures = new fixturesModule.BusinessFixtures({ db, auth, cohort, manifestPath, context: { project: "qaproject12345678" }, redactor, gate });
  fixtures.manifest.intents.push(intent(60, "owner"));
  fixtures.manifest.created.sites.push(uuid(1, "b0000000"));
  await fixtures.save();
  const before = await readFile(manifestPath);
  const never = deferred();
  gate.register(never.promise); // a producer (scenario / creation) that does not settle
  const log: string[] = [];
  const lifecycle = lifecycleModule.createLifecycle({
    gate,
    drainTimeoutMs: 30,
    cleanup: runModule.makeRunCleanup({ gate, project: "qaproject12345678", fixtures, db, auth, outDir: dir, redactor, log: (l: string) => log.push(l), stopBrowser: async () => { log.push("browser stopped"); } }),
    writeResults: async () => {},
  });
  const { cleanup: result, drain } = await lifecycle.finalize("signal:SIGINT");
  assert.equal(drain.timedOut, true);
  assert.equal(drain.pending, 1);
  assert.deepEqual(calls, [], "no delete and not even an Auth read while a producer is pending");
  assert.equal(result.ok, false);
  assert.equal(result.halted, "producers not drained");
  assert.ok((await readFile(manifestPath)).equals(before), "manifest file byte-identical");
  assert.equal(reportModule.exitCode({ fail: 0 }, result.ok), 3);
  assert.ok(log.some((l) => l.includes("--cleanup-manifest " + manifestPath)), "recovery command printed");
  assert.ok(!log.includes("browser stopped"));
  never.resolve();
  // Recovery in a later process: nothing pending → the manifest is cleaned normally.
  const recovery = recordingDb();
  const code = await runModule.runCleanupOnly({ manifestPath, project: "qaproject12345678", db: recovery.db, auth: fakeAuth([]), redactor });
  assert.equal(code, 0);
  assert.ok(recovery.calls.includes("delete:sites"));
});
test("P2-2 SIGINT during `await sessionAccessToken` → the direct RPC is never emitted", async () => {
  const gate = lifecycleModule.createStopGate();
  const guard = orchestrateModule.createMutationGuard(gate);
  const order: string[] = [];
  const token = deferred<string>();
  let emitted = 0;
  const probe = (async () => {
    const t = await token.promise; // same shape as b2b.mjs: token read, then ctx.mutation(() => userRpc(...))
    order.push("token read");
    return guard.mutation(async () => {
      emitted++;
      order.push(`rpc emitted with ${t}`);
      return { status: 403 };
    });
  })();
  gate.stop("signal:SIGINT");
  order.push("stop");
  token.resolve("jwt");
  await assert.rejects(probe, (e: Error) => e.name === "StopRequestedError");
  assert.equal(emitted, 0);
  assert.deepEqual(order, ["stop", "token read"]);
});
test("P2-2 RPC in flight at SIGINT → the drain waits for it and cleanup runs strictly after its settlement", async () => {
  const gate = lifecycleModule.createStopGate();
  const guard = orchestrateModule.createMutationGuard(gate);
  const order: string[] = [];
  const answer = deferred<{ status: number }>();
  const rpc = guard.mutation(async () => {
    order.push("rpc emitted");
    const r = await answer.promise;
    order.push("rpc settled");
    return r;
  });
  const clickAnswer = deferred<string>();
  const locator = { async click() { order.push("click emitted"); } };
  const click = guard.mutatingClick(locator, clickAnswer.promise.then((v) => (order.push("POST answered"), v)));
  const lifecycle = lifecycleModule.createLifecycle({ gate, drainTimeoutMs: 5000, cleanup: async () => { order.push(`cleanup (pending ${gate.pending})`); return { ok: true, steps: [] }; }, writeResults: async () => {} });
  gate.stop("signal:SIGINT");
  const finalizing = lifecycle.finalize("signal:SIGINT");
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!order.some((o) => o.startsWith("cleanup")), "cleanup must not start while the RPC and the click are in flight");
  answer.resolve({ status: 403 });
  clickAnswer.resolve("201");
  await Promise.all([rpc, click, finalizing]);
  assert.deepEqual(order, ["rpc emitted", "click emitted", "rpc settled", "POST answered", "cleanup (pending 0)"]);
  assert.throws(() => guard.mutation(async () => order.push("late")), (e: Error) => e.name === "StopRequestedError");
  assert.throws(() => guard.mutatingClick(locator, Promise.resolve("x")), (e: Error) => e.name === "StopRequestedError");
  assert.ok(!order.includes("late"));
});
