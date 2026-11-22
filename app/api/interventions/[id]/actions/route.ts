import { taxRateSchema } from "@/lib/tax-rates";
import { z } from "zod";
import { calculateQuote } from "@/lib/domain";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { quoteLine, uuid, validated } from "@/lib/supabase/validation";
const schema = z
  .object({
    action: z.enum([
      "accept_mission",
      "send_quote",
      "accept_quote",
      "start",
      "complete",
      "cancel",
    ]),
    quote_id: uuid.optional(),
    lines: z.array(quoteLine).min(1).max(30).optional(),
    tax_rate: taxRateSchema
      .optional(),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const { id } = await context.params;
    if (!uuid.safeParse(id).success)
      throw new ApiError(422, "Identifiant de dossier invalide.");
    const data = await validated(request, schema);
    if (data.action === "accept_quote" && !data.quote_id)
      throw new ApiError(422, "Ouvrez la version exacte du devis avant de l’accepter.");
    if (data.action !== "accept_quote" && data.quote_id)
      throw new ApiError(422, "La référence du devis ne concerne que son acceptation.");
    if (data.action === "send_quote") {
      if (!data.lines || data.tax_rate === undefined)
        throw new ApiError(
          422,
          "Renseignez les lignes et le taux de TVA applicable.",
        );
      try {
        calculateQuote(data.lines, data.tax_rate);
      } catch {
        throw new ApiError(422, "Vérifiez les montants du devis.");
      }
    }
    const { data: result, error } = await db.rpc("intervention_action", {
      p_id: id,
      p_action: data.action,
      p_lines: data.lines ?? null,
      p_tax_rate: data.tax_rate ?? null,
      p_quote_id: data.quote_id ?? null,
    });
    if (error?.code === "P0001" && error.message === "report_photos_required")
      throw new ApiError(409, "Enregistrez le compte rendu avec les photos avant et après pour terminer l’intervention.");
    dbError(error);
    return Response.json({ intervention: result });
  } catch (error) {
    return apiError(error);
  }
}
