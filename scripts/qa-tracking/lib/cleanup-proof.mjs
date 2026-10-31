// Cleanup with remote ownership proof, generic part (B1 — QA-CLEANUP-EXTRACT-B1-001). Extracted
// unchanged from scripts/qa-tracking/run.mjs; the harness passes its deletion steps (`runCleanupFn`,
// REQUIRED) and its side-effect settlement (`settleSideEffects`, no-op by default). Order (unchanged):
// reconcileOpen → persist → recovery by canonical e-mail → persist → ownership proof →
// cleanup_attempt persisted BEFORE DELETE → cleanup → side-effect settlement → result persisted.
import { intentsVerdict } from "./intents.mjs";
import { proveOwnership, readOwnership } from "./ownership.mjs";

export const noSideEffects = () => {};

/**
 * Cleanup with remote ownership proof (A5.4). Open createAuthUser intents are recovered by their
 * canonical e-mail (validated before the lookup) so the account is still deleted, but the run
 * stays INCOMPLETE: an outcome that was unknown is never reported as clean.
 */
export async function cleanupWithProof({ db, auth, manifest, intents, runId, log, persist, runCleanupFn, settleSideEffects = noSideEffects }) {
  if (typeof runCleanupFn !== "function") throw new Error("cleanupWithProof needs runCleanupFn(db, proven, log)");
  if (typeof settleSideEffects !== "function") throw new Error("cleanupWithProof: settleSideEffects must be a function");
  // Mandatory durability hook (root review of 4b57800): every UID recovered or proven is written to
  // the manifest on disk AFTER its recovery and BEFORE any DELETE, in normal and --cleanup-manifest
  // modes, so an interruption between recovery and deletion never loses it.
  if (typeof persist !== "function") throw new Error("cleanupWithProof needs a durable persist() hook");
  for (const key of ["auth_users", "profiles", "admin_profiles", "interventions", "organizations", "sites"]) manifest.created[key] ||= [];
  // Unknown outcomes first: readbacks may prove them now that every producer has settled.
  await intents.reconcileOpen(log);
  await persist(); // ids tracked by readbacks are on disk
  const verdict = intentsVerdict(intents);
  const recovered = [];
  for (const open of verdict.open.filter((o) => o.op === "createAuthUser" && o.key)) {
    let found;
    try {
      found = await auth.searchByEmail(open.key, runId);
    } catch (error) {
      log(`intent recovery refused/failed: ${String(error?.message || error)}`);
      continue;
    }
    if (found.state !== "found") {
      recovered.push({ email_slug: open.key.split("@")[0], id: null, search: found.state });
      continue;
    }
    // Recorded for deletion; ownership is re-proven below from a schema-valid read by id.
    for (const key of ["auth_users", "profiles"]) if (!manifest.created[key].includes(found.id)) manifest.created[key].push(found.id);
    recovered.push({ email_slug: open.key.split("@")[0], id: found.id });
    manifest.recovered = [...(manifest.recovered || []).filter((r) => r.id !== found.id), { id: found.id, email_slug: open.key.split("@")[0], at: new Date().toISOString(), intent: "open" }];
    // Durable BEFORE anything else happens. A failed write is NOT caught: no DELETE may follow.
    await persist();
  }
  const remote = await readOwnership(db, auth, manifest);
  const { manifest: proven, unproven } = proveOwnership({ manifest, runId, ...remote });
  manifest.cleanup_attempt = { started_at: new Date().toISOString(), proven: proven.created, unproven: unproven.map((u) => ({ key: u.key, id: u.id, why: u.why })), completed_at: null, ok: null };
  await persist(); // proof recorded on disk BEFORE the first DELETE
  const cleanup = await runCleanupFn(db, proven, (e) => log(`cleanup ${String(e.status).padEnd(4)} ${e.table}${e.column ? ` by ${e.column}` : ""}: requested ${e.requested}, remaining ${e.remaining}${e.error ? ` — ${e.error}` : ""}`));
  // Side effects of the harness (tracking: provider leases) are settled only AFTER the cleanup; a hook
  // error is never PASS: the run is INCOMPLETE and every still-open intent stays open.
  let sideEffectsError = null;
  try {
    await settleSideEffects({ intents, cleanup });
  } catch (error) {
    sideEffectsError = String(error?.name || "Error");
    log(`side-effect settlement failed (${sideEffectsError}): run INCOMPLETE`);
  }
  const final = intentsVerdict(intents);
  const ok = cleanup.ok && unproven.length === 0 && final.open.length === 0 && sideEffectsError === null;
  // The manifest keeps every id (never dropped) and records what was deleted after proof.
  manifest.cleanup_attempt = { ...manifest.cleanup_attempt, completed_at: new Date().toISOString(), ok, deletion_ok: cleanup.ok, open_intents: final.open.length, ...(sideEffectsError ? { side_effects_error: sideEffectsError } : {}) };
  await persist();
  return { ok, steps: cleanup.steps, unproven, open_intents: final.open, recovered, error: ok ? null : [!cleanup.ok && "deletion step failed", unproven.length && `${unproven.length} id(s) not proven to belong to the run`, final.open.length && `${final.open.length} write(s) with unknown outcome`, sideEffectsError && "side-effect settlement failed"].filter(Boolean).join("; ") };
}
