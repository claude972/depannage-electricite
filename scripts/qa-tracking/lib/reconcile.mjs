// Readback proofs for mutations whose outcome is UNKNOWN (5xx, timeout, connection lost after the
// request left, response not fully read). Only MONOTONIC evidence proves a state: an effect that
// cannot be undone by the request still being in flight. Otherwise the intent stays open and the
// run ends INCOMPLETE (exit 3). Pure functions + a service-key reader (reads only).
import { parseTrackingUrl } from "./requests.mjs";

/** Mutation metadata derived from the path/body (never coordinates). */
export function describeMutation(path, body, extra = {}) {
  const tracking = parseTrackingUrl(`http://local${path}`);
  if (tracking) {
    if (tracking.kind !== "tracking") return { kind: "provider", interventionId: tracking.interventionId, operation: tracking.kind };
    const p = body && typeof body.payload === "object" && body.payload ? body.payload : {};
    return { kind: "tracking", interventionId: tracking.interventionId, action: typeof body?.action === "string" ? body.action : null, session_id: typeof p.session_id === "string" ? p.session_id : null, seq: Number.isInteger(p.seq) ? p.seq : null, clear: p.clear === true, before: Number.isInteger(extra.before) ? extra.before : null };
  }
  const action = /^\/api\/interventions\/([0-9a-f-]{36})\/actions$/i.exec(path);
  if (action) return { kind: "intervention-action", interventionId: action[1].toLowerCase(), action: typeof body?.action === "string" ? body.action : null };
  return { kind: "other", path };
}

/** Proof from the tracking row (and the intervention for `arrived`). */
export function proveTracking(meta, row, job = null) {
  const sid = meta.session_id;
  switch (meta.action) {
    case "start":
      return row && sid && row.session_id === sid ? { proven: true, note: "session observed active" } : { proven: false };
    case "point":
      return row && sid && row.session_id === sid && Number.isInteger(meta.seq) && row.last_seq >= meta.seq ? { proven: true, note: "seq observed applied" } : { proven: false };
    case "stop":
      // A stopped session never comes back: its absence is final whatever happened to the request.
      return sid && (!row || row.session_id !== sid) ? { proven: true, note: "session no longer active" } : { proven: false };
    case "arrived":
      return sid && (!row || row.session_id !== sid) && job?.travel_stage === "on_site" ? { proven: true, note: "on_site and session closed" } : { proven: false };
    case "destination":
      return row && Number.isInteger(meta.before) && row.destination_version > meta.before ? { proven: true, note: "destination_version advanced" } : { proven: false };
    default:
      return { proven: false };
  }
}
export function proveAction(meta, row) {
  if (!row) return { proven: false };
  if (meta.action === "start" && ["in_progress", "completed", "paid"].includes(row.status)) return { proven: true, note: `status ${row.status}` };
  if (meta.action === "complete" && ["completed", "paid"].includes(row.status)) return { proven: true, note: `status ${row.status}` };
  return { proven: false };
}

/** Readback with the service key. Provider calls are proven only by the post-cleanup lease check. */
export function createReconciler(db) {
  return async (meta) => {
    if (!meta || meta.kind === "other") return { proven: false };
    if (meta.kind === "provider") return { proven: false, deferTo: "lease-check" };
    if (meta.kind === "intervention-action") {
      const [row] = await db.select("interventions", { id: `eq.${meta.interventionId}` }, "status");
      return proveAction(meta, row);
    }
    const [row] = await db.select("intervention_tracking", { intervention_id: `eq.${meta.interventionId}` }, "session_id,shared,last_seq,destination_version");
    const [job] = meta.action === "arrived" ? await db.select("interventions", { id: `eq.${meta.interventionId}` }, "travel_stage") : [null];
    return proveTracking(meta, row || null, job || null);
  };
}
