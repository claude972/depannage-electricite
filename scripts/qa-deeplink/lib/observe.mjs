// Passive per-page observer (contract §2, A2/A3/A3b). It NEVER issues a request. Recorded per request:
// method, path (no query), kind, status, start/end times (ms), source (ui | harness tag). Never headers,
// tokens or bodies. Two boolean-only exceptions on the page's own GET /api/workspace 200 replies: is a
// watched dossier id present (D2 witness) and is a canary present (D3 leak) — the body is not kept.
// Realtime sockets exposed to the page (optional, A3b): count and frame count only.
import { REALTIME_PATH, WORKSPACE_PATH } from "./constants.mjs";

export function classifyPath(pathname) {
  if (pathname === WORKSPACE_PATH) return "workspace";
  if (/^\/api\/interventions\/[^/]+(\/|$)/.test(pathname)) return "intervention";
  if (pathname.startsWith("/auth/v1/")) return "auth";
  return null;
}

/** Scalar auth markers only: a logout, or a password grant (query value whitelisted, never kept raw). */
export function authMarker(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.pathname === "/auth/v1/logout") return "logout";
    if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") return "password_grant";
  } catch {}
  return null;
}

export function observeDeeplinkNetwork(page, { now = Date.now, watch = () => new Map(), canaries = () => [], limit = 400 } = {}) {
  const list = [];
  const byRequest = new WeakMap();
  const sockets = { realtime: 0, frames: 0, closed: 0 };
  if (typeof page?.on !== "function") return emptyObserver();
  page.on("request", (request) => {
    try {
      const u = new URL(request.url());
      const kind = classifyPath(u.pathname);
      if (!kind) return;
      const entry = { method: request.method().toUpperCase(), path: u.pathname, kind, status: null, startedAt: now(), endedAt: null, source: request.headers()["x-qa-harness"] === "1" ? "harness" : "ui", auth: kind === "auth" ? authMarker(request.url()) : null, ids: {}, canary: false };
      list.push(entry);
      byRequest.set(request, entry);
      while (list.length > limit) list.shift();
    } catch {}
  });
  page.on("response", (response) => {
    try {
      const entry = byRequest.get(response.request());
      if (!entry) return;
      entry.status = response.status();
      const done = () => {
        if (entry.endedAt === null) entry.endedAt = now();
      };
      if (entry.kind === "workspace" && entry.method === "GET" && entry.status === 200) {
        response.text().then((text) => {
          for (const [label, id] of watch()) entry.ids[label] = typeof text === "string" && text.includes(id);
          entry.canary = canaries().some((c) => typeof text === "string" && text.includes(c));
          done();
        }, done);
      } else response.finished().then(done, done);
    } catch {}
  });
  page.on("requestfailed", (request) => {
    const entry = byRequest.get(request);
    if (entry) {
      entry.status = entry.status ?? 0;
      entry.endedAt = entry.endedAt ?? now();
    }
  });
  page.on("websocket", (ws) => {
    try {
      if (new URL(ws.url()).pathname !== REALTIME_PATH) return;
      sockets.realtime++;
      ws.on("framereceived", () => sockets.frames++);
      ws.on("framesent", () => sockets.frames++);
      ws.on("close", () => sockets.closed++);
    } catch {}
  });
  const workspace = () => list.filter((e) => e.kind === "workspace" && e.method === "GET");
  return {
    summary: () => list.map(({ ids, canary, ...e }) => ({ ...e, startedAt: new Date(e.startedAt).toISOString(), endedAt: e.endedAt === null ? null : new Date(e.endedAt).toISOString() })),
    workspaceGets: ({ from = 0, to = Infinity, source = "ui" } = {}) => workspace().filter((e) => e.startedAt >= from && e.startedAt <= to && (source === null || e.source === source)),
    inFlightWorkspace: () => workspace().filter((e) => e.endedAt === null),
    lastWorkspaceActivity: () => workspace().reduce((max, e) => Math.max(max, e.startedAt, e.endedAt ?? 0), 0),
    witnessSeen: (label, { after = 0 } = {}) => workspace().some((e) => e.status === 200 && e.endedAt !== null && e.endedAt >= after && e.ids[label] === true),
    canarySeen: () => list.some((e) => e.canary),
    interventionEntries: (id) => list.filter((e) => e.kind === "intervention" && e.path.includes(id)).map(({ ids, canary, ...e }) => e),
    authEvents: ({ from = 0, to = Infinity } = {}) => list.filter((e) => e.auth && e.startedAt >= from && e.startedAt <= to).map((e) => e.auth),
    pageRealtimeFrames: () => sockets.frames,
    pageRealtimeSockets: () => ({ ...sockets }),
  };
}

function emptyObserver() {
  return { summary: () => [], workspaceGets: () => [], inFlightWorkspace: () => [], lastWorkspaceActivity: () => 0, witnessSeen: () => false, canarySeen: () => false, interventionEntries: () => [], authEvents: () => [], pageRealtimeFrames: () => 0, pageRealtimeSockets: () => ({ realtime: 0, frames: 0, closed: 0 }) };
}
