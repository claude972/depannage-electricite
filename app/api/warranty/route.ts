import process from "node:process";
import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("request"),
      intervention_id: uuid,
      description: z.string().trim().min(10).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      case_id: uuid,
      status: z.enum(["reviewing", "resolved", "declined"]),
      resolution: z.string().trim().min(10).max(4000),
    })
    .strict(),
]);
export { GET } from '@/lib/features/warranty-history/handler';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const input = await validated(request, schema);
    if (
      input.action === "request" &&
      process.env.WARRANTY_REQUESTS_ENABLED !== "true"
    )
      throw new ApiError(
        503,
        "Le dépôt des demandes de garantie sera disponible après validation des conditions commerciales.",
      );
    const result =
      input.action === "request"
        ? await db.rpc("request_warranty", {
            p_intervention_id: input.intervention_id,
            p_description: input.description,
          })
        : await db.rpc("resolve_warranty", {
            p_case_id: input.case_id,
            p_status: input.status,
            p_resolution: input.resolution,
          });
    dbError(result.error);
    return Response.json({ case: result.data });
  } catch (error) {
    return apiError(error);
  }
}
