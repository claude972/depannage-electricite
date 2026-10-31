// ADV-DOCUMENTS-001 — overview, explicit validity and controlled document generation.
// Every right is decided by the SQL commands of migration 015; this route validates shapes only.
import { z } from "zod";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { checkedObject, failed, issuerError, privateHeaders } from "@/lib/features/quote-documents/server";
import { validateValidUntil } from "@/lib/features/quote-documents/validity";
import type { QuoteDocumentsOverview } from "@/lib/features/quote-documents/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_terms"), quote_id: uuid, valid_until: isoDate.nullable() }).strict(),
  z.object({ action: z.literal("generate"), quote_id: uuid, amendment_id: uuid.nullable() }).strict(),
]);
function invalid(): never {
  throw new ApiError(422, "Indiquez le dossier ou le devis à consulter, sans autre paramètre.");
}
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if ((key !== "intervention_id" && key !== "quote_id") || params.getAll(key).length !== 1) invalid();
    const interventionParam = params.get("intervention_id");
    const quoteParam = params.get("quote_id");
    if ((interventionParam === null) === (quoteParam === null)) invalid();
    if ((interventionParam && !uuid.safeParse(interventionParam).success) || (quoteParam && !uuid.safeParse(quoteParam).success)) invalid();
    let interventionId = interventionParam;
    if (quoteParam) {
      const quote = await db.from("quotes").select("intervention_id").eq("id", quoteParam).maybeSingle();
      dbError(quote.error);
      if (!quote.data) throw new ApiError(404, "Ce devis est introuvable dans votre espace.");
      interventionId = quote.data.intervention_id as string;
    }
    const result = await db.rpc("quote_documents_overview", { p_intervention_id: interventionId });
    dbError(result.error);
    const overview = checkedObject<QuoteDocumentsOverview>(result.data, "L’aperçu des documents n’a pas renvoyé de résultat valide.");
    if (!Array.isArray(overview.quotes)) throw new ApiError(503, "L’aperçu des documents n’a pas renvoyé de résultat valide.");
    if (quoteParam) {
      overview.quotes = overview.quotes.filter((q) => q.id === quoteParam);
      if (!overview.quotes.length) throw new ApiError(404, "Ce devis est introuvable dans votre espace.");
    }
    return Response.json(overview, { headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Cette action n’accepte pas de paramètre supplémentaire.");
    const data = await validated(request, schema);
    if (data.action === "set_terms") {
      const check = validateValidUntil(data.valid_until ?? "");
      if (!check.ok) throw new ApiError(422, check.message);
      const result = await db.rpc("set_quote_terms", { p_quote_id: data.quote_id, p_valid_until: check.value });
      dbError(result.error);
      return Response.json({ action: "set_terms", terms: checkedObject(result.data, "La validité n’a pas été confirmée.") }, { headers: privateHeaders });
    }
    const result = await db.rpc("generate_quote_document", { p_quote_id: data.quote_id, p_amendment_id: data.amendment_id });
    const configuration = issuerError(result.error);
    if (configuration) throw configuration;
    dbError(result.error);
    const payload = checkedObject<{ document: unknown; created: boolean }>(result.data, "La génération du document n’a pas été confirmée.");
    if (!payload.document || typeof payload.document !== "object") throw new ApiError(503, "La génération du document n’a pas été confirmée.");
    return Response.json({ action: "generate", document: payload.document, created: payload.created === true }, { status: payload.created === true ? 201 : 200, headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
