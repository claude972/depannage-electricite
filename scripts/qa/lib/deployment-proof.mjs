// Remote-only QA attestation. No network, credentials, fixtures or LOCAL-mode changes.
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BUILD_ID_RE, flightPushes, servedBuildIdentity } from "../../qa-business/lib/preflight.mjs";

const run = promisify(execFile);
const MAX_BYTES = 16 * 1024;
const MAX_AGE = 15 * 60 * 1000;
const FUTURE = 30 * 1000;
const FIELDS = ["schemaVersion", "origin", "projectId", "teamId", "deploymentId", "readyState", "target", "gitSource", "servedBuildId", "capturedAt"];
const EXPECTED = ["origin", "projectId", "teamId", "deploymentId", "repoId", "ref", "sha", "servedBuildId"];

function refuse(code) {
  const error = new Error(`Deployment provenance refused: ${code}`);
  error.code = code;
  throw error;
}
function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function originOK(value) {
  if (typeof value !== "string" || value.length > 253) return false;
  // The receipt operator attests this is the deployment URL, not a movable alias.
  if (!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.vercel\.app$/.test(value)) return false;
  try { return new URL(value).origin === value; } catch { return false; }
}
function identityOK(value) {
  return originOK(value.origin) &&
    typeof value.projectId === "string" && /^prj_[A-Za-z0-9]{1,128}$/.test(value.projectId) &&
    typeof value.teamId === "string" && /^team_[A-Za-z0-9]{1,128}$/.test(value.teamId) &&
    typeof value.deploymentId === "string" && /^dpl_[A-Za-z0-9]{1,128}$/.test(value.deploymentId) &&
    Number.isSafeInteger(value.repoId) && value.repoId > 0 &&
    value.ref === "integration/web-pwa" && typeof value.sha === "string" && /^[a-f0-9]{40}$/.test(value.sha) &&
    typeof value.servedBuildId === "string" && BUILD_ID_RE.test(value.servedBuildId);
}

/** Trusted operator input, checked against independent runner configuration. */
export function validateDeploymentProof(receipt, { expected, nowMs = Date.now() } = {}) {
  if (!exact(expected, EXPECTED) || !identityOK(expected)) refuse("EXPECTED");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) refuse("CLOCK");
  if (!exact(receipt, FIELDS) || !exact(receipt.gitSource, ["type", "repoId", "ref", "sha"])) refuse("SCHEMA");
  if (receipt.schemaVersion !== 1 || receipt.readyState !== "READY" ||
      (receipt.target !== "preview" && receipt.target !== null) || receipt.gitSource.type !== "github") refuse("STATE");
  const identity = {
    origin: receipt.origin, projectId: receipt.projectId, teamId: receipt.teamId,
    deploymentId: receipt.deploymentId, repoId: receipt.gitSource.repoId,
    ref: receipt.gitSource.ref, sha: receipt.gitSource.sha, servedBuildId: receipt.servedBuildId,
  };
  if (!identityOK(identity)) refuse("IDENTITY");
  if (!EXPECTED.every((key) => identity[key] === expected[key])) refuse("MISMATCH");
  const captured = typeof receipt.capturedAt === "string" ? Date.parse(receipt.capturedAt) : NaN;
  if (!Number.isFinite(captured) || new Date(captured).toISOString() !== receipt.capturedAt) refuse("DATE");
  if (nowMs - captured > MAX_AGE || captured - nowMs > FUTURE) refuse("EXPIRED");
  return Object.freeze({ ...receipt, gitSource: Object.freeze({ ...receipt.gitSource }) });
}

/** Private regular file outside every Git worktree; no received content enters errors. */
export async function loadDeploymentProof({ receiptPath, expected, nowMs = Date.now() } = {}) {
  if (typeof receiptPath !== "string" || !path.isAbsolute(receiptPath)) refuse("PATH");
  let handle;
  try {
    const parent = await realpath(path.dirname(receiptPath));
    try {
      await run("git", ["-C", parent, "rev-parse", "--show-toplevel"], {
        timeout: 5000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" },
      });
      refuse("IN_GIT");
    } catch (error) {
      if (error.code === "IN_GIT") throw error;
      // git returns 128 for a directory outside a repository. Other errors are not evidence.
      if (error.code !== 128 || !String(error.stderr).includes("not a git repository")) refuse("GIT_CHECK");
    }
    handle = await open(path.join(parent, path.basename(receiptPath)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) refuse("FILE_TYPE");
    if (typeof process.getuid !== "function" || before.uid !== BigInt(process.getuid())) refuse("OWNER");
    if ((before.mode & 0o7777n) !== 0o600n || before.nlink !== 1n) refuse("MODE");
    if (before.size < 1n || before.size > BigInt(MAX_BYTES)) refuse("SIZE");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (length > MAX_BYTES || BigInt(length) !== before.size ||
        ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].some((key) => before[key] !== after[key])) refuse("CHANGED");
    let receipt;
    try { receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { refuse("JSON"); }
    return validateDeploymentProof(receipt, { expected, nowMs });
  } catch (error) {
    if (["EXPECTED", "CLOCK", "SCHEMA", "STATE", "IDENTITY", "MISMATCH", "DATE", "EXPIRED", "PATH", "IN_GIT", "GIT_CHECK", "FILE_TYPE", "OWNER", "MODE", "SIZE", "CHANGED", "JSON"].includes(error.code)) throw error;
    refuse("FILE_READ");
  } finally {
    await handle?.close();
  }
}

/** Call with the actual fetched page before creating any fixture. */
export function verifyRemoteDeployment({ proof, html, expected, nowMs = Date.now() } = {}) {
  const checked = validateDeploymentProof(proof, { expected, nowMs });
  if (typeof html !== "string" || !html.length || html.length > 8 * 1024 * 1024) refuse("HTML");
  if (flightPushes(html).invalid !== 0) refuse("FLIGHT_INVALID");
  const identity = servedBuildIdentity(html);
  if (identity.ambiguous || identity.source !== "flight" || identity.candidates.length !== 1 ||
      identity.id !== checked.servedBuildId || identity.id !== expected.servedBuildId) refuse("SERVED_BUILD");
  return Object.freeze({ mode: "remote", origin: checked.origin, sha: checked.gitSource.sha,
    deploymentId: checked.deploymentId, servedBuildId: identity.id, capturedAt: checked.capturedAt,
    provenance: "root-receipt+served-flight" });
}
