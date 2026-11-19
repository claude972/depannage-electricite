import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { assertOrigin } from "@/lib/supabase/server";
import { supportOperatorPermissions } from "@/lib/features/support/permissions";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const fields = "id,creator_id,intervention_id,subject,status,version,created_at,updated_at,last_message_at";
const status = z.enum(["open", "in_progress", "awaiting_user", "resolved"]);
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const cursorSchema = z.object({ v: z.literal(1), created_at: timestamp, id: uuid, filters: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const createSchema = z.object({ request_id: uuid, subject: z.string().trim().min(4).max(160).regex(/^[^\u0000]*$/), body: z.string().trim().min(10).max(4000).regex(/^[^\u0000]*$/), intervention_id: uuid.nullable() }).strict();
function invalid(): never { throw new ApiError(422, "Vérifiez les filtres ou rechargez les demandes sans leur ancien curseur."); }
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
function count(value: number | null): number { if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "Le comptage des demandes est indisponible."); return value; }
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    const actor = await db.from("profiles").select("role").eq("id", user.id).single(); dbError(actor.error);
    const params = new URL(request.url).searchParams;
    const allowed = new Set(["limit", "cursor", "scope", "status", "intervention_id", "q"]);
    for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) invalid();
    if (request.url.length > 4096) invalid();
    const limitText = params.get("limit") ?? "25"; if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText)) invalid(); const limit = Number(limitText);
    const scope = params.get("scope") ?? (actor.data?.role === "admin" ? "all" : "mine");
    if (scope !== "mine" && scope !== "all") invalid();
    if (scope === "all" && !(await supportOperatorPermissions(db)).can_read_all) throw new ApiError(403, "Vous n’avez pas accès à la liste globale de l’assistance.");
    const statusFilter = params.get("status"), intervention = params.get("intervention_id");
    if ((statusFilter !== null && !status.safeParse(statusFilter).success) || (intervention !== null && !uuid.safeParse(intervention).success)) invalid();
    const q = params.get("q")?.normalize("NFKC").replace(/\s+/gu, " ").trim() || null;
    if (q && (q.length < 2 || q.length > 80 || !/^[\p{L}\p{M}\p{N} '\u2019-]+$/u.test(q))) invalid();
    const filters = { scope, status: statusFilter, intervention_id: intervention, q };
    const fingerprint = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (params.has("cursor")) {
      const raw = params.get("cursor")!;
      if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
      try {
        const bytes = Buffer.from(raw, "base64url"); if (bytes.toString("base64url") !== raw) invalid();
        const parsed = cursorSchema.safeParse(JSON.parse(bytes.toString("utf8")));
        if (!parsed.success || parsed.data.filters !== fingerprint) invalid(); cursor = parsed.data;
      } catch { invalid(); }
    }
    function query(head = false) {
      let result = db.from("support_tickets").select(fields, { count: "exact", head });
      if (scope === "mine") result = result.eq("creator_id", user.id);
      if (statusFilter) result = result.eq("status", statusFilter);
      if (intervention) result = result.eq("intervention_id", intervention);
      if (q) result = result.ilike("subject", `%${q}%`);
      return result;
    }
    let pageQuery = query();
    if (cursor) pageQuery = pageQuery.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
    const [page, total] = await Promise.all([pageQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1), query(true)]);
    dbError(page.error); dbError(total.error);
    const tickets = (page.data ?? []).slice(0, limit), hasMore = count(page.count) > tickets.length;
    let next: string | null = null;
    if (hasMore) {
      const last = tickets.at(-1); const parsed = cursorSchema.safeParse({ v: 1, id: last?.id, created_at: last?.created_at, filters: fingerprint });
      if (!parsed.success) throw new ApiError(503, "Le curseur de suivi est indisponible.");
      next = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
    }
    return Response.json({ tickets, page: { limit, total: count(total.count), has_more: hasMore, next_cursor: next }, filters }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    if (new URL(request.url).searchParams.size) invalid();
    const data = await validated(request, createSchema);
    const result = await db.rpc("create_support_ticket", { p_request_id: data.request_id, p_subject: data.subject, p_body: data.body, p_intervention_id: data.intervention_id });
    dbError(result.error);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new ApiError(503, "La demande d’assistance n’a pas été confirmée.");
    return Response.json(result.data, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
