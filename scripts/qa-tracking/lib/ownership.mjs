// Remote ownership validation BEFORE cleanup (A5.4) and canonical QA e-mails. An id that cannot
// be proven to belong to this run's cohort is never deleted and makes the cleanup INCOMPLETE.
import { isUuid } from "../../qa/lib/cohort.mjs";

export const canonicalEmailPattern = (runId) => {
  if (!/^[0-9a-f]{12}$/.test(String(runId))) throw new Error("invalid run id");
  return new RegExp(`^qa-${runId}-[a-z0-9]+(?:-[a-z0-9]+)*@qa\\.invalid$`);
};
/** Validated BEFORE any lookup by e-mail. */
export function assertCanonicalEmail(email, runId) {
  if (typeof email !== "string" || !canonicalEmailPattern(runId).test(email)) throw new Error(`refusing lookup: "${String(email).slice(0, 80)}" is not a canonical QA e-mail of run ${runId}`);
  return email;
}

/**
 * Pure proof over remote rows. Inputs: the manifest, the run id, `emails` (Map auth id → e-mail
 * read with the service key, or null when absent), intervention/organization/site rows read by id.
 * Returns {manifest: proven-only copy, unproven: [{key, id, why}]}.
 */
export function proveOwnership({ manifest, runId, emails, interventions = [], organizations = [], sites = [] }) {
  const pattern = canonicalEmailPattern(runId);
  const created = manifest?.created || {};
  const unproven = [];
  const proven = { ...manifest, created: {} };
  for (const key of Object.keys(created)) proven.created[key] = [];
  const keep = (key, id) => proven.created[key].push(id);
  const users = new Set();
  for (const id of new Set([...(created.auth_users || []), ...(created.profiles || [])])) {
    const email = emails.get(id);
    if (isUuid(id) && typeof email === "string" && pattern.test(email)) users.add(id);
    else if (email === null) users.add(id); // already deleted remotely: nothing left to prove or delete
    else unproven.push({ key: "profiles", id, why: email === undefined ? "Auth read unknown (error or malformed body)" : "e-mail is not a canonical QA e-mail of this run" });
  }
  for (const id of created.auth_users || []) if (users.has(id)) keep("auth_users", id);
  for (const id of created.profiles || []) if (users.has(id)) keep("profiles", id);
  for (const id of created.admin_profiles || []) if (users.has(id)) keep("admin_profiles", id);
  const jobById = new Map(interventions.map((r) => [r.id, r]));
  for (const id of created.interventions || []) {
    const row = jobById.get(id);
    if (!row) keep("interventions", id); // absent remotely: deleting by id is a no-op
    else if (users.has(row.client_id) && (row.artisan_id === null || users.has(row.artisan_id))) keep("interventions", id);
    else unproven.push({ key: "interventions", id, why: "client or artisan not in this run's cohort" });
  }
  const orgById = new Map(organizations.map((r) => [r.id, r]));
  const orgs = new Set();
  for (const id of created.organizations || []) {
    const row = orgById.get(id);
    if (!row || users.has(row.owner_id)) {
      keep("organizations", id);
      orgs.add(id);
    } else unproven.push({ key: "organizations", id, why: "owner not in this run's cohort" });
  }
  const siteById = new Map(sites.map((r) => [r.id, r]));
  for (const id of created.sites || []) {
    const row = siteById.get(id);
    if (!row || orgs.has(row.organization_id)) keep("sites", id);
    else unproven.push({ key: "sites", id, why: "organization not in this run's cohort" });
  }
  for (const key of Object.keys(created)) {
    if (["auth_users", "profiles", "admin_profiles", "interventions", "organizations", "sites"].includes(key)) continue;
    for (const id of created[key]) unproven.push({ key, id, why: "this harness never creates this kind of record" });
  }
  return { manifest: proven, unproven };
}

/** Reads what proveOwnership needs, with the service client and the Auth admin helper. */
export async function readOwnership(db, auth, manifest) {
  const created = manifest?.created || {};
  const emails = new Map();
  // found ⇒ e-mail from a schema-valid body; real 404 ⇒ null (absent); anything else ⇒ undefined (unknown, never owned).
  for (const id of new Set([...(created.auth_users || []), ...(created.profiles || [])])) {
    const read = isUuid(id) ? await auth.readUser(id) : { state: "unknown" };
    emails.set(id, read.state === "found" ? read.email : read.state === "absent" ? null : undefined);
  }
  const byIds = async (table, ids, columns) => (ids?.length ? db.select(table, { id: `in.(${ids.filter(isUuid).join(",")})` }, columns) : []);
  return {
    emails,
    interventions: await byIds("interventions", created.interventions, "id,client_id,artisan_id"),
    organizations: await byIds("organizations", created.organizations, "id,owner_id"),
    sites: await byIds("sites", created.sites, "id,organization_id"),
  };
}
