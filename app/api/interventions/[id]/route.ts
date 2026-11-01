import { authenticatedClient, ApiError } from "@/lib/supabase/server";
import { detailIdSchema, readInterventionDetail } from "@/lib/features/workspace/detail-read";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const missing = () => Response.json({ error: "Ce dossier est introuvable." }, { status: 404, headers });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await authenticatedClient();
    const { id } = await context.params;
    if (!detailIdSchema.safeParse(id).success) return missing();
    const detail = await readInterventionDetail(db, id.toLowerCase());
    return detail ? Response.json(detail, { headers }) : missing();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ error: "Connectez-vous pour accéder à cet espace." }, { status: 401, headers });
    return Response.json({ error: "Les données sont momentanément indisponibles. Réessayez." }, { status: 503, headers: { ...headers, "Retry-After": "2" } });
  }
}
