import { env } from "node:process";
import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { missionCursorSchema, missionSnapshotSchema, rankedCursorSchema, rankedSnapshotSchema } from "@/lib/features/artisan-missions/schema";
import { checkoutCommissionBps } from "@/lib/features/platform-operations/config";
import { comparePostgresTime } from "@/lib/shared/postgres-time-order";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

type Position = { created_at: string; id: string; distance_band_km?: number | null };
function after(row: Position, previous: Position) {
  const band = (row.distance_band_km ?? 201) - (previous.distance_band_km ?? 201);
  if (band) return band > 0;
  const order = comparePostgresTime(row.created_at, previous.created_at);
  return order > 0 || (order === 0 && row.id > previous.id);
}

function cursorJson(raw: string): unknown {
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(raw)) throw Error();
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.toString("base64url") !== raw) throw Error();
  return JSON.parse(bytes.toString("utf8"));
}

const ACTIVE_STATUSES = ["assigned", "quoted", "accepted", "in_progress"] as const;
type Db = Awaited<ReturnType<typeof authenticatedClient>>["db"];
/** Same rule as artisan_capacity_private.has_slot: preference 4, otherwise 3. Null when unreadable. */
async function activeCapacity(db: Db, userId: string): Promise<{ active: number; limit: 3 | 4; full: boolean } | null> {
  try {
    const [profile, active] = await Promise.all([
      db.from("artisan_profiles").select("capacity_limit").eq("user_id", userId).maybeSingle(),
      db.from("interventions").select("id", { count: "exact", head: true }).eq("artisan_id", userId).in("status", [...ACTIVE_STATUSES]),
    ]);
    if (profile.error || active.error || typeof active.count !== "number") return null;
    const limit = profile.data?.capacity_limit === 4 ? 4 : 3;
    return { active: active.count, limit, full: active.count >= limit };
  } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    const query = new URL(request.url).searchParams;
    const ranked = query.get("order") === "nearest";
    if (request.url.length > 2048 || [...query.keys()].some(k => !["cursor", "id", "order"].includes(k) || query.getAll(k).length !== 1) ||
      (query.has("order") && !ranked) || (query.has("id") && (query.has("cursor") || ranked))) throw new ApiError(422, "Paramètres invalides.");
    let selected: string | null = null;
    if (query.has("id")) {
      const result = missionCursorSchema.shape.id.safeParse(query.get("id"));
      if (!result.success) throw new ApiError(422, "Référence invalide.");
      selected = result.data.toLowerCase();
    }
    let cursor: ReturnType<typeof missionCursorSchema.parse> | null = null;
    let rankedCursor: ReturnType<typeof rankedCursorSchema.parse> | null = null;
    const raw = query.get("cursor");
    if (raw !== null) {
      try {
        const value = cursorJson(raw);
        rankedCursor = ranked ? rankedCursorSchema.parse(value) : null;
        cursor = rankedCursor ?? missionCursorSchema.parse(value);
        cursor = { ...cursor, actor_id: cursor.actor_id.toLowerCase(), id: cursor.id.toLowerCase() };
        if (cursor.actor_id !== user.id) throw Error();
      } catch { throw new ApiError(422, "Curseur invalide. Actualisez les offres."); }
    }
    const position = { p_after_at: cursor?.created_at ?? null, p_after_id: cursor?.id ?? null };
    const result = ranked
      ? await db.rpc("available_missions_by_distance", { ...position, p_after_km_band: rankedCursor?.distance_band_km ?? null, p_radius_version: rankedCursor?.radius_version ?? null })
      : await db.rpc("available_missions_page", { ...position, p_id: selected });
    if (ranked && result.error?.code === "22023") throw new ApiError(422, "Le rayon de recherche a changé ou est désactivé. Actualisez les offres.");
    dbError(result.error);
    const data = (ranked ? rankedSnapshotSchema : missionSnapshotSchema).parse(result.data);
    if ((!data.eligible && data.items.length) || new Set(data.items.map(i => i.id)).size !== data.items.length) throw Error("Invalid feed");
    if (selected) {
      if (data.items.length > 1 || data.items.some(i => i.id !== selected)) throw Error("Invalid selected offer");
      if (!data.items.length) throw new ApiError(404, "Cette offre n’est plus disponible avec vos droits actuels.");
    }
    const version = "radius_version" in data ? data.radius_version : null;
    if (rankedCursor && rankedCursor.radius_version !== version) throw Error("Wrong radius version");
    let previous: Position | null = cursor && { ...cursor, distance_band_km: rankedCursor?.distance_band_km };
    for (const row of data.items) {
      if (previous && !after(row, previous)) throw Error("Unordered feed");
      previous = row;
    }
    const items = data.items.slice(0, 50), last = items.at(-1), hasMore = data.items.length > 50;
    const next = hasMore && last ? {
      actor_id: user.id, created_at: last.created_at, id: last.id,
      ...("distance_band_km" in last ? { distance_band_km: last.distance_band_km, radius_version: version } : {}),
    } : null;
    // An empty first page may come from the simultaneous-missions limit (mission_eligible): say so
    // instead of letting the artisan believe nothing matches their zones and skills.
    const capacity = !selected && !cursor && data.eligible && !items.length ? await activeCapacity(db, user.id) : null;
    const fee = selected ? checkoutCommissionBps(env) : null;
    const selectedEstimate = selected && items[0] && fee !== null && fee < 10000 ? {
      min_cents: items[0].estimate_min_cents - Math.round(items[0].estimate_min_cents * fee / 10000),
      max_cents: items[0].estimate_max_cents - Math.round(items[0].estimate_max_cents * fee / 10000),
    } : null;
    return Response.json({ items, ...(selected ? { net_estimate: selectedEstimate } : {}), eligible: data.eligible, captured_at: data.captured_at,
      page: { limit: 50, has_more: hasMore, next_cursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null },
      projection: "anonymized", order: ranked ? "nearest_first" : "oldest_first", distance: ranked ? "commune_centre_bands" : "not_calculated",
      ...(ranked ? { radius_version: version } : {}),
      ...(capacity ? { capacity } : {}),
    }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Les offres n’ont pas pu être vérifiées. Réessayez." }, { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
