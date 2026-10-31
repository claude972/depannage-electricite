// @ts-nocheck — the harness under test is untyped ESM JavaScript (scripts/qa-tracking/*.mjs, same convention as
// scripts/qa); this file is executed by tsx, and the typed backend adapter is covered by qa-tracking-provider.test.ts.
// WEB-TRACKING-QA-006 harness — offline unit tests (no cloud, no credentials, no browser).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs, selectedProviderScenarios } from "../scripts/qa-tracking/lib/args.mjs";
import { IntentLog, intentsVerdict, defaultDefinitive } from "../scripts/qa-tracking/lib/intents.mjs";
import { redactPosition, redactPositionString, withPositionRedaction, snapshotEvidence, POSITION } from "../scripts/qa-tracking/lib/position-redact.mjs";
import { parseTrackingUrl, summarizeTrackingRequest, restartViolations, queryViolations, actions } from "../scripts/qa-tracking/lib/requests.mjs";
import { classifyRoute, classifyGeocode } from "../scripts/qa-tracking/lib/provider-proof.mjs";
import { checkAnonymous, checkBuildId, checkTrackingTable, assertUnknownIs404 } from "../scripts/qa-tracking/lib/preflight.mjs";
import { canonicalEmailPattern, assertCanonicalEmail, proveOwnership } from "../scripts/qa-tracking/lib/ownership.mjs";
import { cleanupOrder, runTrackingCleanup, NEVER_TOUCHED, TRACKING_PRE_STEPS } from "../scripts/qa-tracking/lib/cleanup.mjs";
import { createTrackingApi, act, gatedWait, classifyMutation } from "../scripts/qa-tracking/lib/guard.mjs";
import { proveTracking, proveAction, describeMutation } from "../scripts/qa-tracking/lib/reconcile.mjs";
import { createGuardedCleanup, exitCodeFor } from "../scripts/qa-tracking/lib/finalize.mjs";
import { POSITION_SOURCE, SCENARIOS, PROVIDER_SCENARIOS, UI, PUBLIC_POINTS } from "../scripts/qa-tracking/lib/constants.mjs";
import { cleanupWithProof, runOne } from "../scripts/qa-tracking/run.mjs";
import { createStopGate, StopRequestedError } from "../scripts/qa/lib/lifecycle.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { createReport } from "../scripts/qa/lib/report.mjs";
import { PreflightError } from "../scripts/qa/lib/config.mjs";

const RUN = "0123456789ab";
const SHA = "a".repeat(40);
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-tracking-"));
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("args: required flags, full SHA, scenario filter, opt-in provider proof, dry-run reads no credentials", () => {
  const base = ["--base-url", "http://localhost:3000", "--sha", SHA, "--project", "abcdefghijklmnopqrst"];
  assert.deepEqual(parseArgs([...base, "--dry-run"]).errors, []);
  assert.ok(parseArgs(base).errors.some((e) => e.includes("--credentials")));
  assert.ok(parseArgs(["--base-url", "http://localhost:3000/x", "--sha", "abc", "--project", "p", "--dry-run"]).errors.length >= 2);
  const only = parseArgs([...base, "--dry-run", "--only", "T8,T1"]).options;
  assert.deepEqual(only.scenarios, ["T1", "T8"]);
  assert.ok(parseArgs([...base, "--dry-run", "--only", "T12"]).errors.some((e) => e.includes("unknown scenario")), "T12 only exists as T12-sim");
  assert.deepEqual(selectedProviderScenarios(parseArgs([...base, "--dry-run"]).options), []);
  assert.deepEqual(selectedProviderScenarios(parseArgs([...base, "--dry-run", "--provider-proof"]).options), [...PROVIDER_SCENARIOS]);
  assert.ok(parseArgs(["--cleanup-manifest", "m.json"]).errors.length === 2);
  assert.ok(parseArgs([...base, "--dry-run", "--build-id", "bad id!"]).errors.some((e) => e.includes("--build-id")));
});

