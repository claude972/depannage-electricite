import { authenticatedClient, apiError, dbError } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    const result = await db.rpc("admin_overview");
    dbError(result.error);
    return Response.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
