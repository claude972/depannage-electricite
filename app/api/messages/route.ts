import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  ApiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { MessageHistoryError, messageHistoryQuery, readMessageHistory } from "@/lib/features/messages/history";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    return Response.json(await readMessageHistory(db, messageHistoryQuery(request.url)), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof MessageHistoryError)
      return Response.json({ error: error.message }, { status: error.status, headers: { ...privateHeaders, ...(error.status === 503 ? { "Retry-After": "2" } : {}) } });
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ error: "Connectez-vous pour accéder à cet espace." }, { status: 401, headers: privateHeaders });
    return Response.json({ error: "Les messages sont momentanément indisponibles. Réessayez." }, { status: 503, headers: { ...privateHeaders, "Retry-After": "2" } });
  }
}
const schema = z
  .object({ intervention_id: uuid, body: z.string().trim().min(1).max(4000) })
  .strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    const { data: result, error } = await db.rpc("send_message", {
      p_intervention_id: data.intervention_id,
      p_body: data.body,
    });
    dbError(error);
    return Response.json({ message: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
