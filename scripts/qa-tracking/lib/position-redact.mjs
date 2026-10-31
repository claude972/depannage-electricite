// Position redaction (contract §8): coordinates, geometries, snapped points, destinations and
// geocoding labels never reach run.log, events.ndjson, result.json or summary.md. Wraps the
// shared secret redactor (scripts/qa/lib/redact.mjs, read-only) and adds position rules.
export const POSITION = "[position]";
const POSITION_KEYS = /^(latitude|longitude|lat|lon|lng|accuracy_m|accuracy|position|positions|destination|destination_latitude|destination_longitude|destination_label|geometry|coordinates|snapped_start|snapped_end|label|candidate_label|candidates|query|q)$/i;
// Signed decimals with ≥ 3 decimals (coordinates), alone or as pairs "lat, lon" / "[lon,lat]".
const DECIMAL_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/g;
const DECIMAL = /(?<![\w.])-?\d{1,3}\.\d{4,}(?![\w.])/g;

export function redactPositionString(text) {
  return String(text).replace(DECIMAL_PAIR, POSITION).replace(DECIMAL, POSITION);
}

export function redactPosition(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactPositionString(value);
  if (typeof value === "number") return Number.isInteger(value) ? value : POSITION;
  if (typeof value !== "object") return value;
  if (depth > 12) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redactPosition(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) out[key] = POSITION_KEYS.test(key) && v !== null && v !== undefined ? POSITION : redactPosition(v, depth + 1);
  return out;
}

/** Shared redactor + position rules, same interface as createRedactor(). */
export function withPositionRedaction(redactor) {
  return {
    ...redactor,
    redactString: (s) => redactPositionString(redactor.redactString(s)),
    redact: (v) => redactPosition(redactor.redact(v)),
    redactError: (e) => {
      const r = redactor.redactError(e);
      return { ...r, message: redactPositionString(r.message), stack: r.stack ? redactPositionString(r.stack) : r.stack };
    },
  };
}

/** Evidence kept for a snapshot: state only, never coordinates (contract §8). */
export function snapshotEvidence(snapshot, nowMs = Date.now()) {
  const t = snapshot?.tracking;
  if (!t) return { present: false };
  const sampled = t.position?.sampled_at ? Date.parse(t.position.sampled_at) : null;
  const age = sampled === null || Number.isNaN(sampled) ? null : Math.max(0, Math.round((nowMs - sampled) / 5000) * 5);
  const acc = t.position?.accuracy_m;
  return {
    present: true,
    shared: t.shared,
    position_state: t.position_state,
    position_present: t.position !== null,
    age_s_rounded: age,
    accuracy_bucket: typeof acc === "number" ? (acc <= 20 ? "≤20m" : acc <= 100 ? "≤100m" : "≤250m") : null,
    last_seq: t.last_seq,
    control_version: t.control_version,
    destination_version: t.destination_version,
    destination_present: t.destination !== null,
    session_present: t.session_id !== null,
    travel_stage: t.travel_stage,
    can_share: snapshot.permissions?.can_share ?? null,
    can_confirm_destination: snapshot.permissions?.can_confirm_destination ?? null,
  };
}
