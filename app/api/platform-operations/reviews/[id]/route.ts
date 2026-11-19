import { z } from "zod";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { count, failed, invalidQuery, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const note = z.string().max(1000).regex(/^[^\u0000]*$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["hide", "restore"]), expected_version: z.number().int().min(1).nullable(), note }).strict(),
  z.object({ action: z.literal("contest"), request_id: uuid, reason: z.string().trim().min(10).max(2000).regex(/^[^\u0000]*$/) }).strict(),
  z.object({ action: z.literal("decide"), contestation_id: uuid, decision: z.enum(["upheld", "dismissed"]), expected_version: z.number().int().min(1), note: z.string().trim().min(10).max(1000).regex(/^[^\u0000]*$/) }).strict(),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertOrigin(request);
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Cet avis est introuvable.");
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    const data = await validated(request, schema);
    // Contesting is the reviewed artisan's own action (checked by the database); moderation needs the scope.
    if (data.action !== "contest") await requireScope(db, "reviews_moderate");
    const result = data.action === "contest"
      ? await db.rpc("platform_contest_review", { p_request_id: data.request_id, p_review_id: id, p_reason: data.reason })
      : data.action === "decide"
        ? await db.rpc("platform_decide_contestation", { p_id: data.contestation_id, p_decision: data.decision, p_note: data.note, p_expected_version: data.expected_version })
        : await db.rpc("platform_moderate_review", { p_review_id: id, p_action: data.action, p_note: data.note, p_expected_version: data.expected_version });
    dbError(result.error);
    return ok(objectResult(result.data, "La décision n’a pas été confirmée."));
  } catch (error) { return failed(error); }
}


/** The reviewed artisan reads only their own contestation history. No moderator scope is granted. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Cet avis est introuvable.");
    if (new URL(request.url).searchParams.size) invalidQuery();
    const { db, user } = await authenticatedClient();
    const review = await db.from("reviews").select("id,intervention_id,rating,body").eq("id", id).maybeSingle();
    dbError(review.error);
    if (!review.data) throw new ApiError(404, "Cet avis est introuvable.");
    const job = await db.from("interventions").select("id").eq("id", review.data.intervention_id).eq("artisan_id", user.id).maybeSingle();
    dbError(job.error);
    if (!job.data) throw new ApiError(404, "Cet avis est introuvable.");
    const history = await db.from("platform_review_contestations")
      .select("id,review_id,request_id,reason,status,created_at,decided_at,decision_note", { count: "exact" })
      .eq("review_id", id).eq("contested_by", user.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
    dbError(history.error);
    return ok({ review: review.data, contestations: history.data ?? [], limited: count(history.count) > (history.data?.length ?? 0) });
  } catch (error) { return failed(error); }
}
