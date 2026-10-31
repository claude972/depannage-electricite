// Classification of the REAL provider calls (contract §4, A3): one nominal route and, with
// --provider-proof, one public geocoding. No burst, no automatic retry, no mock. A structured
// 503/429 is "unavailable" (recorded, not a pass, not an app failure); anything else malformed
// is a FAIL. Pure: takes the HTTP status, headers object and parsed JSON body.
import { ROUTE_REASONS } from "./constants.mjs";

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const iso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));

export function classifyRoute({ status, body, retryAfter = null }, snapshot) {
  if (status === 503) {
    const reason = body?.reason;
    if (!ROUTE_REASONS.includes(reason)) return { verdict: "fail", why: `503 without a documented reason (${String(reason)})` };
    if (body && ("duration_s" in body || "distance_m" in body || "geometry" in body)) return { verdict: "fail", why: "503 carries ETA figures or geometry" };
    if (reason === "provider_quota" && !(Number.isInteger(body.retry_after_s) && body.retry_after_s >= 1 && body.retry_after_s <= 60)) return { verdict: "fail", why: "provider_quota without a bounded retry_after_s" };
    return { verdict: "unavailable", reason };
  }
  if (status === 429) {
    if (body?.reason !== "application_quota") return { verdict: "fail", why: `429 with reason ${String(body?.reason)}` };
    if (!retryAfter) return { verdict: "fail", why: "429 without Retry-After" };
    return { verdict: "unavailable", reason: "application_quota" };
  }
  if (status !== 200) return { verdict: "fail", why: `unexpected status ${status}` };
  const b = body || {};
  const problems = [];
  if (b.state !== "available") problems.push("state");
  if (b.source !== "IGN Géoplateforme / BD TOPO") problems.push("source");
  if (b.resource !== "bdtopo-valhalla") problems.push("resource");
  if (b.traffic !== "not_available") problems.push("traffic");
  if (!(finite(b.distance_m) && b.distance_m > 0 && b.distance_m <= 1000000)) problems.push("distance_m");
  if (!(finite(b.duration_s) && b.duration_s > 0 && b.duration_s <= 86400)) problems.push("duration_s");
  if (!iso(b.calculated_at)) problems.push("calculated_at");
  if (!iso(b.position_sampled_at)) problems.push("position_sampled_at");
  if (typeof b.attribution !== "string" || !b.attribution.length) problems.push("attribution");
  const coords = b.geometry?.coordinates;
  if (b.geometry?.type !== "LineString" || !Array.isArray(coords) || coords.length < 2 || coords.length > 10000 || !coords.every((c) => Array.isArray(c) && c.length === 2 && c.every(finite))) problems.push("geometry");
  for (const key of ["snapped_start", "snapped_end"]) if (!(Array.isArray(b[key]) && b[key].length === 2 && b[key].every(finite))) problems.push(key);
  const t = snapshot?.tracking;
  if (t) {
    if (b.session_id !== t.session_id) problems.push("session_id ≠ snapshot");
    if (b.control_version !== t.control_version) problems.push("control_version ≠ snapshot");
    if (b.point_seq !== t.last_seq) problems.push("point_seq ≠ snapshot");
    if (b.destination_version !== t.destination_version) problems.push("destination_version ≠ snapshot");
  }
  return problems.length ? { verdict: "fail", why: `route answer invalid: ${problems.join(", ")}` } : { verdict: "available", evidence: { distance_bucket_km: Math.round(b.distance_m / 1000), duration_min: Math.round(b.duration_s / 60), points: coords.length, resource_version_present: typeof b.resource_version === "string" } };
}

export function classifyGeocode({ status, body }) {
  if (status === 503) return ROUTE_REASONS.includes(body?.reason) ? { verdict: "unavailable", reason: body.reason } : { verdict: "fail", why: "503 without a documented reason" };
  if (status === 429) return body?.reason === "application_quota" ? { verdict: "unavailable", reason: "application_quota" } : { verdict: "fail", why: "429 with an undocumented reason" };
  if (status !== 200) return { verdict: "fail", why: `unexpected status ${status}` };
  const c = body?.candidates;
  if (body?.source !== "IGN / BAN" || !Array.isArray(c) || c.length > 5) return { verdict: "fail", why: "geocode envelope invalid" };
  const bad = c.filter((x) => !(finite(x.latitude) && finite(x.longitude) && typeof x.label === "string" && x.label.length && finite(x.score) && x.score >= 0 && x.score <= 1 && typeof x.type === "string"));
  return bad.length ? { verdict: "fail", why: `${bad.length} invalid candidate(s)` } : { verdict: "available", evidence: { candidates: c.length } };
}
