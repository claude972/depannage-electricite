import { ApiError, apiError, dbError, serverClient } from "@/lib/supabase/server";
import { postalCode, publicCoverage } from "@/lib/features/coverage/contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const postal = postalCode.safeParse(params.get("postal_code"));
    if (params.size !== 1 || !postal.success)
      throw new ApiError(422, "Saisissez un code postal de cinq chiffres.");
    const db = await serverClient();
    const result = await db.rpc("read_public_coverage", { p_postal_code: postal.data });
    dbError(result.error);
    const coverage = publicCoverage.safeParse(result.data);
    if (!coverage.success)
      throw new ApiError(503, "La zone publiée doit être vérifiée.");
    return Response.json(coverage.data, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
