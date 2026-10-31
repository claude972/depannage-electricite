import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z
  .object({
    name: z.string().trim().min(1).max(160),
    type: z.enum(["syndic", "restaurant", "office", "erp"]),
    address: z.string().trim().min(5).max(500),
    budget_cents: z.number().int().min(0).max(100000000),
    organization_id: uuid.nullish(),
  })
  .strict();
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    const { data, error } = await db
      .from("sites")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    dbError(error);
    return Response.json({ sites: data });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    const { data: result, error } = await db.rpc("create_site", {
      p_name: data.name,
      p_type: data.type,
      p_address: data.address,
      p_budget_cents: data.budget_cents,
      p_organization_id: data.organization_id ?? null,
    });
    dbError(error);
    return Response.json({ site: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
