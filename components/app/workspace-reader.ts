// Workspace reader (WEB-DEEPLINK-REFRESH-001, contract A5). The shell calls this module; it is
// testable with an injected `api` and observed setters.
//
// A reply is validated against the canonical shape of GET /api/workspace BEFORE anything is
// applied: defaults (EMPTY_WORKSPACE) never stand in for collections the server did not send.
// An invalid 2xx is a failure — nothing applied, no sign-out, never « introuvable ». Only a real
// 401 or a foreign identity touches the session.
import { ApiRequestError } from "./api";
import type { Role, Status, Workspace } from "./types";
import type { ReadResult } from "./workspace-refresh";
import { workspaceLimitsSchema } from "../../lib/features/workspace/detail-read";
import { clientWorkspaceCounters } from "../../shared/client-interventions";

const ROLES: readonly Role[] = ["client", "artisan", "manager", "admin"];
/** Same set as the database check constraint on interventions.status (migration 0001) and `Status`. */
const STATUSES: readonly Status[] = ["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"];
const COLLECTIONS = [
  "interventions",
  "quotes",
  "sites",
  "organizations",
  "messages",
  "documents",
  "reviews",
  "payments",
  "organization_members",
  "appointments",
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasString = (v: Record<string, unknown>, key: string) => typeof v[key] === "string" && (v[key] as string).length > 0;
const everyRecord = (list: unknown[], keys: string[]) => list.every((r) => isObject(r) && keys.every((k) => hasString(r, k)));

/** Essential ids per collection; optional fields are deliberately not validated. */
const ESSENTIAL: Partial<Record<(typeof COLLECTIONS)[number], string[]>> = {
  interventions: ["id", "status"],
  quotes: ["id", "intervention_id"],
  sites: ["id"],
  organizations: ["id"],
  messages: ["id"],
};

export type WorkspaceValidation = { ok: true; workspace: Workspace } | { ok: false; reason: string };

export function validateWorkspace(raw: unknown): WorkspaceValidation {
  if (!isObject(raw)) return { ok: false, reason: "body" };
  const profile = raw.profile;
  if (!isObject(profile) || !hasString(profile, "id") || !ROLES.includes(profile.role as Role)) return { ok: false, reason: "profile" };
  for (const key of COLLECTIONS) {
    const list = raw[key];
    if (!Array.isArray(list)) return { ok: false, reason: key };
    const keys = ESSENTIAL[key];
    if (keys && !everyRecord(list, keys)) return { ok: false, reason: key };
  }
  // Artisan offers from available_missions() are deliberately REDACTED (no client, address or
  // description): only id and status are required, and status must be a known value.
  if (!(raw.interventions as Record<string, unknown>[]).every((i) => STATUSES.includes(i.status as Status)))
    return { ok: false, reason: "interventions" };
  if (raw.artisan_profile !== null && !isObject(raw.artisan_profile)) return { ok: false, reason: "artisan_profile" };
  // accepted_total_cents (base + accepted amendments, server): optional for legacy/demo, but when
  // PRESENT it must be a safe non-negative integer — a malformed total never enters the session.
  // When PRESENT (backend 027): base total_cents a safe positive integer, accepted_total_cents a
  // safe positive integer and ≥ the base (base + accepted amendments). Absent ⇒ legacy/demo, accepted.
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  if (!(raw.quotes as Record<string, unknown>[]).every((q) => !("accepted_total_cents" in q) || (positive(q.total_cents) && positive(q.accepted_total_cents) && q.accepted_total_cents >= q.total_cents)))
    return { ok: false, reason: "quotes" };
  // Optional window metadata (older backends omit it). When present it must be exact: it decides
  // whether an absent dossier may be point-read, so a malformed value invalidates the reply.
  if (raw.limits !== undefined && !workspaceLimitsSchema.safeParse(raw.limits).success) return { ok: false, reason: "limits" };
  if (raw.client_counts !== undefined && (profile.role !== "client" || !clientWorkspaceCounters.safeParse(raw.client_counts).success))
    return { ok: false, reason: "client_counts" };
  return { ok: true, workspace: raw as unknown as Workspace };
}

export const INVALID_WORKSPACE_MESSAGE =
  "Le service a répondu sans données exploitables. Vos dossiers n’ont pas été modifiés : réessayez dans un instant.";

export type WorkspaceReaderDeps = {
  api(path: string): Promise<unknown>;
  /** Starts a read: returns its sequence number. */
  nextSeq(): number;
  /** Current sequence number: a different value means this read was superseded. */
  currentSeq(): number;
  /** Id of the user currently loaded (null before the first load). */
  expectedUser(): string | null;
  /** Applies a VALIDATED workspace (data, role, mode, context checks). */
  apply(workspace: Workspace): void;
  /** Real 401 or foreign identity: reset the session (optional message for the banner). */
  signOut(message?: string): void;
  setError(message: string): void;
};

export function createWorkspaceReader(deps: WorkspaceReaderDeps): () => Promise<ReadResult> {
  return async () => {
    const my = deps.nextSeq();
    const expectedUser = deps.expectedUser();
    deps.setError("");
    let raw: unknown;
    try {
      raw = await deps.api("/api/workspace");
    } catch (e) {
      if (my !== deps.currentSeq()) return { kind: "superseded" };
      if (e instanceof ApiRequestError && e.status === 401) {
        deps.signOut("Votre session a expiré. Reconnectez-vous pour retrouver vos dossiers.");
        return { kind: "signed_out" };
      }
      deps.setError((e as Error).message || INVALID_WORKSPACE_MESSAGE);
      return { kind: "failed", status: e instanceof ApiRequestError ? e.status : 0 };
    }
    if (my !== deps.currentSeq()) return { kind: "superseded" };
    const checked = validateWorkspace(raw);
    if (!checked.ok) {
      // Nothing applied, session kept: an unusable 2xx proves nothing about the account.
      deps.setError(INVALID_WORKSPACE_MESSAGE);
      return { kind: "failed", status: 200, reason: "invalid_response" };
    }
    if (expectedUser && checked.workspace.profile!.id !== expectedUser) {
      // Identity changed under us: discard and reset instead of mixing accounts.
      deps.signOut();
      return { kind: "signed_out" };
    }
    deps.apply(checked.workspace);
    return { kind: "loaded" };
  };
}
