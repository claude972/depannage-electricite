// Tracking cleanup (contract §7, A2, A5): intervention_tracking rows of the cohort BEFORE the
// shared steps (interventions, profiles…); provider leases are only re-read (cascade from
// interventions, expected 0); the provider budget singleton is NEVER written. Then the shared
// runner (scripts/qa/lib/cleanup.mjs, read-only) deletes the rest in its FK order.
import { runCleanup as runSharedCleanup, CLEANUP_STEPS } from "../../qa/lib/cleanup.mjs";
import { isUuid } from "../../qa/lib/cohort.mjs";

export const TRACKING_PRE_STEPS = [{ kind: "table", table: "intervention_tracking", column: "intervention_id", ids: "interventions" }];
export const LEASE_CHECK = { table: "tracking_provider_leases", column: "intervention_id", ids: "interventions" };
/** Tables the harness must never write or delete (checked by a unit test). */
export const NEVER_TOUCHED = ["tracking_provider_budget"];

/** Full ordered plan description (dry-run and tests). */
export function cleanupOrder() {
  return [...TRACKING_PRE_STEPS, ...CLEANUP_STEPS].map((s) => (s.kind === "table" ? `${s.table} by ${s.column}` : s.kind === "storage" ? `storage ${s.bucket}` : "auth users"));
}

const chunks = (list, size = 60) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export async function runTrackingCleanup(db, manifest, log = () => {}) {
  const steps = [];
  let ok = true;
  const ids = [...new Set(manifest?.created?.interventions || [])];
  if (ids.some((id) => !isUuid(id))) return { ok: false, steps: [{ table: "intervention_tracking", status: "fail", error: "non-UUID intervention id in manifest" }] };
  for (const step of TRACKING_PRE_STEPS) {
    if (!ids.length) continue;
    const entry = { kind: "table", table: step.table, column: step.column, requested: ids.length, remaining: null, status: "pass", error: null };
    try {
      for (const part of chunks(ids)) await db.delete(step.table, { [step.column]: `in.(${part.join(",")})` });
      let remaining = 0;
      for (const part of chunks(ids)) remaining += await db.count(step.table, { [step.column]: `in.(${part.join(",")})` });
      entry.remaining = remaining;
      if (remaining) throw new Error(`${remaining} row(s) still present`);
    } catch (error) {
      entry.status = "fail";
      entry.error = String(error?.message || error);
      ok = false;
    }
    log(entry);
    steps.push(entry);
  }
  const shared = await runSharedCleanup(db, manifest, log);
  steps.push(...shared.steps);
  ok = ok && shared.ok;
  if (ids.length) {
    const entry = { kind: "check", table: LEASE_CHECK.table, column: LEASE_CHECK.column, requested: ids.length, remaining: null, status: "pass", error: null, note: "read-only: leases cascade from interventions" };
    try {
      let remaining = 0;
      for (const part of chunks(ids)) remaining += await db.count(LEASE_CHECK.table, { [LEASE_CHECK.column]: `in.(${part.join(",")})` });
      entry.remaining = remaining;
      if (remaining) throw new Error(`${remaining} lease(s) remain after the interventions cascade`);
    } catch (error) {
      entry.status = "fail";
      entry.error = String(error?.message || error);
      ok = false;
    }
    log(entry);
    steps.push(entry);
  }
  return { ok, steps };
}
