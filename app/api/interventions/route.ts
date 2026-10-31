import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
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
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    const { data: result, error } = await db.rpc("create_intervention", {
      p_category: data.category,
      p_description: data.description,
      p_address: data.address,
      p_postal_code: data.postal_code,
      p_city: data.city,
      p_urgency: data.urgency,
      p_site_id: data.site_id ?? null,
    });
    dbError(error);
    return Response.json({ intervention: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
