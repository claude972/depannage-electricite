import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { isoInstant } from "@/lib/features/planning/schemas";
import { SLOTS_MAX_RANGE_DAYS } from "@/lib/features/planning/types";
// Free intervals of the artisan assigned to one dossier the caller can read (RLS + RPC guard).
// Intervals only: no title, note, reason or other dossier of the artisan is ever returned.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
function invalid(): never { throw new ApiError(422, "Vérifiez le dossier et la période demandés."); }
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["intervention_id", "from", "to"].includes(key) || params.getAll(key).length !== 1) invalid();
    const id = uuid.safeParse(params.get("intervention_id")), from = isoInstant.safeParse(params.get("from")), to = isoInstant.safeParse(params.get("to"));
    if (!id.success || !from.success || !to.success) invalid();
    const span = Date.parse(to.data) - Date.parse(from.data);
    if (!(span > 0) || span > SLOTS_MAX_RANGE_DAYS * 86400000) invalid();
    const result = await db.rpc("intervention_free_slots", { p_intervention_id: id.data, p_from: from.data, p_to: to.data });
    dbError(result.error);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new ApiError(503, "Les créneaux n’ont pas été renvoyés. Réessayez.");
    return Response.json(result.data, { headers: privateHeaders });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
