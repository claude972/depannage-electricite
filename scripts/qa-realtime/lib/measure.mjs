// One measurement (contract §3, §3 bis): join → final status → (join confirmed only) durable insert
// intent → exactly ONE INSERT → readback count 1 + client_id → listen ≤ windowMs for THIS id → close
// and drain in finally. A refused join (CHANNEL_ERROR / TIMED_OUT) is recorded WITHOUT any INSERT.
// The stop gate is checked before each step and after every await (act); a stop propagates.
import { act, gatedWait } from "../../qa-tracking/lib/guard.mjs";
import { createProjector, authVerdict, whitelistText } from "./project.mjs";
import { JOIN_TIMEOUT_MS, WINDOW_MS } from "./constants.mjs";

const isStop = (e) => e?.name === "StopRequestedError";

export async function runMeasurement({ spec, uid, user, page, proxy, tf, gate, now = Date.now, joinTimeoutMs = JOIN_TIMEOUT_MS, windowMs = WINDOW_MS }) {
  const channel = spec.channel(uid);
  const projector = createProjector({ topic: `realtime:${channel}`, clientTables: spec.tables, expectedSub: uid, now });
  const result = { name: spec.name, tables: [...spec.tables], wait: spec.wait, statuses: [], error_message: null, join: null, system: [], auth: null, insert: { performed: false, readback_ok: null }, event_received_within_window: null, window_ms: windowMs, verdict: null };
  proxy.attach(projector);
  let sdkTokenChanges = 0;
  try {
    const sub = await act(gate, () => page.evaluate(([s, t]) => window.__rt.subscribe(s, t), [{ channel, tables: spec.tables, wait: spec.wait }, joinTimeoutMs]));
    result.statuses = sub.statuses.map((s) => ({ status: ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s.status) ? s.status : "other", t_ms: s.t_ms }));
    result.error_message = whitelistText(sub.error);
    // Decisive join outcome: an error/timeout anywhere wins over a trailing CLOSED.
    const final = result.statuses.find((s) => s.status === "CHANNEL_ERROR" || s.status === "TIMED_OUT")?.status ?? result.statuses.at(-1)?.status;
    result.join_outcome = final ?? "none";
    if (final !== "SUBSCRIBED") {
      result.verdict = final === "CHANNEL_ERROR" || final === "TIMED_OUT" ? "join_refused" : "join_not_confirmed";
      return result; // no INSERT for a refused / unconfirmed join
    }
    gate.check();
    let job;
    try {
      job = await act(gate, () => tf.createIntervention({ client: user, status: "requested", description: `realtime probe ${spec.name}` }));
      result.insert.performed = true;
    } catch (error) {
      if (isStop(error)) throw error;
      result.insert.performed = "unknown";
      result.verdict = "inconclusive";
      return result; // unknown insert outcome: intent stays open (cleanup INCOMPLETE), never a lost event
    }
    const rows = await act(gate, () => tf.db.select("interventions", { id: `eq.${job.id}` }, "id,client_id"));
    result.insert.readback_ok = Array.isArray(rows) && rows.length === 1 && rows[0].client_id === uid;
    if (!result.insert.readback_ok) {
      result.verdict = "inconclusive";
      return result;
    }
    const until = now() + windowMs;
    let received = false;
    while (!received && now() < until) {
      received = await act(gate, () => page.evaluate((id) => window.__rt.received(id), job.id));
      if (!received) await gatedWait(gate, 100);
    }
    result.event_received_within_window = received;
    result.verdict = received ? "event_received" : "no_event";
    return result;
  } finally {
    try {
      sdkTokenChanges = await page.evaluate(() => window.__rt.tokenChangesSinceJoin());
    } catch {
      sdkTokenChanges = Infinity; // unknown ⇒ role unknown
    }
    await page.evaluate(() => window.__rt.close()).catch(() => {});
    await new Promise((r) => setTimeout(r, 300)); // drain the leave before the next measurement
    proxy.detach();
    const snap = projector.snapshot();
    result.join = snap.reply;
    result.system = snap.system;
    result.auth = { proxy_invoked: proxy.stats().invoked > 0, epochs: snap.epochs.map((e) => ({ epoch: e.epoch, t_ms: e.t_ms, role_authenticated_sub_matches: e.present && e.role_authenticated && e.sub_matches })), sdk_token_changes: Number.isFinite(sdkTokenChanges) ? sdkTokenChanges : null, foreign_frames: snap.foreign_frames, ...authVerdict({ proxyInvoked: proxy.stats().invoked > 0, snapshot: snap, sdkTokenChanges }) };
  }
}