test("intents: announced before, settled after; definitive refusals settle; unknown outcomes stay open (0600)", async () => {
  const dir = tmp();
  const log = new IntentLog(path.join(dir, "intents.json"));
  assert.equal(statSync(log.file).mode & 0o777, 0o600);
  const id = log.begin("createAuthUser", "auth.users", "qa-0123456789ab-client@qa.invalid");
  assert.equal(JSON.parse(readFileSync(log.file, "utf8")).intents[0].state, "open", "written before the outcome");
  log.settle(id, "done");
  await assert.rejects(log.wrap("insert", "sites", "S1", async () => { throw Object.assign(new Error("409"), { status: 409 }); }));
  await assert.rejects(log.wrap("insert", "sites", "S2", async () => { throw new Error("socket hang up"); }));
  await assert.rejects(log.wrap("insert", "sites", "S3", async () => { throw Object.assign(new Error("503"), { status: 503 }); }));
  await assert.rejects(log.wrap("insert", "sites", "S4", async () => { throw Object.assign(new Error("stopped"), { notSentBeforeStart: true }); }));
  const verdict = intentsVerdict(log);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.open.map((o) => o.key), ["S2", "S3"], "transport error and 5xx stay open; a stop before emission is not-sent");
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(defaultDefinitive({ status }), true, String(status));
  for (const status of [408, 500, 502, 503, 504, undefined]) assert.equal(defaultDefinitive({ status }), false, String(status));
});

test("position redaction: coordinates, pairs, geometry and labels never survive; integers and secrets handled", () => {
  assert.equal(redactPositionString("point 14.6035, -61.0680 sent"), `point ${POSITION} sent`);
  assert.equal(redactPositionString("lat=14.60351"), `lat=${POSITION}`);
  assert.equal(redactPositionString("seq 12 version 3"), "seq 12 version 3");
  const out = redactPosition({ seq: 3, latitude: 14.6, position: { latitude: 1, longitude: 2 }, geometry: { coordinates: [[1.5, 2.5]] }, destination_label: "Rue X", ok: 1.5 });
  assert.equal(out.seq, 3);
  assert.equal(out.latitude, POSITION);
  assert.equal(out.position, POSITION);
  assert.equal(out.geometry, POSITION);
  assert.equal(out.destination_label, POSITION);
  assert.equal(out.ok, POSITION, "non-integer numbers are treated as possible coordinates");
  const r = withPositionRedaction(createRedactor(["supersecretvalue123"]));
  assert.equal(r.redactString("key supersecretvalue123 at 14.6035,-61.0680"), `key [REDACTED] at ${POSITION}`);
  const ev = snapshotEvidence({ permissions: { can_share: true, can_confirm_destination: false }, tracking: { shared: true, position_state: "fresh", position: { latitude: 14.6, longitude: -61, accuracy_m: 18, sampled_at: new Date(Date.now() - 7000).toISOString(), received_at: new Date().toISOString() }, last_seq: 2, control_version: 4, destination_version: 1, destination: null, session_id: randomUUID(), travel_stage: "en_route" } });
  assert.equal(JSON.stringify(ev).includes("14.6"), false);
  assert.equal(ev.accuracy_bucket, "≤20m");
  assert.equal(ev.position_present, true);
});

