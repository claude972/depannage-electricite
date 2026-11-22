import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z
  .object({
    intervention_id: uuid,
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(2000),
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema, "Avis invalide : vérifiez la note (de 1 à 5) et le commentaire (2 000 caractères au plus).");
    const { data: review, error } = await db.rpc("submit_review", {
      p_intervention_id: data.intervention_id,
      p_rating: data.rating,
      p_body: data.body,
    });
    dbError(error, { duplicate: "Vous avez déjà laissé un avis pour cette intervention." });
    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
