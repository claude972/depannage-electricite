import { apiError, ApiError, dbError, publicClient } from "@/lib/supabase/server";
import { publication } from "@/lib/features/public-operator-profile/contract";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const db = publicClient();
    const result = await db.rpc("read_public_operator_profile");
    dbError(result.error);
    const parsed = publication.nullable().safeParse(result.data);
    if (!parsed.success) throw new ApiError(503, "Les informations publiques sont momentanément indisponibles.");
    return Response.json({ published: parsed.data }, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
