// Observation of the tracking requests the BROWSER sends (contract A1/A4/A5): only the action,
// session id, seq and status are kept — never the coordinates of a point. Also proves that no
// tracking URL carries a query string (coordinates must never travel in a URL).
const TRACKING_PATH = /^\/api\/interventions\/([0-9a-f-]{36})\/tracking(\/route|\/geocode)?$/i;

export function parseTrackingUrl(rawUrl) {
  const u = new URL(rawUrl);
  const m = TRACKING_PATH.exec(u.pathname);
  if (!m) return null;
  return { interventionId: m[1].toLowerCase(), kind: m[2] ? m[2].slice(1) : "tracking", hasQuery: u.search.length > 0, origin: u.origin, path: u.pathname };
}

/** Summary of one tracking request; `postData` is the raw JSON body (or null). */
export function summarizeTrackingRequest(method, rawUrl, postData) {
  const parsed = parseTrackingUrl(rawUrl);
  if (!parsed) return null;
  const entry = { method: String(method).toUpperCase(), kind: parsed.kind, interventionId: parsed.interventionId, hasQuery: parsed.hasQuery, action: null, session_id: null, seq: null, expected_version: null, status: null };
  if (entry.method === "POST" && parsed.kind === "tracking" && typeof postData === "string") {
    try {
      const body = JSON.parse(postData);
      if (body && typeof body === "object") {
        entry.action = typeof body.action === "string" ? body.action : null;
        entry.expected_version = Number.isInteger(body.expected_version) ? body.expected_version : null;
        const p = body.payload && typeof body.payload === "object" ? body.payload : {};
        entry.session_id = typeof p.session_id === "string" ? p.session_id : null;
        entry.seq = Number.isInteger(p.seq) ? p.seq : null;
      }
    } catch {
      entry.action = "unparseable";
    }
  }
  return entry;
}

/** Attaches a recorder to a Playwright page; returns the live list (no coordinates stored). */
export function recordTrackingRequests(page) {
  const list = [];
  page.on("request", (request) => {
    try {
      if (request.headers()["x-qa-harness"] === "1") return; // harness-issued: tracked by createTrackingApi
      const entry = summarizeTrackingRequest(request.method(), request.url(), request.postData());
      if (entry) list.push({ ...entry, at: Date.now(), _request: request });
    } catch {}
  });
  page.on("response", (response) => {
    try {
      const item = list.find((e) => e._request === response.request());
      if (item) item.status = response.status();
    } catch {}
  });
  page.on("requestfailed", (request) => {
    try {
      const item = list.find((e) => e._request === request);
      if (item) item.status = 0;
    } catch {}
  });
  return list;
}

export const publicView = (list) => list.map(({ _request, ...rest }) => rest);
export const actions = (list, action) => list.filter((e) => e.method === "POST" && e.kind === "tracking" && e.action === action);
export const queryViolations = (list) => list.filter((e) => e.hasQuery);

/**
 * A4/A5: after a reload with shared=true, the only acceptable sequence is
 * stop(S1) → start(S2 ≠ S1) → point… ; returns a list of violations (empty = OK).
 */
export function restartViolations(list, oldSessionId) {
  const posts = list.filter((e) => e.method === "POST" && e.kind === "tracking");
  const v = [];
  const firstStop = posts.findIndex((e) => e.action === "stop");
  const firstStart = posts.findIndex((e) => e.action === "start");
  if (firstStart >= 0 && (firstStop < 0 || firstStop > firstStart)) v.push("start sent before stop of the interrupted session");
  if (firstStop >= 0 && posts[firstStop].session_id !== oldSessionId) v.push("stop did not target the session read from the snapshot");
  if (posts.filter((e) => e.action === "stop").length > 1) v.push("stop repeated automatically");
  const starts = posts.filter((e) => e.action === "start");
  if (starts.length > 1) v.push("start repeated automatically");
  if (starts.some((e) => e.session_id === oldSessionId)) v.push("start reused the interrupted session id");
  if (starts.some((e) => e.status === 409)) v.push("a start was answered 409 (lone start)");
  const firstPoint = posts.findIndex((e) => e.action === "point");
  if (firstPoint >= 0 && (firstStart < 0 || firstPoint < firstStart)) v.push("point sent before the new start");
  return v;
}
