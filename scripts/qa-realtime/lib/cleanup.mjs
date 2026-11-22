// Cleanup for the Realtime probe: the GENERIC B1 cleanupWithProof (read-only import) with
// runTrackingCleanup and no side effects. --cleanup-manifest validates the manifest STRICTLY before
// the credentials and the intents journal EXACTLY before any remote client exists.
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

export const realtimeCleanupWithProof = (args) => generic({ ...args, runCleanupFn: runTrackingCleanup, settleSideEffects: noSideEffects });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["service", "tracking", "provider", "intervention-action", "other"];
const OUTCOMES = ["done", "refused", "reconciled", "not-sent"];
export function validateIntentsJournal(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, why: "journal is not an object" };
  if (j.version !== 2) return { ok: false, why: "unsupported journal version" };
  if (!Array.isArray(j.intents)) return { ok: false, why: "intents is not an array" };
  for (const [i, e] of j.intents.entries()) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return { ok: false, why: `entry ${i} is not an object` };
    if (typeof e.id !== "string" || !UUID.test(e.id)) return { ok: false, why: `entry ${i}: invalid id` };
    if (typeof e.op !== "string" || !e.op) return { ok: false, why: `entry ${i}: invalid op` };
    if (!("kind" in e) || (e.kind !== null && !KINDS.includes(e.kind))) return { ok: false, why: `entry ${i}: invalid kind` };
    if (e.state === "open") {
      if (e.outcome !== null && e.outcome !== undefined) return { ok: false, why: `entry ${i}: open entry with an outcome` };
    } else if (e.state === "settled") {
      if (!OUTCOMES.includes(e.outcome)) return { ok: false, why: `entry ${i}: unknown outcome` };
    } else return { ok: false, why: `entry ${i}: unknown state` };
  }
  return { ok: true };
}

export async function cleanupOnly(options, redactor, log, deps = {}) {
  const manifestFile = path.resolve(options.cleanupManifest);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch {
    throw new PreflightError("manifest unreadable or not JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.version !== 1) throw new PreflightError("manifest version must be exactly 1");
  if (manifest.project !== options.project) throw new PreflightError("manifest project does not match --project exactly");
  if (!/^[0-9a-f]{12}$/.test(String(manifest.run_id))) throw new PreflightError("manifest has no valid run_id");
  if (!manifest.created || typeof manifest.created !== "object" || Array.isArray(manifest.created)) throw new PreflightError("manifest has no created map");
  const credentials = await (deps.loadCredentials || loadCredentials)(options.credentials);
  redactor.add(credentials.supabase.serviceKey);
  assertProject(options.project, credentials);
  const intentsFile = path.join(path.dirname(manifestFile), "intents.json");
  const target = path.join(path.dirname(manifestFile), "cleanup.json");
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
    await writeFile(target, JSON.stringify({ ok: false, refused: true, error: `intents journal refused: ${verdict.why}; outcomes UNKNOWN, nothing read or deleted` }, null, 2) + "\n", { mode: 0o600 });
    log(`cleanup REFUSED: ${verdict.why} (exit 3)`);
    return 3;
  }
  const intents = new IntentLog(intentsFile, { persist: false });
  intents.entries = journal.intents;
  const db = (deps.makeDb || ((c) => createServiceClient({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, redactor, timeoutMs: options.timeoutMs })))(credentials);
  const auth = (deps.makeAuth || ((c) => createAuthAdmin({ url: c.supabase.url, serviceKey: c.supabase.serviceKey, timeoutMs: options.timeoutMs })))(credentials);
  const result = await realtimeCleanupWithProof({ db, auth, manifest, intents, runId: manifest.run_id, log, persist: () => atomicWriteJsonSync(manifestFile, manifest) });
  await writeFile(target, JSON.stringify(redactor.redact(result), null, 2) + "\n", { mode: 0o600 });
  log(`cleanup ${result.ok ? "complete" : "INCOMPLETE"} → ${target}`);
  return result.ok ? 0 : 3;
}
