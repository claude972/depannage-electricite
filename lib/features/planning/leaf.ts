// Leaf-component contract (amendment A1 of docs/CLAUDE_ADV_PLANNING_CONTRACT.md, aligned with
// docs/CLAUDE_WEB_SHARED_CONTRACT.md). No import from components/app/*: the lead maps its
// session onto these shapes. Pure helpers here carry the rules a renderer test cannot exercise.
import type { PlanningCommand, PlanningCommandResult, PlanningView } from "./types";

export type ContractState = "unknown" | "available" | "missing" | "unavailable";
export type LeafRole = "client" | "artisan" | "manager" | "admin";
export type LeafScope = {
  userId: string;
  role: LeafRole;
  organizationId?: string;
  siteId?: string;
  authority: { canWrite: boolean; reason?: string };
};
/** Injected by the integrator; every function resolves null when the identity chain is stale. */
export interface PlanningClient {
  load(range: { from: string; to: string }): Promise<PlanningView | null>;
  command(body: PlanningCommand): Promise<PlanningCommandResult | null>;
}
/** Mount key: any change of user/organization/site remounts the leaf, wiping forms and data. */
export function scopeKey(scope: Pick<LeafScope, "userId" | "organizationId" | "siteId">): string {
  return `${scope.userId}|${scope.organizationId ?? ""}|${scope.siteId ?? ""}`;
}
export type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };
/** A null answer (stale chain) leaves the previous state untouched: no spinner reset, no data. */
export function reduceLoad<T>(previous: LoadState<T>, answer: T | null | { error: string }): LoadState<T> {
  if (answer === null) return previous;
  if (typeof answer === "object" && answer !== null && "error" in answer && Object.keys(answer).length === 1)
    return { status: "error", message: (answer as { error: string }).error };
  return { status: "ready", data: answer as T };
}
export type CommandOutcome =
  | { kind: "stale" }
  | { kind: "success"; replayed: boolean }
  | { kind: "conflict"; message: string }
  | { kind: "refused"; message: string };
/** Maps a client answer to what the UI may do. Stale answers never produce a success message. */
export function reduceCommand(result: PlanningCommandResult | null): CommandOutcome {
  if (result === null) return { kind: "stale" };
  if (!result.ok) return result.conflict ? { kind: "conflict", message: result.message } : { kind: "refused", message: result.message };
  const replayed = "replayed" in result.data ? Boolean(result.data.replayed) : false;
  return { kind: "success", replayed };
}
/** Write controls exist only when both the integrator scope and the server view allow it. */
export function canEdit(scope: LeafScope, view: PlanningView | null): { allowed: boolean; reason: string | null } {
  if (!scope.authority.canWrite) return { allowed: false, reason: scope.authority.reason ?? "Votre compte ne permet pas de modifier le planning." };
  if (view && !view.permissions.can_edit) return { allowed: false, reason: view.permissions.reason ?? "Le planning est en lecture seule." };
  return { allowed: true, reason: null };
}
export const PLANNING_COPY = {
  emptyRules: "Aucune disponibilité déclarée. Ajoutez vos plages habituelles pour proposer des créneaux.",
  emptyWeek: "Rien de prévu cette semaine.",
  loadError: "Le planning n’a pas pu être chargé.",
  conflictHint: "Le planning a changé entre-temps. Rechargez la semaine puis réessayez.",
  readOnly: "Lecture seule",
  demo: "Démonstration : les données affichées sont fictives et aucune modification n’est enregistrée.",
};
