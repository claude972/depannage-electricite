import { z } from "zod";
import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
const instant = z.iso.datetime({ offset: true });
const querySchema = z.object({
  current_start: instant,
  current_end: instant,
  previous_start: instant,
  previous_end: instant,
}).strict();
const keys = ["current_start", "current_end", "previous_start", "previous_end"] as const;
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !keys.some((allowed) => allowed === key)) || keys.some((key) => query.getAll(key).length !== 1))
      throw new ApiError(422, "Renseignez les quatre bornes de période, sans paramètre supplémentaire.");
    const parsed = querySchema.safeParse(Object.fromEntries(query));
    if (!parsed.success) throw new ApiError(422, "Les périodes doivent contenir des dates ISO avec fuseau horaire.");
    const period = parsed.data;
    const currentStart = Date.parse(period.current_start), currentEnd = Date.parse(period.current_end);
    const previousStart = Date.parse(period.previous_start), previousEnd = Date.parse(period.previous_end);
    const maxPeriod = 32 * 24 * 60 * 60 * 1000;
    if (currentEnd <= currentStart || previousEnd <= previousStart || currentEnd - currentStart > maxPeriod || previousEnd - previousStart > maxPeriod || previousEnd !== currentStart)
      throw new ApiError(422, "Les périodes doivent être contiguës, positives et limitées à 32 jours chacune.");
    const { db } = await authenticatedClient();
    const result = await db.rpc("artisan_performance", {
      p_current_start: period.current_start,
      p_current_end: period.current_end,
      p_previous_start: period.previous_start,
      p_previous_end: period.previous_end,
    });
    if (result.error?.code === "22003") throw new ApiError(422, "Les totaux dépassent la précision disponible. Contactez l’assistance.");
    dbError(result.error);
    return Response.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
