import {
  authenticatedClient, ApiError, apiError, dbError,
} from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { source } from "@/lib/features/contract-quote-pricing/contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = uuid.safeParse((await params).id);
    if (!id.success || new URL(request.url).searchParams.size)
      throw new ApiError(422, "Référence ou paramètres invalides.");
    const quote = await db.from("quotes").select("id").eq("id", id.data).maybeSingle();
    dbError(quote.error);
    if (!quote.data) throw new ApiError(404, "Ce devis est introuvable.");
    const result = await db.from("quote_contract_sources").select("grid_id,grid_version,grid_label")
      .eq("quote_id", id.data).maybeSingle();
    dbError(result.error);
    const parsed = source.nullable().safeParse(result.data);
    if (!parsed.success) throw new ApiError(503, "La référence de la grille doit être vérifiée.");
    return Response.json({ source: parsed.data }, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