test("request summaries keep action/session/seq only, flag query strings and validate the restart sequence (A4/A5)", () => {
  const id = randomUUID();
  assert.equal(parseTrackingUrl(`https://app.test/api/interventions/${id}/tracking?x=1`)?.hasQuery, true);
  assert.equal(parseTrackingUrl(`https://app.test/api/interventions/${id}/tracking/route`)?.kind, "route");
  assert.equal(parseTrackingUrl("https://app.test/api/workspace"), null);
  const s1 = randomUUID(), s2 = randomUUID();
  const point = summarizeTrackingRequest("POST", `https://app.test/api/interventions/${id}/tracking`, JSON.stringify({ action: "point", expected_version: 2, payload: { session_id: s1, seq: 4, latitude: 14.6, longitude: -61 } }));
  assert.deepEqual({ action: point?.action, seq: point?.seq, session: point?.session_id }, { action: "point", seq: 4, session: s1 });
  assert.equal(JSON.stringify(point).includes("14.6"), false, "coordinates are never kept");
  const req = (action: string, session: string, status = 200, seq: number | null = null) => ({ method: "POST", kind: "tracking", action, session_id: session, status, seq, hasQuery: false });
  assert.deepEqual(restartViolations([req("stop", s1), req("start", s2), req("point", s2, 200, 1)], s1), []);
  assert.ok(restartViolations([req("start", s2, 409)], s1).some((v) => v.includes("409")));
  assert.ok(restartViolations([req("start", s2), req("stop", s1)], s1).some((v) => v.includes("before stop")));
  assert.ok(restartViolations([req("stop", s1), req("start", s1)], s1).some((v) => v.includes("reused")));
  assert.ok(restartViolations([req("stop", s2), req("start", randomUUID())], s1).some((v) => v.includes("snapshot")));
  assert.ok(restartViolations([req("stop", s1), req("point", s1), req("start", s2)], s1).some((v) => v.includes("point sent before")));
  assert.ok(restartViolations([req("stop", s1), req("stop", s1)], s1).some((v) => v.includes("repeated")));
  assert.equal(queryViolations([{ hasQuery: true }, { hasQuery: false }] as never).length, 1);
  assert.equal(actions([req("stop", s1), req("start", s2)] as never, "start").length, 1);
});

test("provider classification: valid route, documented 503/429 are 'unavailable', malformed answers FAIL", () => {
  const snapshot = { tracking: { session_id: "s", control_version: 3, last_seq: 2, destination_version: 1 } };
  const good = { state: "available", source: "IGN Géoplateforme / BD TOPO", resource: "bdtopo-valhalla", resource_version: "2026-10-29", distance_m: 10890, duration_s: 783, calculated_at: new Date().toISOString(), position_sampled_at: new Date().toISOString(), session_id: "s", control_version: 3, point_seq: 2, destination_version: 1, geometry: { type: "LineString", coordinates: [[-61.06, 14.6], [-61, 14.59]] }, snapped_start: [-61.06, 14.6], snapped_end: [-61, 14.59], traffic: "not_available", attribution: "IGN" };
  assert.equal(classifyRoute({ status: 200, body: good }, snapshot).verdict, "available");
  assert.equal(classifyRoute({ status: 200, body: { ...good, point_seq: 1 } }, snapshot).verdict, "fail");
  assert.equal(classifyRoute({ status: 200, body: { ...good, traffic: "live" } }, snapshot).verdict, "fail");
  assert.equal(classifyRoute({ status: 200, body: { ...good, geometry: { type: "LineString", coordinates: [[1, 2]] } } }, snapshot).verdict, "fail");
  assert.deepEqual(classifyRoute({ status: 503, body: { reason: "provider_timeout" } }, snapshot), { verdict: "unavailable", reason: "provider_timeout", note: null });
  assert.equal(classifyRoute({ status: 503, body: { reason: "provider_quota" } }, snapshot).verdict, "unavailable", "any 503 is non-proof");
  assert.equal(classifyRoute({ status: 503, body: { reason: "provider_quota", retry_after_s: 12 } }, snapshot).verdict, "unavailable");
  assert.equal(classifyRoute({ status: 503, body: { reason: "position_unavailable", duration_s: 300 } }, snapshot).verdict, "fail", "no ETA in a 503");
  assert.equal(classifyRoute({ status: 503, body: { reason: "boom" } }, snapshot).verdict, "unavailable");
  assert.equal(classifyRoute({ status: 429, body: { reason: "application_quota" }, retryAfter: null }, snapshot).verdict, "unavailable");
  assert.equal(classifyRoute({ status: null, body: null }, snapshot).verdict, "unavailable", "timeout/transport");
  assert.equal(classifyRoute({ status: 504, body: null }, snapshot).verdict, "unavailable");
  assert.equal(classifyRoute({ status: 500, body: {} }, snapshot).verdict, "fail");
  assert.equal(classifyRoute({ status: 429, body: { reason: "application_quota" }, retryAfter: "5" }, snapshot).verdict, "unavailable");
  assert.equal(classifyGeocode({ status: 200, body: { source: "IGN / BAN", candidates: [{ latitude: 14.6, longitude: -61, label: "Savane", score: 0.8, type: "locality" }] } }).verdict, "available");
  assert.equal(classifyGeocode({ status: 200, body: { source: "IGN / BAN", candidates: [{ latitude: 14.6, longitude: -61, label: "x", score: 2, type: "street" }] } }).verdict, "fail");
});

