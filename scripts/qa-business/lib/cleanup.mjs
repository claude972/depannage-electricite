// Cleanup plan for QA-DOCUMENTS-B2B-004: the existing plan (scripts/qa/lib/cleanup.mjs, read-only)
// extended with the children of migrations 015 (quote documents), 016 (notifications, planning)
// and 017 (site operations). Deletes ONLY manifest ids (filters `in.(...)`), children before
// parents, exact-count readback after every step. An UNKNOWN outcome (timeout, network error,
// non-4xx failure of a delete or of a readback) stops the plan: every later step is skipped,
// `ok` is false and the manifest is kept for --cleanup-manifest. Never a name pattern, never a
// date range, never a whole table.
import { CLEANUP_STEPS as BASE_STEPS, FK_PARENTS as BASE_FK, MANIFEST_KEYS as BASE_KEYS } from "../../qa/lib/cleanup.mjs";
import { createCohort, isUuid } from "../../qa/lib/cohort.mjs";

export const MANIFEST_KEYS = [...BASE_KEYS, "quote_amendments", "quote_documents", "intents"];

/** Children of 015/016/017, deleted before everything the existing plan removes. */
export const BUSINESS_STEPS = [
  // 015 — quote documents (quote_document_events references documents and amendments)
  { kind: "table", table: "quote_document_events", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "quote_documents", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "quote_amendments", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "quote_terms", column: "quote_id", ids: "quotes" },
  // 017 — site operations (pauses → cases → policies → calendars; visits → plans → equipment; lines → fiscal years)
  { kind: "table", table: "site_sla_pauses", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_sla_cases", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_sla_policies", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_maintenance_visits", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_maintenance_plans", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_equipment", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_budget_lines", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_erp_checklists", column: "site_id", ids: "sites" },
  { kind: "table", table: "site_operations_events", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_contract_grids", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_sla_calendars", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_fiscal_years", column: "organization_id", ids: "organizations" },
  // 016 — notifications emitted by triggers for cohort actors/dossiers/sites/organisations; planning rows
  { kind: "table", table: "notifications", column: "recipient_id", ids: "profiles" },
  { kind: "table", table: "notifications", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "notifications", column: "site_id", ids: "sites" },
  { kind: "table", table: "notifications", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "notification_preferences", column: "user_id", ids: "profiles" },
  { kind: "table", table: "artisan_planning_entries", column: "artisan_id", ids: "profiles" },
  { kind: "table", table: "artisan_availability_rules", column: "artisan_id", ids: "profiles" },
];
export const CLEANUP_STEPS = [...BUSINESS_STEPS, ...BASE_STEPS];

/** Parent → children that must be deleted before it (015/016/017 added to the existing map). */
export const FK_PARENTS = {
  ...BASE_FK,
  quotes: [...(BASE_FK.quotes || []), "quote_terms", "quote_amendments", "quote_documents", "quote_document_events"],
  interventions: [...(BASE_FK.interventions || []), "quote_amendments", "quote_documents", "quote_document_events", "site_maintenance_visits", "site_sla_cases", "notifications"],
  quote_amendments: ["quote_documents", "quote_document_events"],
  quote_documents: ["quote_document_events"],
  site_equipment: ["site_maintenance_plans"],
  site_maintenance_plans: ["site_maintenance_visits"],
  organization_fiscal_years: ["site_budget_lines"],
  organization_sla_calendars: ["site_sla_policies"],
  site_sla_policies: ["site_sla_cases"],
  site_sla_cases: ["site_sla_pauses"],
  contracts: ["organization_contract_grids"],
  sites: [...(BASE_FK.sites || []), "site_sla_pauses", "site_sla_cases", "site_sla_policies", "site_maintenance_visits", "site_maintenance_plans", "site_equipment", "site_budget_lines", "site_erp_checklists", "notifications"],
  organizations: [...(BASE_FK.organizations || []), "site_operations_events", "organization_contract_grids", "organization_sla_calendars", "organization_fiscal_years", "notifications"],
  profiles: [...(BASE_FK.profiles || []), "quote_terms", "quote_amendments", "quote_documents", "quote_document_events", "site_equipment", "site_maintenance_plans", "site_maintenance_visits", "site_budget_lines", "site_erp_checklists", "site_sla_policies", "site_sla_cases", "site_sla_pauses", "organization_fiscal_years", "organization_contract_grids", "organization_sla_calendars", "site_operations_events", "notifications", "notification_preferences", "artisan_planning_entries", "artisan_availability_rules"],
  support_tickets: [...(BASE_FK.support_tickets || []), "notifications"],
};

export function emptyManifest(context = {}) {
  const created = {};
  for (const key of MANIFEST_KEYS) created[key] = [];
  return { version: 2, ...context, created_at: new Date().toISOString(), intents: [], created };
}

/** Concrete operations: empty lists skipped, non-UUID ids refused (never a guessed deletion). */
export function planCleanup(manifest, steps = CLEANUP_STEPS) {
  const created = manifest?.created || {};
  const ops = [];
  for (const step of steps) {
    const ids = [...new Set(created[step.ids] || [])];
    if (!ids.length) continue;
    if (step.kind !== "storage") for (const id of ids) if (!isUuid(id)) throw new Error(`refusing cleanup: ${step.ids} contains a non-UUID id`);
    ops.push({ ...step, values: ids });
  }
  return ops;
}

/** Every child table appears before its parent; Storage precedes `documents`; Auth is last. */
export function orderViolations(steps = CLEANUP_STEPS, parents = FK_PARENTS) {
  const tables = steps.filter((s) => s.kind === "table").map((s) => s.table);
  const lastIndex = (t) => tables.lastIndexOf(t);
  const firstIndex = (t) => tables.indexOf(t);
  const violations = [];
  for (const [parent, children] of Object.entries(parents)) {
    if (firstIndex(parent) < 0) continue;
    for (const child of children) {
      if (firstIndex(child) < 0) continue;
      if (lastIndex(child) > firstIndex(parent)) violations.push(`${child} must be deleted before ${parent}`);
    }
  }
  const storage = steps.findIndex((s) => s.kind === "storage");
  const documents = steps.findIndex((s) => s.kind === "table" && s.table === "documents");
  if (storage >= 0 && documents >= 0 && storage > documents) violations.push("storage objects must be deleted before documents");
  if (steps.findIndex((s) => s.kind === "auth") !== steps.length - 1) violations.push("auth users must be the last step");
  return violations;
}

const chunk = (list, size = 60) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
/** A 4xx from PostgREST/Auth/Storage is a definite answer; anything else leaves the outcome unknown. */
export function isUnknownOutcome(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) return false;
  return true;
}

/**
 * Executes the plan with the service client (scripts/qa/lib/supabase.mjs shape). Returns
 * {ok, steps:[{kind, table, column, requested, remaining, status, error}]}. Statuses: pass,
 * fail (definite refusal, continue), skipped (optional table absent), unknown (outcome not
 * established: STOP), skipped-unknown (not attempted after an unknown outcome).
 */
export async function runCleanup(db, manifest, log = () => {}, steps = CLEANUP_STEPS) {
  const results = [];
  let ok = true;
  let halted = null;
  const ops = planCleanup(manifest, steps);
  for (const op of ops) {
    const entry = { kind: op.kind, table: op.table || op.bucket || "auth.users", column: op.column || null, requested: op.values.length, remaining: null, status: "pass", error: null };
    if (halted) {
      entry.status = "skipped-unknown";
      entry.error = `not attempted: outcome of ${halted} unknown`;
      ok = false;
      log(entry);
      results.push(entry);
      continue;
    }
    try {
      if (op.kind === "table") {
        for (const part of chunk(op.values)) await db.delete(op.table, { [op.column]: `in.(${part.join(",")})` });
        let remaining = 0;
        for (const part of chunk(op.values)) remaining += await db.count(op.table, { [op.column]: `in.(${part.join(",")})` });
        entry.remaining = remaining;
        if (remaining !== 0) throw Object.assign(new Error(`${remaining} row(s) still present`), { status: 409 });
      } else if (op.kind === "storage") {
        for (const part of chunk(op.values)) await db.storageRemove(op.bucket, part);
        const prefixes = new Set(op.values.map((p) => p.split("/")[0]).filter(Boolean));
        let remaining = 0;
        for (const prefix of prefixes) {
          const listed = await db.storageList(op.bucket, prefix);
          remaining += listed.filter((o) => op.values.includes(`${prefix}/${o.name}`)).length;
        }
        entry.remaining = remaining;
        if (remaining !== 0) throw Object.assign(new Error(`${remaining} object(s) still present`), { status: 409 });
      } else if (op.kind === "auth") {
        let remaining = 0;
        for (const id of op.values) {
          await db.deleteAuthUser(id);
          if (await db.authUserExists(id)) remaining++;
        }
        entry.remaining = remaining;
        if (remaining !== 0) throw Object.assign(new Error(`${remaining} auth user(s) still present`), { status: 409 });
      }
    } catch (error) {
      if (op.optional && /42P01|does not exist|PGRST205|column .* does not exist/i.test(String(error?.message))) {
        entry.status = "skipped";
        entry.error = "table or column absent on this schema";
      } else if (isUnknownOutcome(error)) {
        entry.status = "unknown";
        entry.error = `outcome unknown (${String(error?.message || error)}); plan halted, manifest kept — rerun with --cleanup-manifest`;
        halted = `${entry.table}${entry.column ? ` by ${entry.column}` : ""}`;
        ok = false;
      } else {
        entry.status = "fail";
        entry.error = String(error?.message || error);
        ok = false;
      }
    }
    log(entry);
    results.push(entry);
  }
  return { ok, halted, steps: results };
}

/**
 * The ONLY email an intent may carry: recomputed from the manifest run id and the intent label with
 * the creation-time function (scripts/qa/lib/cohort.mjs). Returns null for a malformed run id,
 * label or id, or any other email: such an intent is never looked up and never adopted.
 */
export function expectedIntentEmail(manifest, intent) {
  if (!intent || typeof intent !== "object" || !isUuid(intent.id) || typeof intent.label !== "string" || !intent.label.trim()) return null;
  let cohort;
  try {
    cohort = createCohort(manifest?.run_id);
  } catch {
    return null;
  }
  const expected = cohort.email(intent.label);
  if (!/^qa-[0-9a-f]{12}-[a-z0-9]+(?:-[a-z0-9]+)*@qa\.invalid$/.test(expected)) return null;
  return intent.email === expected ? expected : null;
}
const isCohortAccount = (account, expected) => !!account && isUuid(account.id) && typeof account.email === "string" && account.email.toLowerCase() === expected;

/**
 * Intents (users whose Auth creation was requested with a pre-generated id). The intent is first
 * validated against the cohort (exact `qa-<run_id>-<slug(label)>@qa.invalid`, UUID id); a rejected
 * intent is never looked up. Auth honouring the requested id is NOT assumed: the account is
 * established by `GET admin/users/<id>` AND an exhaustive listing filtered on that exact email, and
 * every returned account must itself be a cohort account (UUID id, exact email).
 *  - resolved : exactly one cohort account carries the email; its id is adopted;
 *  - absent   : id 404 AND exhaustive listing empty;
 *  - rejected : the intent is not a cohort intent (edited email, wrong run id/label, bad id);
 *  - mismatch : a returned account is not the cohort account (other email, non-UUID id, divergent id);
 *  - unknown  : a read failed, the listing was not exhausted, or several accounts match.
 * Only `resolved` and `absent` are definite. `rejected`/`mismatch` mean the manifest or the
 * account directory is not what this run created: the whole cleanup is then refused.
 */
export async function resolveIntents(auth, manifest, log = () => {}) {
  const intents = Array.isArray(manifest?.intents) ? manifest.intents : [];
  const resolved = [];
  for (const intent of intents) {
    if (intent?.status === "resolved" && expectedIntentEmail(manifest, intent) && isUuid(intent.server_id ?? intent.id)) continue;
    const entry = { id: intent?.id ?? null, label: intent?.label ?? null, status: "unknown", account_id: null, error: null };
    const expected = expectedIntentEmail(manifest, intent);
    if (!expected) {
      entry.status = "rejected";
      entry.error = "intent is not a cohort intent of this manifest (email, run id, label or id invalid): never looked up";
      log(entry);
      resolved.push(entry);
      continue;
    }
    try {
      const byId = await auth.getUser(intent.id);
      const listed = await auth.findUsersByEmail(expected);
      if (!Array.isArray(listed)) throw new Error("email listing did not return a list");
      if (byId && !isCohortAccount(byId, expected)) {
        entry.status = "mismatch";
        entry.error = "the intent id belongs to an account that is not this cohort account: left untouched";
      } else if (listed.some((a) => !isCohortAccount(a, expected))) {
        entry.status = "mismatch";
        entry.error = "the email listing returned a non-cohort account: nothing adopted";
      } else if (listed.length > 1) {
        entry.error = `${listed.length} accounts carry the intent email: ambiguous`;
      } else if (listed.length === 1 && (!byId || byId.id === listed[0].id)) {
        const accountId = listed[0].id;
        for (const key of ["auth_users", "profiles"]) if (!manifest.created[key].includes(accountId)) manifest.created[key].push(accountId);
        intent.status = "resolved";
        intent.server_id = accountId;
        entry.status = "resolved";
        entry.account_id = accountId;
      } else if (!byId && listed.length === 0) {
        intent.status = "absent";
        entry.status = "absent";
      } else {
        entry.status = "mismatch";
        entry.error = "id and email reads designate different accounts";
      }
    } catch (error) {
      entry.status = "unknown";
      entry.error = String(error?.message || error);
    }
    log(entry);
    resolved.push(entry);
  }
  return resolved;
}

/**
 * The only cleanup path (normal run, crash, signal and --cleanup-manifest):
 * 1. indirect collection (optional): a failure makes the outcome of indirect rows UNKNOWN;
 * 2. intent resolution; resolved ids are written to the manifest and the manifest is SAVED
 *    before any deletion they newly authorise;
 * 3. id-only deletion plan (runCleanup).
 * `ok` is true only when every step passed AND no intent is unknown/mismatch AND the collection
 * succeeded. Anything else is INCOMPLETE (exit 3) with the reasons listed; the manifest is kept.
 */
export async function finalizeCleanup({ db, auth, manifest, collect = null, save = async () => {}, log = () => {} }) {
  const incomplete = [];
  if (collect) {
    try {
      await collect();
    } catch (error) {
      incomplete.push(`indirect collection failed (rows created by the application may be missing from the manifest): ${String(error?.message || error)}`);
    }
  }
  let intents = [];
  try {
    intents = await resolveIntents(auth, manifest, log);
  } catch (error) {
    incomplete.push(`intent resolution failed: ${String(error?.message || error)}`);
  }
  for (const entry of intents) if (entry.status !== "resolved" && entry.status !== "absent") incomplete.push(`intent ${entry.label} (${entry.id}) ${entry.status}${entry.error ? `: ${entry.error}` : ""}`);
  // A non-cohort intent or account means the manifest is not trustworthy: nothing is deleted at all.
  const untrusted = intents.some((e) => e.status === "rejected" || e.status === "mismatch");
  try {
    planCleanup(manifest);
  } catch (error) {
    return { ok: false, halted: "manifest validation", incomplete: [...incomplete, String(error?.message || error)], intents, steps: [] };
  }
  try {
    await save(manifest);
  } catch (error) {
    // Without a durable manifest no newly resolved id may be deleted.
    return { ok: false, halted: "manifest save", incomplete: [...incomplete, `manifest could not be saved before deletion: ${String(error?.message || error)}`], intents, steps: [] };
  }
  if (untrusted) return { ok: false, halted: "untrusted manifest", incomplete: [...incomplete, "deletion refused: the manifest carries an intent or account that is not this cohort's; manifest kept for manual review"], intents, steps: [] };
  const result = await runCleanup(db, manifest, log);
  return { ...result, ok: result.ok && incomplete.length === 0, incomplete, intents };
}
