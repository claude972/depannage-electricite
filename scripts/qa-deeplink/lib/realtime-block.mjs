// Realtime interception (contract A1/A2/A3/A3b). Installed on the session's CONTEXT before login. The
// handler sees every WebSocket of the context: the exact Realtime path on the run's Supabase origin is
// CLOSED (awaited) with a constant code and NEVER connected to the server; any other socket is left
// alone (connectToServer). Only scalars are recorded: time, origin, path — never the query (apikey,
// vsn), a header, a token or a message. The proof is HANDLER-SIDE; a page-side close code is never
// asserted (A3b): code 4000 is proven only by the native local client of the control test.
import { REALTIME_PATH, REALTIME_CLOSE } from "./constants.mjs";

/** wss ⇔ https, ws ⇔ http, lowercase host, default port removed. Null when not a URL. */
export function normaliseOrigin(raw) {
  try {
    const u = new URL(raw);
    const scheme = { "wss:": "https:", "ws:": "http:", "https:": "https:", "http:": "http:" }[u.protocol];
    if (!scheme) return null;
    const port = u.port && !((scheme === "https:" && u.port === "443") || (scheme === "http:" && u.port === "80")) ? `:${u.port}` : "";
    return `${scheme}//${u.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}

export function isRealtimeSocket(rawUrl, supabaseOrigin) {
  try {
    const u = new URL(rawUrl);
    return u.pathname === REALTIME_PATH && normaliseOrigin(rawUrl) === normaliseOrigin(supabaseOrigin);
  } catch {
    return false;
  }
}

export function createRealtimeBlock({ supabaseOrigin, now = Date.now, close = REALTIME_CLOSE } = {}) {
  if (!normaliseOrigin(supabaseOrigin)) throw new Error("realtime block needs the Supabase origin");
  const stats = { hits: 0, close_resolved: 0, connect_calls_realtime: 0, handler_errors: 0, other_sockets: 0, records: [] };
  async function handler(ws) {
    try {
      const url = ws.url();
      if (!isRealtimeSocket(url, supabaseOrigin)) {
        stats.other_sockets++;
        ws.connectToServer();
        return;
      }
      stats.hits++;
      const u = new URL(url);
      const record = { at: new Date(now()).toISOString(), origin: normaliseOrigin(url), path: u.pathname, closed: false };
      if (stats.records.length < 50) stats.records.push(record);
      await ws.close({ code: close.code, reason: close.reason });
      stats.close_resolved++;
      record.closed = true;
    } catch {
      stats.handler_errors++;
    }
  }
  return {
    handler,
    stats: () => ({ ...stats, records: stats.records.map((r) => ({ ...r })) }),
    /** Exactly the A3/A3b proof; page-side frames only when the page exposed the socket. */
    proof({ pageRealtimeFrames = 0 } = {}) {
      const s = this.stats();
      const reasons = [];
      if (s.hits < 1) reasons.push(`handler called ${s.hits} times for the Realtime path`);
      if (s.close_resolved !== s.hits) reasons.push(`close resolved ${s.close_resolved}/${s.hits}`);
      if (s.connect_calls_realtime !== 0) reasons.push("connectToServer called on the Realtime path");
      if (s.handler_errors) reasons.push(`${s.handler_errors} handler error(s)`);
      if (pageRealtimeFrames) reasons.push(`${pageRealtimeFrames} Realtime frame(s) observed`);
      return { ok: reasons.length === 0, reason: reasons.join("; "), hits: s.hits, close_resolved: s.close_resolved, other_sockets: s.other_sockets };
    },
  };
}

/** Installs the handler for EVERY socket of the context (the handler filters); awaited before login. */
export async function installRealtimeBlock(context, block) {
  await context.routeWebSocket(() => true, block.handler);
  return block;
}
