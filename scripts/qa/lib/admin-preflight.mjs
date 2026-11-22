// Admin preflight (migration 014, last-super-admin guard). The admin suite may only create its QA
// admin fixture when at least ONE real super admin exists: otherwise the guard would refuse the
// deletion of the QA admin at cleanup (it would be the last admin). This module only COUNTS real
// admins through the service client (read-only, cohort ids excluded); it never reads their data,
// never modifies, bans or deletes any non-cohort account.
export const ADMIN_BLOCKED_REASON = "suite admin non exécutable : aucun super administrateur réel, la garde 014 bloquerait le nettoyage";

/** PostgREST filter: profiles with role=admin, excluding the given cohort ids (never a name/date). */
export function realAdminFilter(excludeIds = []) {
  const ids = [...new Set(excludeIds.filter((id) => typeof id === "string" && id))];
  const filter = { role: "eq.admin" };
  if (ids.length) filter.id = `not.in.(${ids.join(",")})`;
  return filter;
}

/** Exact count of real super admins (cohort profiles excluded). Read-only: one HEAD count request. */
export async function countRealSuperAdmins(db, { excludeIds = [] } = {}) {
  const count = await db.count("profiles", realAdminFilter(excludeIds));
  if (!Number.isInteger(count) || count < 0) throw new Error("admin preflight: exact count of real admins unavailable");
  return count;
}

/**
 * Verdict before the admin suite creates anything: ok only when >= 1 real super admin exists.
 * `manifest.created.profiles` lists every cohort profile (superset of `admin_profiles`).
 */
export async function adminPreflight(db, manifest) {
  const excludeIds = [...(manifest?.created?.profiles || []), ...(manifest?.created?.admin_profiles || [])];
  const realAdmins = await countRealSuperAdmins(db, { excludeIds });
  if (realAdmins >= 1) return { ok: true, realAdmins, reason: null };
  return { ok: false, realAdmins, reason: ADMIN_BLOCKED_REASON };
}