test("preflight: anonymous 401 JSON private no-store, served BUILD_ID, table HEAD and authenticated 404", async () => {
  const ok = async () => json(401, { error: "Connectez-vous" }, { "cache-control": "private, no-store" });
  assert.equal((await checkAnonymous(ok as typeof fetch, "https://app.test")).status, 401);
  await assert.rejects(checkAnonymous((async () => json(404, { error: "x" }, { "cache-control": "private, no-store" })) as typeof fetch, "https://app.test"), PreflightError);
  await assert.rejects(checkAnonymous((async () => json(401, { error: "x" }, { "cache-control": "no-cache" })) as typeof fetch, "https://app.test"), PreflightError);
  await assert.rejects(checkAnonymous((async () => new Response("<html>", { status: 401, headers: { "cache-control": "private, no-store" } })) as typeof fetch, "https://app.test"), PreflightError);
  const page = async () => new Response('<script src="/_next/static/AbC123xyz/_buildManifest.js"></script>', { status: 200 });
  assert.equal((await checkBuildId(page as typeof fetch, "https://app.test", "AbC123xyz")).verified, true);
  await assert.rejects(checkBuildId(page as typeof fetch, "https://app.test", "Other999"), PreflightError);
  await assert.rejects(checkBuildId(page as typeof fetch, "https://app.test", null), PreflightError);
  assert.equal((await checkTrackingTable({ count: async () => 0 })).present, true);
  await assert.rejects(checkTrackingTable({ count: async () => { throw new Error("PGRST205 not found"); } }), PreflightError);
  assert.deepEqual(assertUnknownIs404({ status: 404, cache: "private, no-store" }), { status: 404 });
  assert.throws(() => assertUnknownIs404({ status: 200, cache: "private, no-store" }), PreflightError);
});

test("ownership: canonical e-mails validated before lookup; only ids proven to belong to the run are kept", () => {
  assert.ok(canonicalEmailPattern(RUN).test(`qa-${RUN}-artisan-a@qa.invalid`));
  assert.throws(() => assertCanonicalEmail(`qa-ffffffffffff-client@qa.invalid`, RUN));
  assert.throws(() => assertCanonicalEmail("someone@example.com", RUN));
  assert.throws(() => canonicalEmailPattern("bad"));
  const mine = randomUUID(), foreign = randomUUID(), gone = randomUUID();
  const jobOk = randomUUID(), jobForeign = randomUUID(), org = randomUUID(), site = randomUUID();
  const manifest = { created: { auth_users: [mine, foreign, gone], profiles: [mine, foreign, gone], admin_profiles: [], interventions: [jobOk, jobForeign], organizations: [org], sites: [site], quotes: [randomUUID()] } };
  const emails = new Map<string, string | null>([[mine, `qa-${RUN}-client@qa.invalid`], [foreign, "victim@example.com"], [gone, null]]);
  const { manifest: proven, unproven } = proveOwnership({ manifest, runId: RUN, emails, interventions: [{ id: jobOk, client_id: mine, artisan_id: null }, { id: jobForeign, client_id: foreign, artisan_id: null }], organizations: [{ id: org, owner_id: mine }], sites: [{ id: site, organization_id: org }] });
  assert.deepEqual(proven.created.profiles.sort(), [mine, gone].sort());
  assert.deepEqual(proven.created.interventions, [jobOk]);
  assert.deepEqual(proven.created.sites, [site]);
  assert.deepEqual(proven.created.quotes, []);
  assert.deepEqual(unproven.map((u) => u.key).sort(), ["interventions", "profiles", "quotes"]);
});

