// Cleanup with remote ownership proof for the deep-link harness (contract A2 P2-4, option B / B2):
// the GENERIC cleanupWithProof of B1 (scripts/qa-tracking/lib/cleanup-proof.mjs, read-only import),
// with `runTrackingCleanup` as runCleanupFn (intervention_tracking pre-steps in case the app created a
// row lazily, then the shared FK-ordered cleanup, then the lease readback) and NO side effects.
// Unknown/malformed ⇒ intent OPEN, INCOMPLETE, exit 3; an absence never closes an intent.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanupWithProof as generic, noSideEffects } from "../../qa-tracking/lib/cleanup-proof.mjs";
import { runTrackingCleanup } from "../../qa-tracking/lib/cleanup.mjs";
import { IntentLog } from "../../qa-tracking/lib/intents.mjs";
import { createAuthAdmin } from "../../qa-tracking/lib/auth-admin.mjs";
import { atomicWriteJsonSync } from "../../qa-tracking/lib/durable.mjs";
import { loadCredentials, assertProject, PreflightError } from "../../qa/lib/config.mjs";
import { createServiceClient } from "../../qa/lib/supabase.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INTENT_KINDS = Object.freeze(["service", "tracking", "provider", "intervention-action", "other"]);
export const INTENT_OUTCOMES = Object.freeze(["done", "refused", "reconciled", "not-sent"]);

/**
 * EXACT validation of intents.json (IntentLog version 2) BEFORE anything generic: `version` === 2,
 * `intents` an array, every entry with a UUID `id`, a non-empty string `op`, a known `kind`, a known
 * `state` (open | settled) and, when settled, a known `outcome` (open ⇒ outcome null). Anything else
 * ⇒ { ok:false, why } — never coerced to an empty list.
 */
export function validateIntentsJournal(journal) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) return { ok: false, why: "journal is not an object" };
  if (journal.version !== 2) return { ok: false, why: "unsupported journal version" };
  if (!Array.isArray(journal.intents)) return { ok: false, why: "intents is not an array" };
  for (const [i, e] of journal.intents.entries()) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, why: `entry ${i} is not an object` };
    if (typeof e.id !== "string" || !UUID.test(e.id)) return { ok: false, why: `entry ${i}: invalid id` };
    if (typeof e.op !== "string" || !e.op) return { ok: false, why: `entry ${i}: invalid op` };
    if (e.kind !== null && !INTENT_KINDS.includes(e.kind)) return { ok: false, why: `entry ${i}: unknown kind` };
    if (!("kind" in e)) return { ok: false, why: `entry ${i}: missing kind` };
    if (e.state === "open") {
      if (e.outcome !== null && e.outcome !== undefined) return { ok: false, why: `entry ${i}: open entry with an outcome` };
    } else if (e.state === "settled") {
      if (!INTENT_OUTCOMES.includes(e.outcome)) return { ok: false, why: `entry ${i}: unknown outcome` };
    } else return { ok: false, why: `entry ${i}: unknown state` };
  }
  return { ok: true };
}

export function deeplinkCleanupWithProof(args) {
  return generic({ ...args, runCleanupFn: runTrackingCleanup, settleSideEffects: noSideEffects });
}

/** --cleanup-manifest mode: everything read from disk; `deps` (makeDb, makeAuth) injectable for tests. */
export async function cleanupOnly(options, redactor, log, deps = {}) {
  // The manifest is validated STRICTLY before the credentials are read and before any remote call.
  const manifestFile = path.resolve(options.cleanupManifest);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    throw new PreflightError("manifest unreadable or not JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new PreflightError("manifest is not an object");
  if (manifest.version !== 1) throw new PreflightError("manifest version must be exactly 1");
  if (manifest.project !== options.project) throw new PreflightError("manifest project does not match --project exactly");
  if (!/^[0-9a-f]{12}$/.test(String(manifest.run_id))) throw new PreflightError("manifest has no valid run_id");
  if (!manifest.created || typeof manifest.created !== "object" || Array.isArray(manifest.created)) throw new PreflightError("manifest has no created map");
  const credentials = await (deps.loadCredentials || loadCredentials)(options.credentials);
  redactor.add(credentials.supabase.serviceKey);
  assertProject(options.project, credentials);
  const intentsFile = path.join(path.dirname(manifestFile), "intents.json");
  const target = path.join(path.dirname(manifestFile), "cleanup.json");
  // The journal is validated EXACTLY before any remote read or delete (no client is even created).
  let journal = null;
  let verdict;
  if (!existsSync(intentsFile)) verdict = { ok: false, why: "intents.json missing next to the manifest" };
  else {
    try {
      journal = JSON.parse(readFileSync(intentsFile, "utf8"));
      verdict = validateIntentsJournal(journal);
    } catch {
      verdict = { ok: false, why: "intents.json is not valid JSON" };
    }
  }
  if (!verdict.ok) {
    const refused = { ok: false, refused: true, error: `intents journal refused: ${verdict.why}; outcomes UNKNOWN, nothing read or deleted` };
    await writeFile(target, JSON.stringify(refused, null, 2) + "\n", { mode: 0o600 });
    log(`cleanup REFUSED: ${verdict.why} (exit 3)`);
    return 3;
  }
  const intents = new IntentLog(intentsFile, { persist: false });
  intents.entries = journal.intents;
  const db = (deps.makeDb || ((c) => createServiceClient({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs })))(credentials);
  const auth = (deps.makeAuth || ((c) => createAuthAdmin({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, timeoutMs: options.timeoutMs })))(credentials);
  const result = await deeplinkCleanupWithProof({ db, auth, manifest, intents, runId: manifest.run_id, log, persist: () => atomicWriteJsonSync(manifestFile, manifest) });
  await writeFile(target, JSON.stringify(redactor.redact(result), null, 2) + "\n", { mode: 0o600 });
  log(`cleanup ${result.ok ? "complete" : "INCOMPLETE"} → ${target}`);
  return result.ok ? 0 : 3;
}
