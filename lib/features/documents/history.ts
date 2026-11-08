import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCUMENT_HISTORY_FIELDS = "id,intervention_id,owner_id,name,mime_type,created_at";
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true }).max(40);
const cursorFields = { user_id: uuid, created_at: timestamp, id: uuid };
const cursorSchema = z.discriminatedUnion("v", [
  z.object({ ...cursorFields, v: z.literal(1), intervention_id: uuid.nullable() }).strict(),
  z.object({ ...cursorFields, v: z.literal(2), site_id: uuid }).strict(),
]);
const documentSchema = z.object({ id: uuid, intervention_id: uuid.nullable(), owner_id: uuid, name: z.string(), mime_type: z.string(), created_at: timestamp }).strict();
const siteDocumentSchema = documentSchema.extend({
  intervention_id: uuid,
  interventions: z.object({ site_id: uuid }).strict(),
});
export class DocumentHistoryError extends Error {
  constructor(public status: 404 | 422 | 503) {
    super(status === 404 ? "Ce dossier est introuvable." : status === 422 ? "Vérifiez les filtres ou rechargez les documents sans leur ancien curseur." : "Les documents sont momentanément indisponibles. Réessayez.");
  }
}
export function documentHistoryQuery(url: string, userId: string) {
  const params = new URL(url).searchParams;
  const invalid = (): never => { throw new DocumentHistoryError(422); };
  if (url.length > 4096) invalid();
  for (const key of params.keys()) if (!["intervention_id", "site_id", "limit", "cursor"].includes(key) || params.getAll(key).length !== 1) invalid();
  const id = uuid.nullable().safeParse(params.get("intervention_id"));
  const site = uuid.nullable().safeParse(params.get("site_id"));
  if (!id.success || !site.success || (id.data && site.data)) invalid();
  const siteId = site.data?.toLowerCase() ?? null;
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
      if (!parsed.success || parsed.data.user_id !== userId) invalid();
      const decoded = parsed.data!;
      if (siteId ? decoded.v !== 2 || decoded.site_id !== siteId
        : decoded.v !== 1 || decoded.intervention_id !== interventionId) invalid();
      cursor = decoded;
    } catch { invalid(); }
  }
  return { userId, interventionId, siteId, limit: Number(text), cursor };
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
    async function checkSite(siteId: string) {
      const parent = await db.from("sites").select("id").eq("id", siteId).limit(2);
      if (parent.error || !Array.isArray(parent.data) || parent.data.length > 1) throw new DocumentHistoryError(503);
      if (!parent.data.length) throw new DocumentHistoryError(404);
      if (parent.data[0]?.id !== siteId) throw new DocumentHistoryError(503);
    }
    if (input.siteId) await checkSite(input.siteId);
    const fields = input.siteId ? `${DOCUMENT_HISTORY_FIELDS},interventions!inner(site_id)` : DOCUMENT_HISTORY_FIELDS;
    let query = db.from("documents").select(fields);
    if (input.siteId) query = query.eq("interventions.site_id", input.siteId);
    if (input.interventionId) query = query.eq("intervention_id", input.interventionId);
    if (input.cursor) {
      const c = input.cursor;
      query = query.or(`created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt.${c.id})`);
    }
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit + 1);
    if (result.error) throw new DocumentHistoryError(503);
    const siteRows = input.siteId ? z.array(siteDocumentSchema).max(input.limit + 1).parse(result.data) : null;
    if (siteRows?.some(row => row.interventions.site_id !== input.siteId)) throw new DocumentHistoryError(503);
    const parsed = z.array(documentSchema).max(input.limit + 1).safeParse(
      siteRows ? siteRows.map(({ interventions: _, ...document }) => document) : result.data,
    );
    if (!parsed.success || (input.interventionId !== null && parsed.data.some(row => row.intervention_id !== input.interventionId))) throw new DocumentHistoryError(503);
    const documents = parsed.data.slice(0, input.limit), hasMore = parsed.data.length > input.limit;
    const last = documents.at(-1);
    const scope = input.siteId ? { v: 2, site_id: input.siteId } : { v: 1, intervention_id: input.interventionId };
    const next = hasMore && last
      ? Buffer.from(JSON.stringify({ ...scope, user_id: input.userId, created_at: last.created_at, id: last.id })).toString("base64url")
      : null;
    if (input.siteId) await checkSite(input.siteId);
    return { documents, page: { limit: input.limit, has_more: hasMore, next_cursor: next } };
  } catch (error) {
    if (error instanceof DocumentHistoryError) throw error;
    throw new DocumentHistoryError(503);
  }
}
