import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCUMENT_HISTORY_FIELDS = "id,intervention_id,owner_id,name,mime_type,created_at";
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true }).max(40);
const cursorSchema = z.object({ v: z.literal(1), user_id: uuid, intervention_id: uuid.nullable(), created_at: timestamp, id: uuid }).strict();
const documentSchema = z.object({ id: uuid, intervention_id: uuid.nullable(), owner_id: uuid, name: z.string(), mime_type: z.string(), created_at: timestamp }).strict();
export class DocumentHistoryError extends Error {
  constructor(public status: 404 | 422 | 503) {
    super(status === 404 ? "Ce dossier est introuvable." : status === 422 ? "Vérifiez les filtres ou rechargez les documents sans leur ancien curseur." : "Les documents sont momentanément indisponibles. Réessayez.");
  }
}
export function documentHistoryQuery(url: string, userId: string) {
  const params = new URL(url).searchParams;
  const invalid = (): never => { throw new DocumentHistoryError(422); };
  if (url.length > 4096) invalid();
  for (const key of params.keys()) if (!["intervention_id", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1) invalid();
  const id = uuid.nullable().safeParse(params.get("intervention_id"));
  if (!id.success) invalid();
  const interventionId = id.data?.toLowerCase() ?? null;
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
      if (!parsed.success || parsed.data.intervention_id !== interventionId || parsed.data.user_id !== userId) invalid();
      cursor = parsed.data!;
    } catch { invalid(); }
  }
  return { userId, interventionId, limit: Number(text), cursor };
}
/** The supplied client must carry the authenticated user's JWT; RLS remains authoritative. */
export async function readDocumentHistory(db: SupabaseClient, input: ReturnType<typeof documentHistoryQuery>) {
  try {
    // A global history uses document RLS unchanged, including shared and standalone documents.
    // A dossier filter must first prove parent visibility under the same user JWT.
    if (input.interventionId) {
      const parent = await db.from("interventions").select("id").eq("id", input.interventionId).limit(2);
      if (parent.error || !Array.isArray(parent.data) || parent.data.length > 1) throw new DocumentHistoryError(503);
      if (!parent.data.length) throw new DocumentHistoryError(404);
      if (parent.data[0]?.id !== input.interventionId) throw new DocumentHistoryError(503);
    }
    let query = db.from("documents").select(DOCUMENT_HISTORY_FIELDS);
    if (input.interventionId) query = query.eq("intervention_id", input.interventionId);
    if (input.cursor) {
      const c = input.cursor;
      query = query.or(`created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt.${c.id})`);
    }
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1);
    if (result.error) throw new DocumentHistoryError(503);
    const parsed = z.array(documentSchema).max(input.limit + 1).safeParse(result.data);
    if (!parsed.success || (input.interventionId !== null && parsed.data.some(row => row.intervention_id !== input.interventionId))) throw new DocumentHistoryError(503);
    const documents = parsed.data.slice(0, input.limit), hasMore = parsed.data.length > input.limit;
    const last = documents.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, user_id: input.userId, intervention_id: input.interventionId, created_at: last.created_at, id: last.id })).toString("base64url") : null;
    return { documents, page: { limit: input.limit, has_more: hasMore, next_cursor: next } };
  } catch (error) {
    if (error instanceof DocumentHistoryError) throw error;
    throw new DocumentHistoryError(503);
  }
}
