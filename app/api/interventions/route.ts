import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { estimateReviewRefusal } from "@/lib/features/indicative-prices/review-refusal";
export { GET } from "../workspace/route";
const schema = z
  .object({
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
    description: z.string().trim().min(10).max(4000),
    address: z.string().trim().min(5).max(500),
    postal_code: z.string().regex(/^\d{5}$/),
    city: z.string().trim().min(2).max(120),
    urgency: z.enum(["urgent", "scheduled"]),
    site_id: uuid.nullish(),
    request_id: uuid.optional(),
    reviewed_estimate_version:z.number().int().min(1).max(2147483647).optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const data = await validated(request, schema);
    const { data: result, error } = await db.rpc(data.request_id ? "create_intervention_once_reviewed" : "create_intervention_reviewed", {
      ...(data.request_id ? { p_request_id: data.request_id } : {}),
      p_category: data.category,
      p_description: data.description,
      p_address: data.address,
      p_postal_code: data.postal_code,
      p_city: data.city,
      p_urgency: data.urgency,
      p_site_id: data.site_id ?? null,
      p_reviewed_estimate_version:data.reviewed_estimate_version??null,
    });
    const refusal = estimateReviewRefusal(error);
    if (refusal) return refusal;
    dbError(error);
    return Response.json({ intervention: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
