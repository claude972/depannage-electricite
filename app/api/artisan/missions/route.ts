import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { missionCursorSchema, missionSnapshotSchema } from "@/lib/features/artisan-missions/schema";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const query = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...query.keys()].some(k => !["cursor", "id"].includes(k) || query.getAll(k).length !== 1) || (query.has("cursor") && query.has("id"))) throw new ApiError(422, "Paramètres invalides.");
    let selected: string | null = null;
    if (query.has("id")) {
      const result = missionCursorSchema.shape.id.safeParse(query.get("id"));
      if (!result.success) throw new ApiError(422, "Référence invalide.");
      selected = result.data.toLowerCase();
    }
    let cursor: ReturnType<typeof missionCursorSchema.parse> | null = null;
    const raw = query.get("cursor");
    if (raw !== null) {
      try {
        if (!/^[A-Za-z0-9_-]{1,300}$/.test(raw)) throw Error();
        const bytes = Buffer.from(raw, "base64url");
        if (bytes.toString("base64url") !== raw) throw Error();
        cursor = missionCursorSchema.parse(JSON.parse(bytes.toString("utf8")));
        cursor = { ...cursor, actor_id: cursor.actor_id.toLowerCase(), id: cursor.id.toLowerCase() };
        if (cursor.actor_id !== user.id) throw Error();
      } catch { throw new ApiError(422, "Curseur invalide. Actualisez les offres."); }
    }
    const result = await db.rpc("available_missions_page", { p_after_at: cursor?.created_at ?? null, p_after_id: cursor?.id ?? null, p_id: selected });
    dbError(result.error);
    const data = missionSnapshotSchema.parse(result.data);
    if ((!data.eligible && data.items.length) || new Set(data.items.map(i => i.id)).size !== data.items.length) throw Error("Invalid feed");
    if (selected) {
      if (data.items.length > 1 || data.items.some(i => i.id !== selected)) throw Error("Invalid selected offer");
      if (!data.items.length) throw new ApiError(404, "Cette offre n’est plus disponible avec vos droits actuels.");
    }
    let previous = cursor;
    for (const row of data.items) {
      if (previous && (Date.parse(row.created_at) < Date.parse(previous.created_at) || (row.created_at === previous.created_at && row.id <= previous.id))) throw Error("Unordered feed");
      previous = { ...row, actor_id: user.id };
    }
    const items = data.items.slice(0, 50), last = items.at(-1), hasMore = data.items.length > 50;
    return Response.json({ items, eligible: data.eligible, captured_at: data.captured_at,
      page: { limit: 50, has_more: hasMore, next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ actor_id: user.id, created_at: last.created_at, id: last.id })).toString("base64url") : null },
      projection: "anonymized", order: "oldest_first", distance: "not_calculated",
    }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Les offres n’ont pas pu être vérifiées. Réessayez." }, { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