function fakeDb({ leases = 0, failDelete = "" } = {}) {
  const calls: string[] = [];
  return {
    calls,
    async delete(table: string) {
      calls.push(`delete ${table}`);
      if (table === failDelete) throw new Error("FK violation");
    },
    async count(table: string) {
      calls.push(`count ${table}`);
      return table === "tracking_provider_leases" ? leases : 0;
    },
    async storageRemove() {},
    async storageList() { return []; },
    async deleteAuthUser() { calls.push("delete auth"); },
    async authUserExists() { return false; },
    async select() { return []; },
  };
}

test("cleanup: tracking rows first, shared FK order after, leases only re-read, budget never touched", async () => {
  const order = cleanupOrder();
  assert.equal(order[0], "intervention_tracking by intervention_id");
  assert.ok(order.indexOf("intervention_tracking by intervention_id") < order.indexOf("interventions by id"));
  assert.ok(order.indexOf("intervention_tracking by intervention_id") < order.indexOf("profiles by id"));
  assert.equal(order.some((s) => /tracking_provider_budget|tracking_provider_leases/.test(s)), false);
  assert.deepEqual(NEVER_TOUCHED, ["tracking_provider_budget"]);
  assert.equal(TRACKING_PRE_STEPS.length, 1);
  const job = randomUUID(), user = randomUUID();
  const manifest = { created: { auth_users: [user], profiles: [user], interventions: [job], organizations: [], sites: [], quotes: [], approvals: [], documents: [], storage_paths: [], support_tickets: [], admin_profiles: [] } };
  const db = fakeDb();
  const result = await runTrackingCleanup(db, manifest);
  assert.equal(result.ok, true);
  assert.equal(db.calls[0], "delete intervention_tracking");
  assert.ok(db.calls.indexOf("delete intervention_tracking") < db.calls.indexOf("delete interventions"));
  assert.ok(db.calls.includes("count tracking_provider_leases"));
  assert.equal(db.calls.some((c) => c.includes("tracking_provider_budget") || c === "delete tracking_provider_leases"), false);
  assert.equal((await runTrackingCleanup(fakeDb({ leases: 1 }), manifest)).ok, false, "a remaining lease is INCOMPLETE");
  assert.equal((await runTrackingCleanup(fakeDb({ failDelete: "intervention_tracking" }), manifest)).ok, false);
  assert.equal((await runTrackingCleanup(fakeDb(), { created: { ...manifest.created, interventions: ["not-a-uuid"] } })).ok, false);
});

