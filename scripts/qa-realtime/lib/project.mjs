// Volatile projections (contract §3 « jeton effectivement transmis », §3 bis « époques »). Frames and
// tokens are decoded IN MEMORY only; every function returns scalars / booleans from allowlists. No
// frame, JWT, claim, payload, header or cookie is ever returned or stored.
import { SYSTEM_WHITELIST, PUBLIC_TABLES, EVENTS } from "./constants.mjs";

/** Phoenix frame (vsn 2.0.0 array, or 1.0.0 object) ⇒ {topic, event, ref, join_ref, payload} | null. */
export function decodeFrame(message) {
  if (typeof message !== "string") return null; // binary broadcast frames are not used by this probe
  let raw;
  try {
    raw = JSON.parse(message);
  } catch {
    return null;
  }
  if (Array.isArray(raw) && raw.length === 5) {
    const [join_ref, ref, topic, event, payload] = raw;
    return typeof topic === "string" && typeof event === "string" ? { join_ref, ref, topic, event, payload } : null;
  }
  if (raw && typeof raw === "object" && typeof raw.topic === "string" && typeof raw.event === "string") return { join_ref: raw.join_ref ?? null, ref: raw.ref ?? null, topic: raw.topic, event: raw.event, payload: raw.payload };
  return null;
}

/**
 * JWT ⇒ booleans + a role class only; the token and its claims never leave this function.
 * `role_class`: "authenticated" | "anon" (explicit claim) | "unknown" (malformed token: not three
 * base64url parts, undecodable payload, non-object JSON, or no / other `role` claim). Only an ABSENT
 * token or an explicit "anon" may support « H2 observed »; "unknown" never does.
 */
export function projectToken(token, expectedSub) {
  if (typeof token !== "string" || !token) return { present: false, role_authenticated: false, sub_matches: false, role_class: "absent" };
  let claims = null;
  const parts = token.split(".");
  if (parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) {
    try {
      const decoded = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) claims = decoded;
    } catch {
      claims = null;
    }
  }
  const role_class = claims?.role === "authenticated" ? "authenticated" : claims?.role === "anon" ? "anon" : "unknown";
  return { present: true, role_authenticated: role_class === "authenticated", sub_matches: Boolean(claims) && typeof expectedSub === "string" && claims.sub === expectedSub, role_class };
}

export function whitelistText(text) {
  if (typeof text !== "string" || !text) return null;
  const hit = SYSTEM_WHITELIST.find((w) => text.includes(w));
  return hit || "other";
}

const publicTable = (t) => (PUBLIC_TABLES.includes(t) ? t : "other");
const publicEvent = (e) => (EVENTS.includes(e) ? e : "other");

/**
 * Per-measurement projector bound to ONE channel topic (`realtime:<name>`). Frames for any other
 * topic are ignored (binding to the measurement). Epoch 0 = join, +1 per `access_token` push.
 */
export function createProjector({ topic, clientTables, expectedSub, now = Date.now }) {
  const t0 = now();
  const rel = () => now() - t0;
  const st = { join_seen: false, join_ref: null, epochs: [], reply: null, system: [], foreign_frames: 0 };
  return {
    client(message) {
      const f = decodeFrame(message);
      if (!f) return;
      if (f.topic !== topic) {
        if (f.topic !== "phoenix") st.foreign_frames++;
        return;
      }
      if (f.event === "phx_join") {
        st.join_seen = true;
        st.join_ref = f.ref ?? f.join_ref ?? null;
        const p = projectToken(f.payload?.access_token, expectedSub);
        st.epochs.push({ epoch: 0, t_ms: rel(), ...p });
      } else if (f.event === "access_token") {
        const p = projectToken(f.payload?.access_token, expectedSub);
        st.epochs.push({ epoch: st.epochs.length, t_ms: rel(), ...p });
      }
    },
    server(message) {
      const f = decodeFrame(message);
      if (!f || f.topic !== topic) return;
      if (f.event === "phx_reply" && st.join_ref !== null && f.ref === st.join_ref && !st.reply) {
        const pc = f.payload?.response?.postgres_changes;
        const positions = Array.isArray(pc)
          ? pc.map((b, i) => ({ table: publicTable(b?.table), event: publicEvent(b?.event), match: b?.table === clientTables[i] && b?.event === "*" && b?.schema === "public" && (b?.filter ?? null) === null }))
          : [];
        st.reply = { t_ms: rel(), status: f.payload?.status === "ok" ? "ok" : f.payload?.status === "error" ? "error" : "other", has_postgres_changes: Array.isArray(pc), server_bindings_count: Array.isArray(pc) ? pc.length : 0, positions, all_match: Array.isArray(pc) && pc.length === clientTables.length && positions.every((p) => p.match) };
      } else if (f.event === "system") {
        if (st.system.length < 20) st.system.push({ t_ms: rel(), status: f.payload?.status === "ok" ? "ok" : f.payload?.status === "error" ? "error" : "other", message: whitelistText(f.payload?.message) });
      }
    },
    snapshot: () => JSON.parse(JSON.stringify(st)),
  };
}

/**
 * Auth verdict for one measurement over [join, end of window]: « proven » only if the proxy captured
 * the join AND every token change the SDK reported has its captured access_token epoch AND every
 * epoch is present + authenticated + expected sub. « observed_false » when captured epochs show a
 * missing/unauthenticated token. Anything else is « unknown » (never converted to false ⇒ H2).
 */
export function authVerdict({ proxyInvoked, snapshot, sdkTokenChanges = 0 }) {
  if (!proxyInvoked || !snapshot?.join_seen || !snapshot.epochs.length) return { verdict: "unknown", reason: "join token capture not demonstrated" };
  if (snapshot.epochs.length - 1 < sdkTokenChanges) return { verdict: "unknown", reason: "token change not observed on the channel" };
  // Only an ABSENT token or an EXPLICIT anon role is a negative observation; a malformed token or a
  // missing / other role claim is UNKNOWN (never a false « H2 observed »).
  const negative = snapshot.epochs.find((e) => !e.present || e.role_class === "absent" || e.role_class === "anon");
  if (negative) return { verdict: "observed_false", reason: `epoch ${negative.epoch}: ${negative.present ? "explicit anon role" : "no token"}` };
  if (snapshot.epochs.some((e) => e.role_class !== "authenticated")) return { verdict: "unknown", reason: "token role not decodable (malformed or no role claim)" };
  if (snapshot.epochs.some((e) => !e.sub_matches)) return { verdict: "unknown", reason: "sub does not match the QA identity" };
  return { verdict: "proven", reason: "" };
}
