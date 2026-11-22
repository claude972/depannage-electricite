// Preflight checks (contract §2 + A5.1 + A7). Order: build provenance → anonymous 401 → table HEAD (service)
// — all BEFORE any fixture; the authenticated unknown-UUID 404 runs after the first technical
// account (announced by a durable intent before its creation). Each function takes injected
// transports so it is unit-tested offline.
import { randomUUID } from "node:crypto";
import { PreflightError } from "../../qa/lib/config.mjs";
import { trackingPath } from "./constants.mjs";
import { loadDeploymentProof, verifyRemoteDeployment } from "../../qa/lib/deployment-proof.mjs";
import { flightPushes, servedBuildIdentity } from "../../qa-business/lib/preflight.mjs";

const withTimeout = (ms) => AbortSignal.timeout(ms);

/**
 * Build provenance (amendment A7). REMOTE: ROOT receipt + the real Flight build id of the served
 * page, through the reviewed helper scripts/qa/lib/deployment-proof.mjs (read-only import). LOCAL:
 * strict parse with the Business parser servedBuildIdentity (read-only import), exactly one id.
 * No substring search, no .next/BUILD_ID written. Refusals carry a FIXED code only: no receipt
 * value, page excerpt or path ever reaches a message.
 */
export const MAX_HTML_BYTES = 8 * 1024 * 1024;
const HELPER_CODES = new Set(["EXPECTED", "CLOCK", "SCHEMA", "STATE", "IDENTITY", "MISMATCH", "DATE", "EXPIRED", "PATH", "IN_GIT", "GIT_CHECK", "FILE_TYPE", "OWNER", "MODE", "SIZE", "CHANGED", "JSON", "FILE_READ", "HTML", "FLIGHT_INVALID", "SERVED_BUILD"]);

export function provenanceRefusal(code) {
  const error = new PreflightError(`BLOCKED deployment provenance ${code}`);
  error.provenanceCode = code;
  return error;
}

/** One GET / (manual redirect, no cookie, no auth header), status 200, body read with a hard bound. */
export async function fetchHomeHtml(fetchFn, origin, timeoutMs = 30000) {
  let response;
  try {
    response = await fetchFn(`${origin}/`, { method: "GET", redirect: "manual", credentials: "omit", signal: withTimeout(timeoutMs) });
  } catch {
    throw provenanceRefusal("TRANSPORT");
  }
  if (response.status !== 200) {
    try {
      await response.body?.cancel();
    } catch {}
    throw provenanceRefusal("HTTP_STATUS");
  }
  const chunks = [];
  let size = 0;
  try {
    if (!response.body) throw provenanceRefusal("HTML");
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => {});
        throw provenanceRefusal("HTML");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.provenanceCode) throw error;
    throw provenanceRefusal("TRANSPORT");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw provenanceRefusal("HTML");
  }
}

/** LOCAL strict check: no invalid Flight push, exactly one candidate across sources, equal to --build-id. */
export function checkLocalBuild(html, buildId) {
  if (typeof html !== "string" || !html.length) throw provenanceRefusal("HTML");
  if (flightPushes(html).invalid !== 0) throw provenanceRefusal("FLIGHT_INVALID");
  const identity = servedBuildIdentity(html);
  if (identity.ambiguous || identity.candidates.length > 1) throw provenanceRefusal("LOCAL_AMBIGUOUS");
  if (!identity.id || identity.candidates.length !== 1) throw provenanceRefusal("LOCAL_NONE");
  if (identity.id !== buildId) throw provenanceRefusal("LOCAL_MISMATCH");
  return Object.freeze({ mode: "local", servedBuildId: identity.id, source: identity.source, provenance: "local-strict-parse" });
}

/** The eight independent expected values, all from ROOT's command line (never from the page/receipt). */
export function expectedFromOptions(options, origin) {
  return {
    origin,
    projectId: options.vercelProjectId,
    teamId: options.vercelTeamId,
    deploymentId: options.vercelDeploymentId,
    repoId: options.gitRepoId,
    ref: options.gitRef,
    sha: options.sha,
    servedBuildId: options.buildId,
  };
}

const helperCode = (error) => (HELPER_CODES.has(error?.code) ? error.code : "UNKNOWN");

/**
 * The FIRST network check of a real run, before any fixture, intent, --out or service request.
 * deps are injectable for offline tests; the defaults are the reviewed modules themselves.
 */
export async function checkBuildProvenance({ options, origin, fetchFn, timeoutMs = 30000, now = Date.now, deps = {} }) {
  const load = deps.loadDeploymentProof ?? loadDeploymentProof;
  const verify = deps.verifyRemoteDeployment ?? verifyRemoteDeployment;
  if (!options.buildId) throw provenanceRefusal("BUILD_ID_REQUIRED");
  if (options.mode === "local") return checkLocalBuild(await fetchHomeHtml(fetchFn, origin, timeoutMs), options.buildId);
  if (options.mode !== "remote") throw provenanceRefusal("MODE_REQUIRED");
  const expected = expectedFromOptions(options, origin);
  let proof;
  try {
    proof = await load({ receiptPath: options.receiptPath, expected, nowMs: now() });
  } catch (error) {
    throw provenanceRefusal(helperCode(error));
  }
  const html = await fetchHomeHtml(fetchFn, origin, timeoutMs);
  try {
    return verify({ proof, html, expected, nowMs: now() });
  } catch (error) {
    throw provenanceRefusal(helperCode(error));
  }
}

/** Anonymous GET on the tracking route (random UUID): 401 JSON, Cache-Control private, no-store. */
export async function checkAnonymous(fetchFn, baseUrl, timeoutMs = 30000) {
  const response = await fetchFn(`${baseUrl}${trackingPath(randomUUID())}`, { method: "GET", redirect: "manual", credentials: "omit", headers: { Accept: "application/json" }, signal: withTimeout(timeoutMs) });
  const cache = response.headers.get("cache-control") || "";
  const type = response.headers.get("content-type") || "";
  let body = null;
  try {
    body = await response.json();
  } catch {}
  const problems = [];
  if (response.status !== 401) problems.push(`status ${response.status} (expected 401)`);
  if (!/application\/json/i.test(type) || !body || typeof body.error !== "string") problems.push("body is not a JSON error");
  if (!/no-store/i.test(cache) || !/private/i.test(cache)) problems.push(`Cache-Control "${cache}" (expected private, no-store)`);
  if (problems.length) throw new PreflightError(`anonymous tracking probe: ${problems.join("; ")} — route absent or not protected`);
  return { status: 401, cache_control: cache };
}

/** Service HEAD on intervention_tracking (migration 019): a missing table refuses the run. */
export async function checkTrackingTable(db) {
  try {
    const n = await db.count("intervention_tracking", { intervention_id: `eq.${randomUUID()}` });
    if (n !== 0) throw new PreflightError("intervention_tracking HEAD returned rows for a random id");
    return { table: "intervention_tracking", present: true };
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError(`intervention_tracking not reachable with the service key (${String(error?.message || error).slice(0, 160)}): migration 019 not applied?`);
  }
}

/** Authenticated GET on an unknown UUID must be 404 (RLS/visibility proof), JSON, no-store. */
export function assertUnknownIs404(answer) {
  if (answer?.status !== 404) throw new PreflightError(`authenticated GET on an unknown dossier answered ${answer?.status} (expected 404)`);
  if (!/no-store/i.test(answer.cache || "")) throw new PreflightError("authenticated 404 without Cache-Control no-store");
  return { status: 404 };
}
