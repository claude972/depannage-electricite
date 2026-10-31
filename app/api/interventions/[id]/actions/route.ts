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
    lines: z.array(quoteLine).min(1).max(30).optional(),
    tax_rate: z
      .union([z.literal(0), z.literal(5.5), z.literal(10), z.literal(20)])
      .optional(),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const { id } = await context.params;
    if (!uuid.safeParse(id).success)
      throw new ApiError(422, "Identifiant de dossier invalide.");
    const data = await validated(request, schema);
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
      p_tax_rate: data.tax_rate ?? 20,
    });
    dbError(error);
    return Response.json({ intervention: result });
  } catch (error) {
    return apiError(error);
  }
}
