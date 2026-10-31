import { createHash } from "node:crypto";
import type { z } from "zod";
import { authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { cursorSchema, markSchema } from "@/lib/features/notifications/schemas";
// Contract ADV-PLANNING-NOTIFICATIONS-001: the recipient's own notifications, keyset-paginated
// (created_at desc, id desc) with exact totals. RLS hides rows whose linked scope was revoked.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const fields = "id,kind,title,body,intervention_id,organization_id,site_id,payload,read_at,created_at";
function invalid(): never { throw new ApiError(422, "Vérifiez les filtres ou rechargez les notifications sans leur ancien curseur."); }
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
function count(value: number | null): number { if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "Le comptage des notifications est indisponible."); return value; }
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["limit", "cursor", "unread"].includes(key) || params.getAll(key).length !== 1) invalid();
    if (request.url.length > 4096) invalid();
    const limitText = params.get("limit") ?? "25"; if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText)) invalid(); const limit = Number(limitText);
    const unreadText = params.get("unread"); if (unreadText !== null && unreadText !== "1" && unreadText !== "0") invalid();
    const unread = unreadText === "1";
    const filters = { unread };
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
      let result = db.from("notifications").select(fields, { count: "exact", head }).eq("recipient_id", user.id);
      if (unread) result = result.is("read_at", null);
      return result;
    }
    let pageQuery = query();
    if (cursor) pageQuery = pageQuery.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
    const [page, total, unreadTotal] = await Promise.all([
      pageQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1),
      query(true),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).is("read_at", null),
    ]);
    dbError(page.error); dbError(total.error); dbError(unreadTotal.error);
    const notifications = (page.data ?? []).slice(0, limit), hasMore = count(page.count) > notifications.length;
    let next: string | null = null;
    if (hasMore) {
      const last = notifications.at(-1); const parsed = cursorSchema.safeParse({ v: 1, id: last?.id, created_at: last?.created_at, filters: fingerprint });
      if (!parsed.success) throw new ApiError(503, "Le curseur de suivi est indisponible.");
      next = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
    }
    return Response.json({ notifications, page: { limit, total: count(total.count), has_more: hasMore, next_cursor: next }, unread_count: count(unreadTotal.count), filters }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalid();
    const data = await validated(request, markSchema);
    const result = await db.rpc("mark_notifications", data.action === "mark_all_read"
      ? { p_action: "read_all", p_ids: null, p_before: data.before ?? null }
      : { p_action: data.action === "mark_read" ? "read" : "unread", p_ids: [...new Set(data.ids)], p_before: null });
    dbError(result.error);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new ApiError(503, "Le marquage n’a pas été confirmé.");
    return Response.json(result.data, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
