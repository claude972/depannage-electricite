import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, symlink, link, mkdir, rm, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateDeploymentProof, loadDeploymentProof, verifyRemoteDeployment } from "../lib/deployment-proof.mjs";

const now = Date.parse("2026-10-31T20:00:00.000Z");
const expected = Object.freeze({ origin: "https://example-abc123-team.vercel.app", projectId: "prj_Test",
  teamId: "team_Test", deploymentId: "dpl_Test", repoId: 1440353116, ref: "integration/web-pwa",
  sha: "4c398e8393026598c5b629d3912cf80285acc2f5", servedBuildId: "W1T6udg45nuoEg3XO7IGT" });
function receipt() { return { schemaVersion: 1, origin: expected.origin, projectId: expected.projectId,
  teamId: expected.teamId, deploymentId: expected.deploymentId, readyState: "READY", target: "preview",
  gitSource: { type: "github", repoId: expected.repoId, ref: expected.ref, sha: expected.sha },
  servedBuildId: expected.servedBuildId, capturedAt: new Date(now).toISOString() }; }
function flight(id = expected.servedBuildId) {
  return `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify({ b: id })}\n`])})</script>`;
}
function check(value, exp = expected, clock = now) { return validateDeploymentProof(value, { expected: exp, nowMs: clock }); }
function reject(fn, code) { assert.throws(fn, (error) => error.code === code && !error.message.includes(expected.origin)); }
async function privateFile(t, content = JSON.stringify(receipt())) {
  const dir = await mkdtemp(path.join(tmpdir(), "deployment-proof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "receipt.json");
  await writeFile(file, content, { mode: 0o600 });
  return { dir, file };
}
const load = (file) => loadDeploymentProof({ receiptPath: file, expected, nowMs: now });

test("valid READY preview and null-target receipts normalize and freeze", () => {
  const value = check(receipt());
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.gitSource));
  assert.equal(check({ ...receipt(), target: null }).deploymentId, expected.deploymentId);
});

test("every required receipt field rejects absence, extra keys and null except target", () => {
  for (const key of Object.keys(receipt())) {
    const missing = receipt(); delete missing[key]; reject(() => check(missing), "SCHEMA");
    if (key !== "target") assert.throws(() => check({ ...receipt(), [key]: null }));
  }
  reject(() => check({ ...receipt(), secret: "do-not-print" }), "SCHEMA");
  for (const key of Object.keys(receipt().gitSource)) {
    const value = receipt(); delete value.gitSource[key]; reject(() => check(value), "SCHEMA");
    const nullValue = receipt(); nullValue.gitSource[key] = null; assert.throws(() => check(nullValue));
  }
  const extra = receipt(); extra.gitSource.token = "never-report"; reject(() => check(extra), "SCHEMA");
});

test("wrong types and malformed deployment/source states fail closed", () => {
  for (const [key, value] of [["schemaVersion", "1"], ["readyState", "BUILDING"], ["target", "production"],
    ["origin", []], ["projectId", 1], ["teamId", {}], ["deploymentId", true], ["servedBuildId", 123]]) {
    assert.throws(() => check({ ...receipt(), [key]: value }));
  }
  for (const [key, value] of [["type", "gitlab"], ["repoId", "1440353116"], ["repoId", 0],
    ["repoId", 1.5], ["repoId", Number.MAX_SAFE_INTEGER + 1], ["ref", "main"], ["sha", "a".repeat(39)]]) {
    const r = receipt(); r.gitSource[key] = value; assert.throws(() => check(r));
  }
  for (const value of [null, [], "{}", 1]) reject(() => check(value), "SCHEMA");
});

test("all eight independent expectations must match and be explicitly supplied", () => {
  const alternatives = { origin: "https://other-abc-team.vercel.app", projectId: "prj_Other", teamId: "team_Other",
    deploymentId: "dpl_Other", repoId: 1, ref: "main", sha: "a".repeat(40), servedBuildId: "OtherBuild" };
  for (const [key, value] of Object.entries(alternatives)) {
    assert.throws(() => check(receipt(), { ...expected, [key]: value }));
    const incomplete = { ...expected }; delete incomplete[key]; reject(() => check(receipt(), incomplete), "EXPECTED");
  }
  reject(() => check(receipt(), { ...expected, extra: true }), "EXPECTED");
});

test("custom domains, credentials, ports, aliases without suffix, paths and query are refused even if expected agrees", () => {
  for (const origin of ["http://example-abc-team.vercel.app", "https://example.com", "https://vercel.app",
    "https://example.vercel.app", "https://user:pass@example-abc-team.vercel.app", "https://example-abc-team.vercel.app:443",
    "https://example-abc-team.vercel.app/", "https://example-abc-team.vercel.app/?bypass=secret", "https://example-abc-team.vercel.app#main"]) {
    reject(() => check({ ...receipt(), origin }, { ...expected, origin }), "EXPECTED");
  }
});

test("capture age and clock are finite canonical and bounded, including verification-time expiry", () => {
  for (const capturedAt of ["Infinity", "2026-10-31", "2026-10-31T20:00:00Z", 0, null,
    new Date(now - 900001).toISOString(), new Date(now + 30001).toISOString()]) {
    assert.throws(() => check({ ...receipt(), capturedAt }));
  }
  assert.ok(check({ ...receipt(), capturedAt: new Date(now - 900000).toISOString() }));
  for (const clock of [NaN, Infinity, -1, "123", 1.5]) reject(() => check(receipt(), expected, clock), "CLOCK");
  reject(() => verifyRemoteDeployment({ proof: receipt(), html: flight(), expected, nowMs: now + 900001 }), "EXPIRED");
});

test("real parser decodes escaped Flight and fragmented chunks without local BUILD_ID", () => {
  const payload = `0:${JSON.stringify({ b: expected.servedBuildId, c: ["", "app"] })}\n`;
  const html = [payload.slice(0, 13), payload.slice(13)].map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("");
  assert.ok(html.includes('\\"b\\"')); // The failing substring approach would not find a quoted id.
  const proof = verifyRemoteDeployment({ proof: receipt(), html, expected, nowMs: now });
  assert.equal(proof.mode, "remote"); assert.equal(proof.servedBuildId, expected.servedBuildId);
  assert.equal(proof.provenance, "root-receipt+served-flight"); assert.ok(Object.isFrozen(proof));
});

test("wrong, missing, malformed and ambiguous served identities are refused", () => {
  for (const html of [flight("DifferentBuild"), "<html>no build</html>", flight() + flight("OtherBuild"),
    `<script src="/_next/static/${expected.servedBuildId}/_buildManifest.js"></script>`,
    flight() + '<script>self.__next_f.push([1,"unterminated)</script>']) {
    assert.throws(() => verifyRemoteDeployment({ proof: receipt(), html, expected, nowMs: now }));
  }
  for (const html of [null, "", [], "a".repeat(8 * 1024 * 1024 + 1)]) {
    reject(() => verifyRemoteDeployment({ proof: receipt(), html, expected, nowMs: now }), "HTML");
  }
});

test("private outside-Git receipt is read successfully", async (t) => {
  const { file } = await privateFile(t);
  assert.equal((await load(file)).gitSource.sha, expected.sha);
});

test("file permission, symlink, hardlink, directory, missing and relative paths refuse", async (t) => {
  const { dir, file } = await privateFile(t);
  await chmod(file, 0o644); await assert.rejects(load(file), { code: "MODE" });
  await chmod(file, 0o600);
  const symbolic = path.join(dir, "symbolic"); await symlink(file, symbolic);
  await assert.rejects(load(symbolic), { code: "FILE_READ" });
  const hard = path.join(dir, "hard"); await link(file, hard);
  await assert.rejects(load(hard), { code: "MODE" });
  await assert.rejects(load(dir), { code: "FILE_TYPE" });
  await assert.rejects(load(path.join(dir, "absent")), { code: "FILE_READ" });
  await assert.rejects(load("relative.json"), { code: "PATH" });
});

test("Git worktree files are rejected through canonical parent aliases too", async (t) => {
  const { dir } = await privateFile(t);
  const repo = path.join(dir, "repo"); await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  const file = path.join(repo, "receipt.json"); await writeFile(file, JSON.stringify(receipt()), { mode: 0o600 });
  await assert.rejects(load(file), { code: "IN_GIT" });
  const alias = path.join(dir, "repo-alias"); await symlink(repo, alias);
  await assert.rejects(load(path.join(alias, "receipt.json")), { code: "IN_GIT" });
});

test("owner check refuses a UID different from runtime identity before reading contents", async (t) => {
  const { file } = await privateFile(t);
  const original = process.getuid;
  try {
    process.getuid = () => original() + 1;
    await assert.rejects(load(file), { code: "OWNER" });
  } finally { process.getuid = original; }
});

test("inherited Git discovery/config overrides cannot hide a repository or redirect the outside check", async (t) => {
  const { dir, file: outside } = await privateFile(t);
  const repo = path.join(dir, "repo"); await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  const sub = path.join(repo, "sub"); await mkdir(sub);
  await writeFile(path.join(sub, "receipt.json"), JSON.stringify(receipt()), { mode: 0o600 });
  const alias = path.join(dir, "sub-alias"); await symlink(sub, alias);
  const overrides = {
    GIT_CEILING_DIRECTORIES: await realpath(repo), GIT_DIR: path.join(dir, "missing.git"),
    GIT_WORK_TREE: dir, GIT_COMMON_DIR: path.join(dir, "missing-common"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "true",
    GIT_CONFIG_PARAMETERS: "invalid injected parameters", GIT_CONFIG_GLOBAL: path.join(dir, "missing-global"),
    GIT_CONFIG_SYSTEM: path.join(dir, "missing-system"), GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
  };
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
    Object.assign(process.env, overrides);
    await assert.rejects(load(path.join(sub, "receipt.json")), { code: "IN_GIT" });
    await assert.rejects(load(path.join(alias, "receipt.json")), { code: "IN_GIT" });
    assert.equal((await load(outside)).deploymentId, expected.deploymentId);
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
    for (const [key, value] of Object.entries(saved)) if (key.startsWith("GIT_")) process.env[key] = value;
  }
});

test("oversized, empty, invalid JSON and invalid UTF8 files are rejected without contents in errors", async (t) => {
  for (const [body, code] of [["", "SIZE"], ["a".repeat(16385), "SIZE"], ["private-invalid-json", "JSON"], [Buffer.from([0xff]), "JSON"]]) {
    const { file } = await privateFile(t, body);
    await assert.rejects(load(file), (error) => error.code === code && !error.message.includes("private-invalid-json"));
  }
});

test("actual root-captured public4c Flight parses without copying page into Git", async (t) => {
  const capture = "/tmp/depannage-public-4c-home-private.html";
  let html;
  try { html = await readFile(capture, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return t.skip("private root capture not present on this host"); throw error; }
  const proof = verifyRemoteDeployment({ proof: receipt(), html, expected, nowMs: now });
  assert.equal(proof.servedBuildId, "W1T6udg45nuoEg3XO7IGT");
});