test("cleanupWithProof: an open intent is recovered by canonical e-mail but keeps the run INCOMPLETE (exit 3)", async () => {
  const dir = tmp();
  const user = randomUUID();
  const intents = new IntentLog(path.join(dir, "intents.json"));
  intents.begin("createAuthUser", "auth.users", `qa-${RUN}-artisan-b@qa.invalid`);
  const manifest = { created: { auth_users: [], profiles: [], interventions: [], organizations: [], sites: [], quotes: [], approvals: [], documents: [], storage_paths: [], support_tickets: [], admin_profiles: [] } };
  const looked: string[] = [];
  const auth = { async searchByEmail(email: string, run: string) { assertCanonicalEmail(email, run); looked.push(email); return { state: "found", id: user }; }, async readUser() { return { state: "found", email: `qa-${RUN}-artisan-b@qa.invalid` }; } };
  const result = await cleanupWithProof({ db: fakeDb(), auth, manifest, intents, runId: RUN, log: () => {} });
  assert.deepEqual(looked, [`qa-${RUN}-artisan-b@qa.invalid`]);
  assert.ok(manifest.created.auth_users.includes(user), "recovered account added for deletion");
  assert.equal(result.ok, false, "an unknown outcome is never reported as clean");
  assert.equal(result.open_intents.length, 1);
  // With an in-memory readback (normal run), the same open intent is PROVEN and the run can be clean.
  const proven = new IntentLog(path.join(dir, "proven.json"));
  const pid = proven.begin("createAuthUser", "auth.users", `qa-${RUN}-artisan-b@qa.invalid`);
  proven.attach(pid, async () => ({ proven: true, note: "account absent" }));
  const provenResult = await cleanupWithProof({ db: fakeDb(), auth, manifest: { created: { ...manifest.created, auth_users: [], profiles: [] } }, intents: proven, runId: RUN, log: () => {} });
  assert.equal(provenResult.ok, true);
  assert.equal(proven.entries[0].outcome, "reconciled");
  const clean = new IntentLog(path.join(dir, "clean.json"));
  const ok = await cleanupWithProof({ db: fakeDb(), auth, manifest: { created: { ...manifest.created, auth_users: [], profiles: [] } }, intents: clean, runId: RUN, log: () => {} });
  assert.equal(ok.ok, true);
});

test("stop gate: after a signal the harness refuses tracking POSTs, clicks and waits before any side effect", async () => {
  const gate = createStopGate();
  const intents = new IntentLog(path.join(tmp(), "intents.json"));
  const trackingApi = createTrackingApi({ gate, intents });
  gate.stop("SIGINT");
  assert.throws(() => trackingApi.post({} as never, "/api/interventions/x/tracking", { action: "point" }), StopRequestedError);
  await assert.rejects(trackingApi.get({} as never, "/api/interventions/x/tracking"), StopRequestedError);
  assert.equal(intents.entries.length, 0, "no intent opened (nothing sent)");
  let clicked = false;
  await assert.rejects(act(gate, async () => { clicked = true; }), StopRequestedError);
  assert.equal(clicked, false);
  await assert.rejects(gatedWait(gate, 1000), StopRequestedError);
});

test("runOne: a refused reassignment guard is BLOCKED (never PASS); a UI deviation is FAIL, not ANOMALY", async () => {
  const report = createReport({}, createRedactor());
  const blocked = await runOne(report, "tracking", "T12-sim", async () => { throw Object.assign(new Error("dossier not in this run's manifest"), { blocked: true }); });
  assert.equal(blocked.status, "BLOCKED");
  const { expectVisible } = await import("../scripts/qa/lib/browser.mjs");
  const missing = { first: () => ({ waitFor: async () => { throw new Error("Timeout 10ms exceeded"); } }) };
  const ui = await runOne(report, "tracking", "T3", async () => expectVisible(missing as never, `« ${UI.consent} »`, { timeout: 10 }));
  assert.equal(ui.status, "FAIL");
});

