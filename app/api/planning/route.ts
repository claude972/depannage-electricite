import { authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { isoInstant, planningCommandSchema } from "@/lib/features/planning/schemas";
import { PLANNING_MAX_RANGE_DAYS, PLANNING_TIME_ZONE } from "@/lib/features/planning/types";
import { toIsoWithOffset, weekRange } from "@/lib/features/planning/time";
// Contract ADV-PLANNING-NOTIFICATIONS-001 (amendment A1). Private artisan planning: the server
// computes availability, occupations and free intervals; the browser never derives rights.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
function invalid(message = "Vérifiez la période demandée."): never {
  throw new ApiError(422, message);
}
function failed(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
function envelope(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(503, "Le planning n’a pas été renvoyé. Réessayez.");
  return data;
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["from", "to"].includes(key) || params.getAll(key).length !== 1) invalid();
    const actor = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(actor.error);
    if (actor.data?.role !== "artisan") throw new ApiError(403, "Le planning est réservé aux comptes professionnels.");
    let from: string, to: string;
    if (params.has("from") || params.has("to")) {
      const parsedFrom = isoInstant.safeParse(params.get("from")), parsedTo = isoInstant.safeParse(params.get("to"));
      if (!parsedFrom.success || !parsedTo.success) invalid();
      from = parsedFrom.data; to = parsedTo.data;
      const span = Date.parse(to) - Date.parse(from);
      if (!(span > 0) || span > PLANNING_MAX_RANGE_DAYS * 86400000) invalid();
    } else {
      const week = weekRange(new Date(), PLANNING_TIME_ZONE);
      from = toIsoWithOffset(week.from); to = toIsoWithOffset(week.to);
    }
    const result = await db.rpc("artisan_planning", { p_from: from, p_to: to });
    dbError(result.error);
    return Response.json(envelope(result.data), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalid("Aucun paramètre n’est attendu.");
    const data = await validated(request, planningCommandSchema);
    let result;
    switch (data.action) {
      case "save_rule":
        result = await db.rpc("save_availability_rule", {
          p_request_id: data.request_id, p_id: data.id ?? null, p_weekday: data.weekday, p_start_minute: data.start_minute, p_end_minute: data.end_minute,
          p_time_zone: data.time_zone ?? PLANNING_TIME_ZONE, p_valid_from: data.valid_from ?? null, p_valid_until: data.valid_until ?? null, p_expected_version: data.expected_version ?? null,
        });
        break;
      case "delete_rule":
        result = await db.rpc("delete_availability_rule", { p_id: data.id, p_expected_version: data.expected_version });
        break;
      case "save_entry":
        result = await db.rpc("save_planning_entry", {
          p_request_id: data.request_id, p_id: data.id ?? null, p_kind: data.kind, p_starts_at: data.starts_at, p_ends_at: data.ends_at,
          p_title: data.title, p_note: data.note, p_expected_version: data.expected_version ?? null,
        });
        break;
      case "delete_entry":
        result = await db.rpc("delete_planning_entry", { p_id: data.id, p_expected_version: data.expected_version });
        break;
    }
    dbError(result.error);
    return Response.json(envelope(result.data), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
