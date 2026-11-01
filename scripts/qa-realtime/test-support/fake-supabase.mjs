// Test support only (never used by run.mjs): a LOCAL fake Supabase for the Realtime probe tests.
// HTTP: /auth/v1/health, /auth/v1/token (password + refresh_token grants, CORS). WebSocket:
// /realtime/v1/websocket speaking the Phoenix vsn 2.0.0 array protocol used by realtime-js 2.118
// (heartbeat, phx_join with postgres_changes config, access_token, phx_leave, system, postgres_changes).
// Fake tokens only (unsigned JWT-shaped strings). Modes:
//   ok           — join ok, server bindings mirror the client's
//   mismatch     — `payments` is not published: the server returns only the published bindings
//   systemError  — join ok, then a system error for channels binding `payments`
//   anonToken    — the login returns a token whose role is "anon"
//   noEvents     — inserts are never delivered
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const fakeJwt = (claims) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u(claims)}.c2lnbmF0dXJl`;
const PUBLISHED = ["interventions", "quotes", "messages"];

function encode(text) {
  const data = Buffer.from(text);
  const header = data.length < 126 ? Buffer.from([0x81, data.length]) : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255]) : Buffer.concat([Buffer.from([0x81, 127]), Buffer.alloc(4), Buffer.from([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255])]);
  return Buffer.concat([header, data]);
}
function makeParser(onText, onClose) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const masked = buf[1] & 128;
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskOff + (i % 4)];
      buf = buf.subarray(off + len);
      if (op === 1) onText(payload.toString("utf8"));
      else if (op === 8) onClose();
    }
  };
}

export function startFakeSupabase({ mode = "ok", tokenTtlS = 3600 } = {}) {
  const users = new Map(); // email → { id, password }
  const sockets = new Set();
  const stats = { joins: 0, accessTokens: 0, leaves: 0, delivered: 0, upgrades: 0 };
  let tokenSeq = 0;
  const token = (user) => fakeJwt({ sub: user.id, role: mode === "anonToken" ? "anon" : "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + tokenTtlS, seq: ++tokenSeq });
  const session = (user) => ({ access_token: token(user), token_type: "bearer", expires_in: tokenTtlS, expires_at: Math.floor(Date.now() / 1000) + tokenTtlS, refresh_token: `refresh-${randomUUID()}`, user: { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
  const refreshTokens = new Map();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status, body) => res.writeHead(status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));
      if (u.pathname === "/auth/v1/health") return send(200, { name: "GoTrue" });
      if (u.pathname === "/auth/v1/token") {
        const body = raw ? JSON.parse(raw) : {};
        if (u.searchParams.get("grant_type") === "password") {
          const user = users.get(body.email);
          if (!user || user.password !== body.password) return send(400, { error: "invalid_grant" });
          const s = session(user);
          refreshTokens.set(s.refresh_token, user);
          return send(200, s);
        }
        if (u.searchParams.get("grant_type") === "refresh_token") {
          const user = refreshTokens.get(body.refresh_token);
          if (!user) return send(400, { error: "invalid_grant" });
          const s = session(user);
          refreshTokens.set(s.refresh_token, user);
          return send(200, s);
        }
      }
      send(404, {});
    });
  });
  server.on("upgrade", (req, socket) => {
    if (new URL(req.url, "http://x").pathname !== "/realtime/v1/websocket") return socket.destroy();
    stats.upgrades++;
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = { socket, channels: new Map() }; // topic → { joinRef, bindings: [{id, table}] }
    sockets.add(conn);
    const push = (arr) => socket.write(encode(JSON.stringify(arr)));
    const parse = makeParser((text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      const [joinRef, ref, topic, event, payload] = msg;
      if (topic === "phoenix" && event === "heartbeat") return push([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]);
      if (event === "phx_join") {
        stats.joins++;
        const wanted = payload?.config?.postgres_changes || [];
        const served = (mode === "mismatch" ? wanted.filter((b) => PUBLISHED.includes(b.table)) : wanted).map((b, i) => ({ id: 1000 + i, event: b.event, schema: b.schema, table: b.table, ...(b.filter ? { filter: b.filter } : {}) }));
        conn.channels.set(topic, { joinRef, bindings: served, failed: mode === "systemError" && wanted.some((b) => b.table === "payments") });
        push([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: served } }]);
        if (mode === "systemError" && wanted.some((b) => b.table === "payments"))
          setTimeout(() => push([null, null, topic, "system", { status: "error", message: "Unable to subscribe to changes with given parameters. Please check Realtime is enabled for the given connect parameters: [schema: public, table: payments]", extension: "postgres_changes", channel: topic.slice(9) }]), 50);
        else if (served.length) setTimeout(() => push([null, null, topic, "system", { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes", channel: topic.slice(9) }]), 50);
        return;
      }
      if (event === "access_token") {
        stats.accessTokens++;
        return push([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      }
      if (event === "phx_leave") {
        stats.leaves++;
        conn.channels.delete(topic);
        return push([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      }
    }, () => socket.end());
    socket.on("data", parse);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(conn));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        stats,
        addUser: (email, password, id = randomUUID()) => (users.set(email, { id, password, email }), id),
        /** Simulates the INSERT: delivered to every channel binding `interventions` (unless noEvents). */
        insert(id, clientId) {
          if (mode === "noEvents") return;
          for (const conn of sockets)
            for (const [topic, ch] of conn.channels) {
              const b = ch.bindings.find((x) => x.table === "interventions");
              if (!b || ch.failed) continue; // a subscription the server reported as failed delivers nothing
              stats.delivered++;
              conn.socket.write(encode(JSON.stringify([null, null, topic, "postgres_changes", { ids: [b.id], data: { schema: "public", table: "interventions", commit_timestamp: new Date().toISOString(), type: "INSERT", columns: [{ name: "id", type: "uuid" }, { name: "client_id", type: "uuid" }], record: { id, client_id: clientId }, errors: null } }])));
            }
        },
        close: () => {
          for (const c of sockets) c.socket.destroy();
          server.close();
        },
      }),
    ),
  );
}
