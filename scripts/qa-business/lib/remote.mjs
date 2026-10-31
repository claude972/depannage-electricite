// Remote-mode preflight (contract §19). Attribution of a remote run = root's deployment receipt +
// the unique Flight build id of the public page, both verified by the Codex helper
// scripts/qa/lib/deployment-proof.mjs (imported READ-ONLY). The local .next/BUILD_ID is never used.
// Runs before any fixture, intent, write or browser; a refusal yields only a short code.
import * as helper from "../../qa/lib/deployment-proof.mjs";

export const REMOTE_FLAGS = ["deploymentReceipt", "vercelProject", "vercelTeam", "vercelDeployment", "githubRepoId", "expectedBuildId"];
export const REF = "integration/web-pwa";

/** The 8 expected fields, EXCLUSIVELY from root's explicit CLI configuration (never page/receipt). */
export function buildExpected(options) {
  const repoId = /^[1-9][0-9]{0,15}$/.test(String(options.githubRepoId ?? "")) ? Number(options.githubRepoId) : NaN;
  return {
    origin: new URL(options.baseUrl).origin,
    projectId: options.vercelProject,
    teamId: options.vercelTeam,
    deploymentId: options.vercelDeployment,
    repoId,
    ref: REF,
    sha: options.sha,
    servedBuildId: options.expectedBuildId,
  };
}

/** Raw HTML of `GET <origin>/`: no query, no redirect followed, bounded time and size. */
export async function fetchPublicHtml(origin, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${origin}/`, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (response.status !== 200) {
    const error = new Error(`public page answered ${response.status}`);
    error.code = "FETCH_STATUS";
    throw error;
  }
  return response.text();
}

/**
 * Ordered remote preflight: load receipt → fetch page → verify. Every dependency is injectable for
 * tests; defaults are the Codex helper and fetchPublicHtml. Returns {ok:true, proof} (short frozen
 * proof) or {ok:false, code, stage}; never the receipt or page content.
 */
export async function remotePreflight({ options, nowMs = Date.now(), load = helper.loadDeploymentProof, fetchHtml = fetchPublicHtml, verify = helper.verifyRemoteDeployment, timeoutMs }) {
  const expected = buildExpected(options);
  let proof;
  try {
    proof = await load({ receiptPath: options.deploymentReceipt, expected, nowMs });
  } catch (error) {
    return { ok: false, stage: "receipt", code: String(error?.code || "RECEIPT") };
  }
  let html;
  try {
    html = await fetchHtml(expected.origin, { timeoutMs });
  } catch (error) {
    return { ok: false, stage: "fetch", code: String(error?.code === "FETCH_STATUS" ? "FETCH_STATUS" : "FETCH") };
  }
  try {
    return { ok: true, proof: verify({ proof, html, expected, nowMs }) };
  } catch (error) {
    return { ok: false, stage: "verify", code: String(error?.code || "VERIFY") };
  }
}
