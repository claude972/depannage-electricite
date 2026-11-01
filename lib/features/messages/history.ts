import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MESSAGE_FIELDS = "id,intervention_id,author_id,body,created_at";
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true }).max(40);
const cursorSchema = z.object({ v: z.literal(1), intervention_id: uuid, created_at: timestamp, id: uuid }).strict();
const messageSchema = z.object({ id: uuid, intervention_id: uuid, author_id: uuid, body: z.string(), created_at: timestamp }).strict();
export class MessageHistoryError extends Error {
  constructor(public status: 404 | 422 | 503) {
    super(status === 404 ? "Ce dossier est introuvable." : status === 422 ? "Vérifiez les filtres ou rechargez la conversation sans son ancien curseur." : "Les messages sont momentanément indisponibles. Réessayez.");
  }
}
export function messageHistoryQuery(url: string) {
  const params = new URL(url).searchParams;
  const invalid = (): never => { throw new MessageHistoryError(422); };
  if (url.length > 4096) invalid();
  for (const key of params.keys()) if (!["intervention_id", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1) invalid();
  const id = uuid.safeParse(params.get("intervention_id"));
  if (!id.success) invalid();
  const interventionId = id.data!.toLowerCase();
  const text = params.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(text)) invalid();
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (params.has("cursor")) {
    const raw = params.get("cursor")!;
    if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
    try {
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.toString("base64url") !== raw) invalid();
      const parsed = cursorSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success || parsed.data.intervention_id !== interventionId) invalid();
      cursor = parsed.data!;
    } catch { invalid(); }
  }
  return { interventionId, limit: Number(text), cursor };
}
/** The supplied client must carry the authenticated user's JWT; RLS remains authoritative. */
export async function readMessageHistory(db: SupabaseClient, input: ReturnType<typeof messageHistoryQuery>) {
  try {
    // Distinguish an accessible empty conversation from an inaccessible/nonexistent dossier.
    // Never probe messages when its parent is hidden, including revoked organisation/site access.
    const parent = await db.from("interventions").select("id").eq("id", input.interventionId).limit(2);
    if (parent.error || !Array.isArray(parent.data) || parent.data.length > 1) throw new MessageHistoryError(503);
    if (!parent.data.length) throw new MessageHistoryError(404);
    if (parent.data[0]?.id !== input.interventionId) throw new MessageHistoryError(503);
    let query = db.from("messages").select(MESSAGE_FIELDS).eq("intervention_id", input.interventionId);
    if (input.cursor) {
      const c = input.cursor;
      query = query.or(`created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt.${c.id})`);
    }
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1);
    if (result.error) throw new MessageHistoryError(503);
    const parsed = z.array(messageSchema).max(input.limit + 1).safeParse(result.data);
    if (!parsed.success || parsed.data.some(row => row.intervention_id !== input.interventionId)) throw new MessageHistoryError(503);
    const messages = parsed.data.slice(0, input.limit), hasMore = parsed.data.length > input.limit;
    const last = messages.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, intervention_id: input.interventionId, created_at: last.created_at, id: last.id })).toString("base64url") : null;
    return { messages, page: { limit: input.limit, has_more: hasMore, next_cursor: next } };
  } catch (error) {
    if (error instanceof MessageHistoryError) throw error;
    throw new MessageHistoryError(503);
  }
}
