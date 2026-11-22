import { authenticatedClient, ApiError } from "@/lib/supabase/server";
import { DocumentHistoryError, documentHistoryQuery, readDocumentHistory } from "@/lib/features/documents/history";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    return Response.json(await readDocumentHistory(db, documentHistoryQuery(request.url, user.id)), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof DocumentHistoryError)
      return Response.json({ error: error.message }, { status: error.status, headers: { ...privateHeaders, ...(error.status === 503 ? { "Retry-After": "2" } : {}) } });
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ error: "Connectez-vous pour accéder à cet espace." }, { status: 401, headers: privateHeaders });
    return Response.json({ error: "Les documents sont momentanément indisponibles. Réessayez." }, { status: 503, headers: { ...privateHeaders, "Retry-After": "2" } });
  }
}
