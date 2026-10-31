import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const grant = z.object({ site_id: uuid, can_write: z.boolean() }).strict();
const schema = z.object({ organization_id: uuid, user_id: uuid, scope: z.enum(["all", "selected"]), grants: z.array(grant).max(100) }).strict()
  .refine((data) => data.scope !== "all" || data.grants.length === 0, "Une portée globale ne comporte pas d’attributions de sites.")
  .refine((data) => new Set(data.grants.map((item) => item.site_id.toLowerCase())).size === data.grants.length, "Un site ne peut être attribué qu’une fois.");
export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get("organization_id");
    if (!uuid.safeParse(organizationId).success) throw new ApiError(422, "Choisissez une organisation valide.");
    const { db } = await authenticatedClient();
    const result = await db.rpc("organization_site_access_overview", { p_organization_id: organizationId });
    dbError(result.error);
    return Response.json(result.data, { headers });
  } catch (error) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    const result = await db.rpc("set_organization_member_site_access", { p_organization_id: data.organization_id, p_user_id: data.user_id, p_scope: data.scope, p_grants: data.grants });
    dbError(result.error);
    return Response.json({ ok: true }, { headers });
  } catch (error) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
