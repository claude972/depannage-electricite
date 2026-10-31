// Tracking-owned finalisation guard (root addendum, the shared scripts/qa lifecycle is untouched):
// the shared lifecycle drains, then calls our cleanup. If ANY producer (service write, harness API
// mutation, browser mutation, session opening) is still undrained at that moment, NOTHING is
// deleted: manifest.json and intents.json stay on disk as written, the run ends INCOMPLETE (3)
// with the recovery command. Browsers are stopped afterwards so no new emission can happen.
import path from "node:path";

export function recoveryCommand({ outDir, project }) {
  return `node scripts/qa-tracking/run.mjs --cleanup-manifest ${path.join(outDir, "manifest.json")} --credentials <credentials.json> --project ${project}`;
}

/**
 * `proveAndClean` performs reconciliation + ownership proof + deletion; `stopProducers` closes the
 * browser contexts. Returns the lifecycle cleanup result.
 */
export function createGuardedCleanup({ gate, stopProducers = async () => {}, proveAndClean, recovery, log = () => {}, onEvent = () => {} }) {
  return async () => {
    const undrained = gate.pending; // measured BEFORE stopping: closing would turn them into failures
    onEvent({ type: "cleanup-start", undrained, at: Date.now() });
    try {
      await stopProducers();
    } catch (error) {
      log(`stopping producers failed: ${String(error?.message || error).slice(0, 160)}`);
    }
    if (undrained > 0) {
      const result = { ok: false, refused: true, undrained, deletes: 0, error: `${undrained} producer(s) not drained: no deletion performed; manifest and intents preserved`, recovery };
      log(`cleanup REFUSED: ${result.error}. Recover with: ${recovery}`);
      onEvent({ type: "cleanup-refused", undrained, at: Date.now() });
      return result;
    }
    const result = await proveAndClean();
    onEvent({ type: "cleanup-end", ok: result?.ok, at: Date.now() });
    return result.ok ? result : { ...result, recovery };
  };
}

/** Exit code: an incomplete/refused cleanup always wins (3). */
export function exitCodeFor({ cleanup = null, fail = 0, preflight = false, signal = false, fatalCode = null }) {
  if (cleanup && cleanup.ok === false) return 3;
  if (preflight) return 2;
  if (signal) return 130;
  if (fail > 0) return 1;
  return fatalCode ?? 0;
}
