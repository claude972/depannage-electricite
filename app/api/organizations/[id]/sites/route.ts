import { z } from "zod";
import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { siteRecord, siteColumns } from "@/lib/features/site-lifecycle/contract";
import { fail, privateHeaders, routeId, unavailable, type RouteContext } from "@/lib/features/site-lifecycle/http";

const limit = 50;

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db } = await authenticatedClient(request);
    const id = await routeId(context);
    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "active";
    const rawAfter = params.get("after");
    if (Array.from(params.keys()).some(key => !["state", "after"].includes(key))
      || params.getAll("state").length > 1 || params.getAll("after").length > 1
      || !["active", "archived"].includes(state)
      || (rawAfter !== null && !uuid.safeParse(rawAfter).success)) {
      throw new ApiError(422, "Filtres du portefeuille invalides.");
    }
    const after = rawAfter?.toLowerCase();
    const org = await db.from("organizations").select("id").eq("id", id).maybeSingle();
    dbError(org.error);
    if (!org.data) throw new ApiError(404, "Cette organisation est introuvable.");
    let query = db.from("sites").select(siteColumns, { count: "exact" }).eq("organization_id", id).order("id").limit(limit + 1);
    query = state === "active" ? query.is("archived_at", null) : query.not("archived_at", "is", null);
    if (after) query = query.gt("id", after);
    const result = await query;
    dbError(result.error);
    const parsed = z.array(siteRecord).max(limit + 1).safeParse(result.data);
    if (!parsed.success || result.count === null || !Number.isSafeInteger(result.count) || result.count < 0
      || parsed.data.length !== Math.min(result.count, limit + 1)
      || parsed.data.some((site, i) => site.organization_id !== id
        || (site.archived_at !== null) !== (state === "archived")
        || (after && site.id <= after) || (i > 0 && site.id <= parsed.data[i - 1].id))) throw unavailable();
    const sites = parsed.data.slice(0, limit);
    return Response.json({
      sites,
      next_after: parsed.data.length > limit ? sites.at(-1)?.id ?? null : null,
    }, { headers: privateHeaders });
  } catch (error) {
    return fail(error);
  }
}
