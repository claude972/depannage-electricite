// @ts-nocheck
// WEB-TRACKING-QA-006 amendment A7 — build provenance (REMOTE: root receipt + served Flight through the
// reviewed helper scripts/qa/lib/deployment-proof.mjs; LOCAL: strict Business parser). Offline: real
// helper and parser (no stub), temporary 0600 receipts outside Git, injected fetch and clock. No
// .next/BUILD_ID is written. The real public 4c capture is read only when present (SKIPPED otherwise).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { checkBuildProvenance, checkLocalBuild, fetchHomeHtml, expectedFromOptions, MAX_HTML_BYTES } from "../scripts/qa-tracking/lib/preflight.mjs";
import { parseArgs } from "../scripts/qa-tracking/lib/args.mjs";
import { makeManifestDurable } from "../scripts/qa-tracking/lib/durable.mjs";
import { Fixtures } from "../scripts/qa/lib/fixtures.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { PreflightError } from "../scripts/qa/lib/config.mjs";

const BID = "W1T6udg45nuoEg3XO7IGT";
const ORIGIN = "https://example-abc123-team.vercel.app";
const SHA = "4c398e8393026598c5b629d3912cf80285acc2f5";
const NOW = Date.parse("2026-10-31T20:00:00.000Z");
const REMOTE = { mode: "remote", buildId: BID, sha: SHA, vercelProjectId: "prj_Test", vercelTeamId: "team_Test", vercelDeploymentId: "dpl_Test", gitRepoId: 1440353116, gitRef: "integration/web-pwa" };
const flight = (id = BID) => `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify({ b: id })}\n`])})</script>`;
const receipt = (over = {}) => ({ schemaVersion: 1, origin: ORIGIN, projectId: "prj_Test", teamId: "team_Test", deploymentId: "dpl_Test", readyState: "READY", target: "preview", gitSource: { type: "github", repoId: 1440353116, ref: "integration/web-pwa", sha: SHA }, servedBuildId: BID, capturedAt: new Date(NOW).toISOString(), ...over });

function privateReceipt(t, value = receipt(), mode = 0o600) {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-tracking-prov-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "receipt.json");
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { mode });
  chmodSync(file, mode);
  return file;
}
function fetchOf(body, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  fn.calls = calls;
  return fn;
}
async function refusedWith(promise, code, leaks = []) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof PreflightError, "a PreflightError (exit 2, before fixtures)");
    assert.equal(error.provenanceCode, code);
    assert.equal(error.message, `BLOCKED deployment provenance ${code}`);
    for (const leak of leaks) assert.ok(!error.message.includes(leak), "no receipt/page content or path in the message");
    return true;
  });
}

test("LOCAL strict: escaped Flight form accepted; none, two, wrong, invalid push and substring-only refused", () => {
  const escaped = flight();
  assert.ok(escaped.includes(`\\"b\\":\\"${BID}\\"`), "the fixture carries the escaped Flight form");
  assert.ok(!escaped.includes(`/_next/static/${BID}/`) && !escaped.includes(`"${BID}"`), "the d3338e9 substring check would have refused it");
  const ok = checkLocalBuild(escaped, BID);
  assert.deepEqual({ ...ok }, { mode: "local", servedBuildId: BID, source: "flight", provenance: "local-strict-parse" });
  const code = (html, id = BID) => {
    try {
      checkLocalBuild(html, id);
    } catch (error) {
      assert.ok(error instanceof PreflightError);
      return error.provenanceCode;
    }
    return "accepted";
  };
  assert.equal(code("<html></html>"), "LOCAL_NONE");
  assert.equal(code(`<script>var x = "${BID}";</script>`), "LOCAL_NONE", "a bare quoted id is not a build identity");
  assert.equal(code(flight() + flight("OtherBuild123")), "LOCAL_AMBIGUOUS");
  assert.equal(code(flight() + `<script src="/_next/static/OtherBuild123/_buildManifest.js"></script>`), "LOCAL_AMBIGUOUS");
  assert.equal(code(flight("OtherBuild123")), "LOCAL_MISMATCH");
  assert.equal(code(flight() + "<script>self.__next_f.push(null)</script>"), "FLIGHT_INVALID");
  assert.equal(code(flight() + '<script>self.__next_f.push([1,"x"]</script>'), "FLIGHT_INVALID");
  assert.equal(code(""), "HTML");
});

test("REMOTE nominal: real helper, 0600 receipt outside Git, one GET without credentials, compact proof only", async (t) => {
  const file = privateReceipt(t);
  const fetchFn = fetchOf(flight());
  const proof = await checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn, now: () => NOW });
  assert.deepEqual({ ...proof }, { mode: "remote", origin: ORIGIN, sha: SHA, deploymentId: "dpl_Test", servedBuildId: BID, capturedAt: new Date(NOW).toISOString(), provenance: "root-receipt+served-flight" });
  assert.ok(Object.isFrozen(proof));
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].url, `${ORIGIN}/`);
  assert.equal(fetchFn.calls[0].init.redirect, "manual");
  assert.equal(fetchFn.calls[0].init.headers, undefined, "no cookie, no authorization header");
  assert.ok(!JSON.stringify(proof).includes(file), "the receipt path is not kept");
});

test("REMOTE refusals: expiry (> 15 min), each CLI expected value, other build, bad mode, status, transport, size", async (t) => {
  const file = privateReceipt(t);
  const leaks = [file, "prj_Test", "dpl_Test", ORIGIN, BID];
  // Expired receipt: refused BEFORE the page is fetched.
  const expired = fetchOf(flight());
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: expired, now: () => NOW + 15 * 60 * 1000 + 1 }), "EXPIRED", leaks);
  assert.equal(expired.calls.length, 0);
  // Each of the eight expected values comes from the CLI and must match independently.
  for (const [key, value] of [["vercelProjectId", "prj_Other"], ["vercelTeamId", "team_Other"], ["vercelDeploymentId", "dpl_Other"], ["gitRepoId", 7], ["sha", "a".repeat(40)], ["buildId", "OtherBuild123"]]) {
    const f = fetchOf(flight());
    await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file, [key]: value }, origin: ORIGIN, fetchFn: f, now: () => NOW }), "MISMATCH", leaks);
    assert.equal(f.calls.length, 0, `${key}: no request after a mismatch`);
  }
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: "https://other-abc123-team.vercel.app", fetchFn: fetchOf(flight()), now: () => NOW }), "MISMATCH", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file, gitRef: "main" }, origin: ORIGIN, fetchFn: fetchOf(flight()), now: () => NOW }), "EXPECTED", leaks);
  // The page served by another build (or carrying an extra id) is refused by the helper.
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight("OtherBuild123")), now: () => NOW }), "SERVED_BUILD", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight() + flight("OtherBuild123")), now: () => NOW }), "SERVED_BUILD", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(`<script src="/_next/static/${BID}/_buildManifest.js"></script>`), now: () => NOW }), "SERVED_BUILD", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight() + "<script>self.__next_f.push(null)</script>"), now: () => NOW }), "FLIGHT_INVALID", leaks);
  for (const status of [302, 401, 500]) await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight(), status), now: () => NOW }), "HTTP_STATUS", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: async () => { throw new TypeError(`fetch failed ${ORIGIN}`); }, now: () => NOW }), "TRANSPORT", leaks);
  await refusedWith(fetchHomeHtml(fetchOf("x".repeat(MAX_HTML_BYTES + 1)), ORIGIN), "HTML");
  // Receipt file hygiene is the helper's (mode, absence, malformed), surfaced as a fixed code.
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: privateReceipt(t, receipt(), 0o644) }, origin: ORIGIN, fetchFn: fetchOf(flight()), now: () => NOW }), "MODE", leaks);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: privateReceipt(t, "secret-not-json") }, origin: ORIGIN, fetchFn: fetchOf(flight()), now: () => NOW }), "JSON", [...leaks, "secret-not-json"]);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: privateReceipt(t, receipt({ token: "never-print" })) }, origin: ORIGIN, fetchFn: fetchOf(flight()), now: () => NOW }), "SCHEMA", [...leaks, "never-print"]);
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, mode: null, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight()) }), "MODE_REQUIRED");
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, buildId: null, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight()) }), "BUILD_ID_REQUIRED");
  // An unexpected helper exception never leaks its message.
  await refusedWith(checkBuildProvenance({ options: { ...REMOTE, receiptPath: file }, origin: ORIGIN, fetchFn: fetchOf(flight()), deps: { loadDeploymentProof: async () => { throw new Error(`boom ${ORIGIN}`); } } }), "UNKNOWN", leaks);
  assert.deepEqual(expectedFromOptions({ ...REMOTE }, ORIGIN), { origin: ORIGIN, projectId: "prj_Test", teamId: "team_Test", deploymentId: "dpl_Test", repoId: 1440353116, ref: "integration/web-pwa", sha: SHA, servedBuildId: BID });
});

test("CLI: --mode required, REMOTE flags complete and REMOTE-only, LOCAL loopback only, repo id integer", () => {
  const common = ["--base-url", ORIGIN, "--sha", SHA, "--build-id", BID, "--project", "abcdefghijklmnopqrst", "--credentials", "/x.json", "--playwright", "/pw"];
  const remote = ["--mode", "remote", "--deployment-receipt", "/tmp/r.json", "--vercel-project-id", "prj_T", "--vercel-team-id", "team_T", "--vercel-deployment-id", "dpl_T", "--git-repo-id", "1440353116", "--git-ref", "integration/web-pwa"];
  const ok = parseArgs([...common, ...remote]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.options.gitRepoId, 1440353116);
  assert.ok(parseArgs(common).errors.some((e) => e.includes("--mode remote|local is required")));
  assert.ok(parseArgs([...common, "--mode", "staging"]).errors.some((e) => e.includes("--mode must be")));
  assert.ok(parseArgs([...common, "--mode", "remote"]).errors.filter((e) => e.endsWith("is required in --mode remote")).length === 6);
  assert.ok(parseArgs([...common, ...remote.slice(0, -4), "--git-repo-id", "12a", "--git-ref", "integration/web-pwa"]).errors.some((e) => e.includes("--git-repo-id")));
  assert.ok(parseArgs([...common, ...remote.map((v) => (v === "/tmp/r.json" ? "rel.json" : v))]).errors.some((e) => e.includes("absolute")));
  const local = ["--base-url", "http://127.0.0.1:3000", "--sha", SHA, "--build-id", BID, "--project", "abcdefghijklmnopqrst", "--credentials", "/x.json", "--playwright", "/pw", "--mode", "local"];
  assert.deepEqual(parseArgs(local).errors, []);
  assert.ok(parseArgs([...local, "--vercel-project-id", "prj_T"]).errors.some((e) => e.includes("only accepted with --mode remote")));
  assert.ok(parseArgs([...common, "--mode", "local"]).errors.some((e) => e.includes("loopback")));
  assert.ok(parseArgs([...common.filter((v, i, a) => v !== "--build-id" && a[i - 1] !== "--build-id"), ...remote]).errors.some((e) => e.includes("--build-id is required")));
  assert.deepEqual(parseArgs(["--dry-run", "--base-url", ORIGIN, "--sha", SHA, "--project", "abcdefghijklmnopqrst"]).errors, [], "dry-run needs no mode");
});

test("runner placement: an expired REMOTE receipt is refused (exit 2) before --out, intents, fixtures or any request", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-tracking-prov-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.resolve(import.meta.dirname, "..");
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Offline stand-ins: a dummy (non-secret) credentials file pointing at a closed loopback port and a
  // stub Playwright module. Nothing is contacted: the receipt is refused first.
  const credentials = path.join(dir, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ supabase: { url: "http://127.0.0.1:9", project_ref: "abcdefghijklmnopqrst", service_role_key: "dummy-offline-not-a-key-0000" } }), { mode: 0o600 });
  const pw = path.join(dir, "pw");
  mkdirSync(pw);
  writeFileSync(path.join(pw, "index.mjs"), "export const chromium = {};\n");
  const stale = new Date(Date.now() - 16 * 60 * 1000);
  stale.setMilliseconds(0);
  const receiptFile = path.join(dir, "receipt.json");
  writeFileSync(receiptFile, JSON.stringify(receipt({ capturedAt: stale.toISOString(), gitSource: { type: "github", repoId: 1440353116, ref: "integration/web-pwa", sha: head } })), { mode: 0o600 });
  chmodSync(receiptFile, 0o600);
  const out = path.join(dir, "out");
  const run = spawnSync(process.execPath, [path.join(repo, "scripts/qa-tracking/run.mjs"), "--mode", "remote", "--base-url", ORIGIN, "--allow-base-url", ORIGIN, "--sha", head, "--build-id", BID, "--project", "abcdefghijklmnopqrst", "--credentials", credentials, "--playwright", pw, "--app-dir", repo, "--out", out, "--deployment-receipt", receiptFile, "--vercel-project-id", "prj_Test", "--vercel-team-id", "team_Test", "--vercel-deployment-id", "dpl_Test", "--git-repo-id", "1440353116", "--git-ref", "integration/web-pwa"], { encoding: "utf8", timeout: 60000 });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /refused: BLOCKED deployment provenance EXPIRED/);
  for (const leak of [receiptFile, "dpl_Test", "prj_Test", "team_Test", stale.toISOString()]) assert.ok(!(run.stdout + run.stderr).includes(leak), "no receipt value or path in the output");
  assert.equal(existsSync(out), false, "--out not created: no intent, manifest or log written");
});

test("fixtures 5fa7f82: lazy init uses the tracking makeManifestDurable override, base writer never used", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-tracking-prov-fx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let baseWrites = 0;
  const manifestPath = path.join(dir, "manifest.json");
  const f = new Fixtures({ db: { insert: async () => [], update: async () => [], delete: async () => [] }, cohort: { runId: "abcdef123456" }, manifestPath, context: { sha: SHA }, redactor: createRedactor(), gate: createStopGate(), writeJson: async () => { baseWrites++; } });
  assert.equal(existsSync(manifestPath), false, "the constructor writes nothing");
  makeManifestDurable(f);
  assert.equal(existsSync(manifestPath), true, "override writes the empty manifest immediately");
  await f.init();
  await f.track("profiles", "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")).created.profiles, ["00000000-0000-4000-8000-000000000001"]);
  assert.equal(baseWrites, 0);
});

test("real public 4c capture (private, read-only): strict LOCAL parse finds exactly the 4c BUILD_ID", (t) => {
  const capture = process.env.QA_TRACKING_REAL_HTML || "/tmp/depannage-public-4c-home-private.html";
  if (!existsSync(capture)) return t.skip("private root capture not present on this host");
  const html = readFileSync(capture, "utf8");
  assert.equal(checkLocalBuild(html, BID).servedBuildId, BID);
  assert.equal(checkLocalBuild(html, BID).source, "flight");
  assert.ok(!html.includes(`/_next/static/${BID}/`) && !html.includes(`"${BID}"`), "the former substring check refuses this real page");
});
