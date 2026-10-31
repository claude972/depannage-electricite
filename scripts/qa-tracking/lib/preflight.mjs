// Preflight checks (contract §2 + A5.1). Order: build id → anonymous 401 → table HEAD (service)
// — all BEFORE any fixture; the authenticated unknown-UUID 404 runs after the first technical
// account (announced by a durable intent before its creation). Each function takes injected
// transports so it is unit-tested offline.
import { randomUUID } from "node:crypto";
import { PreflightError } from "../../qa/lib/config.mjs";
import { trackingPath } from "./constants.mjs";

const withTimeout = (ms) => AbortSignal.timeout(ms);

/** The deployed page must reference the expected Next build id (static asset path or inline id). */
export async function checkBuildId(fetchFn, baseUrl, buildId, timeoutMs = 30000) {
  if (!buildId) throw new PreflightError("--build-id is required: the served BUILD_ID must be checked before any write");
  const response = await fetchFn(`${baseUrl}/`, { method: "GET", redirect: "manual", signal: withTimeout(timeoutMs) });
  const html = await response.text();
  if (response.status !== 200) throw new PreflightError(`GET / answered ${response.status}; cannot verify BUILD_ID`);
  const found = html.includes(`/_next/static/${buildId}/`) || html.includes(`"${buildId}"`);
  if (!found) throw new PreflightError(`the served page does not reference BUILD_ID ${buildId}; refusing to test another build`);
  return { build_id: buildId, verified: true };
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
