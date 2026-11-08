// SUP — strict check of a POST /api/support receipt (api() does not validate a 200 shape). A
// receipt is a success only if it is exactly the command that was sent: UUID ticket owned by the
// sender, same subject and dossier, initial message version 1 of that ticket with the same body,
// boolean `replayed`. Anything else stays UNCERTAIN (the caller keeps the command for an exact resend).
import type { SupportCreateResult } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SupportCreateCommand = { request_id: string; subject: string; body: string; intervention_id: string | null };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validSupportReceipt(result: unknown, cmd: SupportCreateCommand, ownerId: string | null): result is SupportCreateResult {
  if (!obj(result) || !obj(result.ticket) || !obj(result.initial_message) || typeof result.replayed !== "boolean") return false;
  const t = result.ticket, m = result.initial_message;
  if (typeof t.id !== "string" || !UUID.test(t.id)) return false;
  if (!ownerId || t.creator_id !== ownerId) return false;
  if (t.subject !== cmd.subject || (t.intervention_id ?? null) !== cmd.intervention_id) return false;
  if (m.version !== 1 || m.ticket_id !== t.id || m.body !== cmd.body) return false;
  return true;
}
export const UNVERIFIED_RECEIPT =
  "La réponse de la plateforme n’a pas pu être vérifiée. Votre demande est conservée pour être renvoyée à l’identique.";
