// Pure helpers of the assistance leaf (A5 operator queue). No React; tested by tests/ui/support-lists.test.ts.
import type { SupportCommand, SupportCommandResult, SupportEvent, SupportMessage, SupportStatus, SupportTicket } from "../app/types";

export type SupportQueue = "mine" | "all";

/**
 * Author label of a message. Own messages read "Vous". In the requester's queue ("mine") every
 * platform-side author (admin or scoped operator) is "Assistance": the requester need not tell them
 * apart. In the operator queue ("all") the requester is "Demandeur", a scoped operator "Opérateur"
 * and an administrator "Assistance".
 */
export function authorLabel(message: SupportMessage | null, ctx: { viewerId: string; queue: SupportQueue }): string {
  if (!message) return "Assistance";
  if (message.author_id === ctx.viewerId) return "Vous";
  if (ctx.queue === "mine") return message.author_kind === "user" ? "Vous" : "Assistance";
  switch (message.author_kind) {
    case "user":
      return "Demandeur";
    case "operator":
      return "Opérateur";
    default:
      return "Assistance";
  }
}

/** View that lists the tickets of a queue (the operator queue has its own hash view). */
export function supportListView(queue: SupportQueue): "support" | "support-queue" {
  return queue === "all" ? "support-queue" : "support";
}

export const QUEUE_READ_ONLY =
  "Lecture seule : vos droits d’assistance ne permettent pas de répondre ni de changer le statut.";

/** Status changes the server accepts from each state (same table as the admin centre, contract 011). */
export const SUPPORT_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  open: ["in_progress", "awaiting_user", "resolved"],
  in_progress: ["awaiting_user", "resolved"],
  awaiting_user: ["in_progress", "resolved"],
  resolved: ["in_progress"],
};

/** Targets offered to the viewer: none unless the server granted can_set_status for this ticket. */
export function statusTargets(current: SupportStatus, canSetStatus: boolean): readonly SupportStatus[] {
  return canSetStatus ? SUPPORT_TRANSITIONS[current] : [];
}

export type StatusOutcome =
  | { kind: "ok"; ticket: SupportTicket; event: SupportEvent }
  | { kind: "conflict"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "skipped"; message: string };

/**
 * One status command with the exact expected version (CAS). Refuses locally, without any request,
 * a target the server did not offer for this ticket; otherwise the server decides (409 = conflict,
 * any other refusal shown as written).
 */
export async function runStatusCommand(
  send: (command: SupportCommand) => Promise<SupportCommandResult>,
  ticket: Pick<SupportTicket, "status" | "version">,
  canSetStatus: boolean,
  next: SupportStatus,
): Promise<StatusOutcome> {
  if (!statusTargets(ticket.status, canSetStatus).includes(next))
    return { kind: "skipped", message: "Ce changement d’état n’est pas proposé pour cette demande." };
  const result = await send({ action: "set_status", expected_version: ticket.version, status: next });
  if (result.ok) return { kind: "ok", ticket: result.ticket, event: result.event };
  return result.conflict ? { kind: "conflict", message: result.message } : { kind: "refused", message: result.message };
}
