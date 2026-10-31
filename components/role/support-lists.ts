// Pure helpers of the assistance leaf (A5 operator queue). No React; tested by tests/ui/support-lists.test.ts.
import type { SupportMessage } from "../app/types";

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
