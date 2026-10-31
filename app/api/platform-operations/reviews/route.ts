import { z } from "zod";
import { authenticatedClient } from "@/lib/supabase/server";
import { failed, listRows, ok, requireScope, type FilterableQuery } from "@/lib/features/platform-operations/http";
import type { ModeratedReview } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Raw = Omit<ModeratedReview, "moderation" | "contestations"> & { platform_review_moderation: ModeratedReview["moderation"] | ModeratedReview["moderation"][] | null; platform_review_contestations: ModeratedReview["contestations"] | null };
/** Moderators list reviews with their moderation state and contestations; RLS still decides what is readable. */
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "reviews_moderate");
    const params = new URL(request.url).searchParams;
    const state = params.get("state"), contested = params.get("contested");
    const moderationJoin = state === "hidden" ? "platform_review_moderation!inner" : "platform_review_moderation";
    const contestationJoin = contested === "open" ? "platform_review_contestations!inner" : "platform_review_contestations";
    const fields = `id,intervention_id,author_id,rating,body,created_at,${moderationJoin}(review_id,state,version,note,updated_by,updated_at),${contestationJoin}(id,request_id,review_id,contested_by,reason,status,version,created_at,decided_by,decided_at,decision_note)`;
    const list = await listRows<Raw>(db, request, {
      table: "reviews", fields, order: "created_at", allowed: ["state", "contested"],
      filters: {
        state: { schema: z.enum(["hidden"]).nullable(), apply: (query: FilterableQuery, value: unknown) => query.eq("platform_review_moderation.state", String(value)) },
        contested: { schema: z.enum(["open"]).nullable(), apply: (query: FilterableQuery, value: unknown) => query.eq("platform_review_contestations.status", String(value)) },
      },
    });
    const reviews: ModeratedReview[] = list.rows.map((row) => {
      const { platform_review_moderation, platform_review_contestations, ...review } = row;
      const moderation = Array.isArray(platform_review_moderation) ? platform_review_moderation[0] ?? null : platform_review_moderation ?? null;
      return { ...review, moderation, contestations: [...(platform_review_contestations ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
    });
    return ok({ reviews, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
