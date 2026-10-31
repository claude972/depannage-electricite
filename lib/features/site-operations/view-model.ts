// Pure decisions of the normalized leaf (contract WEB-SHARED-001 + amendments A1/A2):
// authority display (never widened), remount key on scope change, stale-result handling.
import type { SiteOperationsCommandResult, SiteOperationsReport, SiteOperationsScope } from "./types";

export type ResolvedAuthority = { canWrite: boolean; canWriteOrganization: boolean; readOnlyReason: string | null };
export const GENERIC_FAILURE = "L’action n’a pas pu être réalisée. Réessayez.";
export const BUSY_MESSAGE = "Une autre action est en cours. Patientez un instant.";
export const SERVER_READ_ONLY = "Le serveur n’autorise pas de modification sur ce site pour votre compte.";
export const SCOPE_READ_ONLY = "Votre accès à ce site est en lecture seule.";
export type RunOutcome =
  | { status: "done"; result: SiteOperationsCommandResult }
  | { status: "failed"; message: string }
  | { status: "stale" };

/** Any change of user, organisation or site remounts the content (forms, drafts, data cleared). */
export const scopeKey = (scope: SiteOperationsScope) => `${scope.userId}|${scope.organizationId ?? ""}|${scope.siteId ?? ""}`;

/**
 * The lead's authority is the ceiling; the server's flags can only restrict further. A viewer,
 * a revoked grant or a server refusal all end read-only with the reason shown.
 */
export function resolveAuthority(scope: SiteOperationsScope, report: SiteOperationsReport | null): ResolvedAuthority {
  if (!scope.authority.canWrite) return { canWrite: false, canWriteOrganization: false, readOnlyReason: scope.authority.reason ?? SCOPE_READ_ONLY };
  if (report && !report.snapshot.limits.can_write_site) return { canWrite: false, canWriteOrganization: false, readOnlyReason: SERVER_READ_ONLY };
  return { canWrite: true, canWriteOrganization: !!report && report.snapshot.limits.can_write_organization, readOnlyReason: null };
}
export const messageOf = (error: unknown): string => (error instanceof Error && error.message ? error.message : GENERIC_FAILURE);
/** Maps the injected client's command result: null means a stale chain (no success, no update). */
export function outcomeOf(result: SiteOperationsCommandResult | null, alive = true): RunOutcome {
  if (!alive || result === null) return { status: "stale" };
  return { status: "done", result };
}
