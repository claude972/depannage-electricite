import { ApiError, dbError } from "@/lib/supabase/server";
import type { authenticatedClient } from "@/lib/supabase/server";
export type SupportOperatorPermissions = { can_read_all: boolean; can_reply_all: boolean; can_set_status_all: boolean };
type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];
/** Reject unknown/malformed data: a failed rights probe must never become a creator/operator grant. */
export function decodeSupportOperatorPermissions(value: unknown): SupportOperatorPermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(503, "Les droits de l’assistance sont indisponibles.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 3 || typeof data.can_read_all !== "boolean" || typeof data.can_reply_all !== "boolean" || typeof data.can_set_status_all !== "boolean" || (!data.can_read_all && (data.can_reply_all || data.can_set_status_all))) throw new ApiError(503, "Les droits de l’assistance sont indisponibles.");
  return { can_read_all: data.can_read_all, can_reply_all: data.can_reply_all, can_set_status_all: data.can_set_status_all };
}
export async function supportOperatorPermissions(db: Database): Promise<SupportOperatorPermissions> {
  const result = await db.rpc("support_operator_permissions");
  dbError(result.error);
  return decodeSupportOperatorPermissions(result.data);
}
/** Call only for a ticket already admitted by RLS; own-ticket access still follows 011. */
export function supportTicketPermissions(rights: SupportOperatorPermissions, userId: string, ticket: { creator_id: string; status: string }) {
  return { can_reply: rights.can_reply_all ? ticket.status !== "resolved" : ticket.creator_id === userId, can_set_status: rights.can_set_status_all };
}
