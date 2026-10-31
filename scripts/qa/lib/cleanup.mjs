// Cleanup plan and execution. Deletes ONLY ids listed in the manifest, in foreign-key order,
// with an exact-count readback after every step. Never a name pattern, never a date range.
import { isUuid } from "./cohort.mjs";

/** Manifest keys holding id lists. `storage_paths` holds Storage object paths. */
export const MANIFEST_KEYS = [
  "auth_users",
  "profiles",
  "organizations",
  "sites",
  "interventions",
  "quotes",
  "documents",
  "storage_paths",
  "support_tickets",
];

/**
 * Ordered steps. `ids` names the manifest list used as filter values; `column` the column
 * filtered with `in.(...)`. Children always precede their parents (verified by a unit test).
 */
export const CLEANUP_STEPS = [
  { kind: "table", table: "support_events", column: "ticket_id", ids: "support_tickets" },
  { kind: "table", table: "support_messages", column: "ticket_id", ids: "support_tickets" },
  { kind: "table", table: "support_tickets", column: "id", ids: "support_tickets" },
  { kind: "table", table: "quote_drafts", column: "intervention_id", ids: "interventions" },
  { kind: "storage", bucket: "intervention-documents", ids: "storage_paths" },
  { kind: "table", table: "documents", column: "id", ids: "documents" },
  { kind: "table", table: "documents", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "messages", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "intervention_operation_events", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "intervention_appointments", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "intervention_reports", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "approvals", column: "site_id", ids: "sites" },
  { kind: "table", table: "quotes", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "audit_log", column: "intervention_id", ids: "interventions" },
  { kind: "table", table: "audit_log", column: "actor_id", ids: "profiles" },
  { kind: "table", table: "action_limits", column: "actor_id", ids: "profiles" },
  { kind: "table", table: "interventions", column: "id", ids: "interventions" },
  { kind: "table", table: "organization_member_site_grants", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_member_site_scopes", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_invitations", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "organization_membership_events", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "professional_audit", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "approval_rules", column: "site_id", ids: "sites", optional: true },
  { kind: "table", table: "compliance_records", column: "site_id", ids: "sites", optional: true },
  { kind: "table", table: "contracts", column: "organization_id", ids: "organizations", optional: true },
  { kind: "table", table: "organization_members", column: "organization_id", ids: "organizations" },
  { kind: "table", table: "sites", column: "id", ids: "sites" },
  { kind: "table", table: "organizations", column: "id", ids: "organizations" },
  { kind: "table", table: "artisan_credentials", column: "user_id", ids: "profiles" },
  { kind: "table", table: "artisan_profiles", column: "user_id", ids: "profiles" },
  { kind: "table", table: "profiles", column: "id", ids: "profiles" },
  { kind: "auth", ids: "auth_users" },
];

/** Parent → children that must be deleted before it (FK dependencies covered by the plan). */
export const FK_PARENTS = {
  support_tickets: ["support_events", "support_messages"],
  interventions: ["quote_drafts", "documents", "messages", "quotes", "audit_log", "intervention_operation_events", "intervention_appointments", "intervention_reports"],
  quotes: ["approvals", "quote_drafts"],
  profiles: ["interventions", "quotes", "documents", "support_tickets", "audit_log", "action_limits", "organization_members", "artisan_profiles", "artisan_credentials", "organizations"],
  organizations: ["sites", "organization_members", "organization_invitations", "organization_membership_events", "professional_audit", "organization_member_site_scopes", "organization_member_site_grants", "contracts"],
  sites: ["interventions", "organization_member_site_grants", "approval_rules", "approvals", "compliance_records"],
  organization_member_site_scopes: ["organization_member_site_grants"],
  organization_members: ["organization_member_site_scopes"],
};

export function emptyManifest(context = {}) {
  const created = {};
  for (const key of MANIFEST_KEYS) created[key] = [];
  return { version: 1, ...context, created_at: new Date().toISOString(), created };
}

/** Concrete operations for a manifest: empty id lists are skipped; non-UUID ids are refused. */
export function planCleanup(manifest) {
  const created = manifest?.created || {};
  const ops = [];
  for (const step of CLEANUP_STEPS) {
    const ids = [...new Set(created[step.ids] || [])];
    if (!ids.length) continue;
    if (step.kind !== "storage")
      for (const id of ids) if (!isUuid(id)) throw new Error(`refusing cleanup: ${step.ids} contains a non-UUID id`);
    ops.push({ ...step, values: ids });
  }
  return ops;
}

/** Validates that every child table appears before its parent in CLEANUP_STEPS. */
export function orderViolations(steps = CLEANUP_STEPS) {
  const tables = steps.filter((s) => s.kind === "table").map((s) => s.table);
  const lastIndex = (t) => tables.lastIndexOf(t);
  const firstIndex = (t) => tables.indexOf(t);
  const violations = [];
  for (const [parent, children] of Object.entries(FK_PARENTS)) {
    if (firstIndex(parent) < 0) continue;
    for (const child of children) {
      if (firstIndex(child) < 0) continue;
      if (lastIndex(child) > firstIndex(parent)) violations.push(`${child} must be deleted before ${parent}`);
    }
  }
  if (steps.findIndex((s) => s.kind === "auth") !== steps.length - 1) violations.push("auth users must be the last step");
  return violations;
}

const chunk = (list, size = 60) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Executes the plan. `db` is the service client (lib/supabase.mjs). Returns
 * {ok, steps:[{step, deleted, remaining, status, error}]}. Never throws for a single failure.
 */
export async function runCleanup(db, manifest, log = () => {}) {
  const results = [];
  let ok = true;
  const ops = planCleanup(manifest);
  for (const op of ops) {
    const entry = { kind: op.kind, table: op.table || op.bucket || "auth.users", column: op.column || null, requested: op.values.length, remaining: null, status: "pass", error: null };
    try {
      if (op.kind === "table") {
        for (const part of chunk(op.values)) await db.delete(op.table, { [op.column]: `in.(${part.join(",")})` });
        let remaining = 0;
        for (const part of chunk(op.values)) remaining += await db.count(op.table, { [op.column]: `in.(${part.join(",")})` });
        entry.remaining = remaining;
        if (remaining !== 0) throw new Error(`${remaining} row(s) still present`);
      } else if (op.kind === "storage") {
        for (const part of chunk(op.values)) await db.storageRemove(op.bucket, part);
        const prefixes = new Set(op.values.map((p) => p.split("/")[0]).filter(Boolean));
        let remaining = 0;
        for (const prefix of prefixes) {
          const listed = await db.storageList(op.bucket, prefix);
          remaining += listed.filter((o) => op.values.includes(`${prefix}/${o.name}`)).length;
        }
        entry.remaining = remaining;
        if (remaining !== 0) throw new Error(`${remaining} object(s) still present`);
      } else if (op.kind === "auth") {
        let remaining = 0;
        for (const id of op.values) {
          await db.deleteAuthUser(id);
          if (await db.authUserExists(id)) remaining++;
        }
        entry.remaining = remaining;
        if (remaining !== 0) throw new Error(`${remaining} auth user(s) still present`);
      }
    } catch (error) {
      if (op.optional && /42P01|does not exist|PGRST205|column .* does not exist/i.test(String(error?.message))) {
        entry.status = "skipped";
        entry.error = "table or column absent on this schema";
      } else {
        entry.status = "fail";
        entry.error = String(error?.message || error);
        ok = false;
      }
    }
    log(entry);
    results.push(entry);
  }
  return { ok, steps: results };
}
