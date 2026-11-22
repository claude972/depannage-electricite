// Pure decisions of the normalized leaf (contract WEB-SHARED-001 + amendments A1/A2):
// authority display (never widened), remount key on scope change, stale-result handling.
import type { SiteOperationsCommandResult, SiteOperationsReport, SiteOperationsScope } from "./types";

export type ResolvedAuthority = { canWrite: boolean; canWriteOrganization: boolean; readOnlyReason: string | null };
export const GENERIC_FAILURE = "L’action n’a pas pu être réalisée. Réessayez.";
export const BUSY_MESSAGE = "Une autre action est en cours. Patientez un instant.";
export const SERVER_READ_ONLY = "Le serveur n’autorise pas de modification sur ce site pour votre compte.";
export const SCOPE_READ_ONLY = "Votre accès à ce site est en lecture seule.";
export const AUTHORITY_UNVERIFIED = "Vos droits n’ont pas pu être vérifiés : les modifications sont désactivées jusqu’au prochain chargement.";
export const STALE_CONTEXT = "Le contexte de votre session a changé : actualisez les données avant toute modification.";
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
export function resolveAuthority(scope: SiteOperationsScope, report: SiteOperationsReport | null, stale = false): ResolvedAuthority {
  if (!scope.authority.canWrite) return { canWrite: false, canWriteOrganization: false, readOnlyReason: scope.authority.reason ?? SCOPE_READ_ONLY };
  // Fail closed: without a fresh server answer (refusal, failure, stale chain) nothing is writable.
  if (!report) return { canWrite: false, canWriteOrganization: false, readOnlyReason: AUTHORITY_UNVERIFIED };
  if (stale) return { canWrite: false, canWriteOrganization: false, readOnlyReason: STALE_CONTEXT };
  if (!report.snapshot.limits.can_write_site) return { canWrite: false, canWriteOrganization: false, readOnlyReason: SERVER_READ_ONLY };
  return { canWrite: true, canWriteOrganization: report.snapshot.limits.can_write_organization, readOnlyReason: null };
}
/** Displayed data after a load: a failure invalidates everything, a stale answer freezes it. */
export type LoadState = { report: SiteOperationsReport | null; error: string; stale: boolean };
export type LoadResult = { kind: "ok"; report: SiteOperationsReport } | { kind: "error"; message: string } | { kind: "stale" };
export const INITIAL_LOAD: LoadState = { report: null, error: "", stale: false };
export function applyLoadResult(previous: LoadState, result: LoadResult): LoadState {
  if (result.kind === "ok") return { report: result.report, error: "", stale: false };
  // 403/404 (context invalidated) or 503: the previous report is no longer trustworthy.
  if (result.kind === "error") return { report: null, error: result.message, stale: false };
  // null from the injected client: no data update, but nothing stays actionable until a fresh load.
  return { report: previous.report, error: "", stale: true };
}
export const messageOf = (error: unknown): string => (error instanceof Error && error.message ? error.message : GENERIC_FAILURE);
/** Maps the injected client's command result: null means a stale chain (no success, no update). */
export function outcomeOf(result: SiteOperationsCommandResult | null, alive = true): RunOutcome {
  if (!alive || result === null) return { status: "stale" };
  return { status: "done", result };
}

/**
 * Fiscal year effectively shown by the budget panel, derived at every render (no effect loop):
 * the user's explicit choice while it still exists in the refreshed report, otherwise the current
 * fiscal year, otherwise the first listed one, otherwise none. Fixes the dead end where the panel
 * mounted with 0 years kept an empty selection after the first year was created.
 */
export function effectiveFiscalYearId(selected: string, years: { id: string }[], currentId: string | null): string {
  if (selected && years.some((y) => y.id === selected)) return selected;
  if (currentId && years.some((y) => y.id === currentId)) return currentId;
  return years[0]?.id ?? "";
}
/** After a fiscal year is created: select it when it covers `today` (UTC date), else keep the choice. */
export function selectionAfterYearCreated(previous: string, created: unknown, today: string): string {
  const row = created as { id?: unknown; starts_on?: unknown; ends_on?: unknown } | null;
  if (!row || typeof row.id !== "string" || typeof row.starts_on !== "string" || typeof row.ends_on !== "string") return previous;
  return row.starts_on <= today && row.ends_on >= today ? row.id : previous;
}