test("constants and sources: emulated position label, T12 only as simulation, no budget write and no backend file in the harness", () => {
  assert.equal(POSITION_SOURCE, "simulated_browser_geolocation");
  assert.ok(SCENARIOS.includes("T12-sim") && !SCENARIOS.includes("T12"));
  assert.ok(SCENARIOS.includes("T8") && SCENARIOS.includes("T8-fail"));
  assert.equal(UI.resume, "Reprendre le partage");
  assert.deepEqual(PUBLIC_POINTS.savane, { latitude: 14.6035, longitude: -61.068 });
  const dir = path.join(process.cwd(), "scripts/qa-tracking");
  const files = [...readdirSync(dir).map((f) => path.join(dir, f)), ...readdirSync(path.join(dir, "lib")).map((f) => path.join(dir, "lib", f))].filter((f) => f.endsWith(".mjs") && !f.endsWith("sql-backoff-review.mjs"));
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.equal(/(insert|upsert|update|delete|remove)\(\s*"tracking_provider_(budget|leases)"/.test(src), false, `${file} writes provider tables`);
    assert.equal(/rpc\(\s*"(tracking_provider_backoff|claim_tracking_provider|tracking_command|tracking_snapshot)"/.test(src), false, `${file} calls a tracking RPC directly (must go through the API)`);
    assert.equal(/(insert|upsert|update)\(\s*"intervention_tracking"/.test(src), false, `${file} writes intervention_tracking directly`);
  }
});

test("outcome classification and readback proofs: only definitive 4xx refuse, only monotonic evidence proves", () => {
  assert.equal(classifyMutation({ status: 200, complete: true }), "done");
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(classifyMutation({ status, complete: true }), "refused");
  for (const status of [500, 502, 503, 504, 408, 301]) assert.equal(classifyMutation({ status, complete: true }), "unknown", String(status));
  assert.equal(classifyMutation({ status: 200, complete: false }), "unknown", "body not fully read");
  assert.equal(classifyMutation({ transportError: true }), "unknown");
  const id = randomUUID(), sid = randomUUID();
  const point = describeMutation(`/api/interventions/${id}/tracking`, { action: "point", expected_version: 1, payload: { session_id: sid, seq: 4, latitude: 1, longitude: 2 } });
  assert.deepEqual([point.kind, point.action, point.seq], ["tracking", "point", 4]);
  assert.equal(proveTracking(point, { session_id: sid, last_seq: 4 }).proven, true);
  assert.equal(proveTracking(point, { session_id: sid, last_seq: 3 }).proven, false);
  assert.equal(proveTracking({ ...point, action: "start" }, { session_id: sid }).proven, true);
  assert.equal(proveTracking({ ...point, action: "start" }, null).proven, false, "absence is not proof for a start");
  assert.equal(proveTracking({ ...point, action: "stop" }, { session_id: null }).proven, true, "a closed session is final");
  assert.equal(proveTracking({ ...point, action: "stop" }, { session_id: sid }).proven, false);
  assert.equal(proveTracking({ ...point, action: "destination", before: 2 }, { destination_version: 3 }).proven, true);
  assert.equal(proveTracking({ ...point, action: "destination", before: null }, { destination_version: 3 }).proven, false);
  assert.equal(proveAction({ action: "complete" }, { status: "completed" }).proven, true);
  assert.equal(proveAction({ action: "complete" }, { status: "in_progress" }).proven, false);
  assert.equal(describeMutation(`/api/interventions/${id}/tracking/route`, {}).kind, "provider");
});

test("guarded cleanup and exit codes: undrained producer ⇒ no deletion, recovery command, exit 3", async () => {
  let cleaned = 0, stopped = 0;
  const gate = { pending: 2 };
  const refused = await createGuardedCleanup({ gate, recovery: "node scripts/qa-tracking/run.mjs --cleanup-manifest m.json", stopProducers: async () => { stopped++; }, proveAndClean: async () => { cleaned++; return { ok: true }; } })();
  assert.equal(cleaned, 0);
  assert.equal(stopped, 1, "producers are still stopped");
  assert.equal(refused.ok, false);
  assert.equal(refused.deletes, 0);
  assert.match(refused.recovery, /--cleanup-manifest/);
  assert.equal(exitCodeFor({ cleanup: refused, signal: true }), 3);
  assert.equal(exitCodeFor({ cleanup: { ok: true }, signal: true }), 130);
  assert.equal(exitCodeFor({ cleanup: { ok: true }, fail: 1 }), 1);
  assert.equal(exitCodeFor({ cleanup: { ok: false }, fail: 1 }), 3, "an incomplete cleanup wins over a FAIL");
  assert.equal(exitCodeFor({ cleanup: null, preflight: true }), 2);
});

