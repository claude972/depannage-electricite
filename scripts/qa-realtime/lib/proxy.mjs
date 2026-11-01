// Realtime socket proxy (claim §5): Playwright routeWebSocket on the QA context. ONLY the Realtime
// path on the run's Supabase origin is proxied (connectToServer + explicit forwarding both ways); each
// frame is handed IN MEMORY to the current measurement's projector, then forwarded unchanged. Nothing
// is stored here. Any other socket is passed through untouched.
import { REALTIME_PATH } from "./constants.mjs";

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
const validCode = (c) => Number.isInteger(c) && (c === 1000 || (c >= 3000 && c <= 4999));

export async function installRealtimeProxy(context, { supabaseOrigin }) {
  const origin = normaliseOrigin(supabaseOrigin);
  if (!origin) throw new Error("realtime proxy needs the Supabase origin");
  const st = { invoked: 0, other: 0, errors: 0, current: null };
  await context.routeWebSocket(() => true, (ws) => {
    try {
      const u = new URL(ws.url());
      if (u.pathname !== REALTIME_PATH || normaliseOrigin(ws.url()) !== origin) {
        st.other++;
        ws.connectToServer();
        return;
      }
      st.invoked++;
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        try {
          st.current?.client(m);
        } catch {
          st.errors++;
        }
        server.send(m);
      });
      server.onMessage((m) => {
        try {
          st.current?.server(m);
        } catch {
          st.errors++;
        }
        ws.send(m);
      });
      ws.onClose((code, reason) => server.close(validCode(code) ? { code, reason } : undefined).catch?.(() => {}));
      server.onClose((code, reason) => ws.close(validCode(code) ? { code, reason } : undefined).catch?.(() => {}));
    } catch {
      st.errors++;
    }
  });
  return {
    attach: (projector) => (st.current = projector),
    detach: () => (st.current = null),
    stats: () => ({ invoked: st.invoked, other: st.other, errors: st.errors }),
  };
}
