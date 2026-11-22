// SYS-04 / M62 — message read confirmations, pure model. Contract (cbd0d2b,
// app/api/messages/read-state/route.ts):
//   POST /api/messages/read-state { action: "state"|"mark_read", intervention_id: UUID,
//        message_ids: UUID[] (1–100, distinct, of THIS dossier) } → { rows: [{ message_id, read }] }
//   Same ids in the same order (lower-cased). mark_read accepts RECEIVED messages only and answers
//   read: true for each. For a message written by the current account, read = another participant
//   confirmed it; for a received message, read concerns the current account only.
//   An error or a missing reply confirms NOTHING.
export const READ_STATE_PATH = "/api/messages/read-state";
export const READ_BATCH = 100;
export type Context = { generation(): number; userId(): string | null };
/** Structural message shape (not coupled to the app Message type). */
export type ReadMessage = { id: string; intervention_id: string | null | undefined; author_id: string };
export type ReadStatus = "read" | "sent" | "unread" | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const chunks = <T,>(list: T[], size = READ_BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
/** Distinct lower-cased UUIDs of the thread's messages, in their order. */
export function threadIds(messages: readonly ReadMessage[], interventionId: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of messages) {
    const id = m.id.toLowerCase();
    if (!UUID.test(id) || (m.intervention_id ?? "").toLowerCase() !== interventionId.toLowerCase() || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
/** Rows for exactly these ids in this order; mark_read must answer read: true for each. Else null. */
export function parseRows(body: unknown, ids: string[], mark: boolean): { message_id: string; read: boolean }[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "rows") return null;
  const rows = (body as { rows: unknown }).rows;
  if (!Array.isArray(rows) || rows.length !== ids.length) return null;
  const out: { message_id: string; read: boolean }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || Object.keys(r).length !== 2 || typeof r.message_id !== "string" || typeof r.read !== "boolean") return null;
    if (r.message_id.toLowerCase() !== ids[i] || (mark && !r.read)) return null;
    out.push({ message_id: ids[i], read: r.read });
  }
  return out;
}
/** Rows, null (error: confirms nothing) or "unavailable" (404: the route / thread is not offered — silent). */
export async function postReadState(fetcher: typeof fetch, action: "state" | "mark_read", interventionId: string, ids: string[], signal?: AbortSignal): Promise<{ message_id: string; read: boolean }[] | null | "unavailable"> {
  try {
    const r = await fetcher(READ_STATE_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, intervention_id: interventionId.toLowerCase(), message_ids: ids }),
      ...(signal ? { signal } : {}),
    });
    if (r.status === 404) return "unavailable";
    if (!r.ok) return null;
    return parseRows(await r.json().catch(() => null), ids, action === "mark_read");
  } catch {
    return null;
  }
}
/** Label semantics: own message ⇒ « Lu » only on proof, « Envoyé » when known not read; received ⇒ read/unread. */
export function statusFor(message: ReadMessage | undefined, uid: string | null, state: ReadonlyMap<string, boolean>): ReadStatus {
  if (!message || !uid) return null;
  const known = state.get(message.id.toLowerCase());
  if (known === undefined) return null; // unknown (old history, not read yet): no label
  if (message.author_id.toLowerCase() === uid.toLowerCase()) return known ? "read" : "sent";
  return known ? "read" : "unread";
}
export const READ_COPY = {
  read: "Lu",
  sent: "Envoyé",
  markRead: "Marquer comme lus",
  marking: "Enregistrement…",
  refresh: "Actualiser",
  loading: "Vérification des lectures…",
  failed: "L’état de lecture n’a pas pu être vérifié. Rien n’est considéré comme lu.",
  markFailed: "La lecture n’a pas pu être enregistrée. Réessayez.",
  retry: "Réessayer",
} as const;
