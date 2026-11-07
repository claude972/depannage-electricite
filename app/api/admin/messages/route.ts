import { z } from "zod";
import { authenticatedClient, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const input = z.object({ id: z.uuid(), intervention_id: z.uuid(), body: z.string().trim().min(1).max(4000) }).strict();
const output = input.extend({ author_id: z.uuid(), created_at: z.iso.datetime({ offset: true }) }).strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (new URL(request.url).search) throw new ApiError(422, "Cette action n’accepte pas de filtre.");
    const { db, user } = await authenticatedClient();
    const command = await validated(request, input);
    const result = await db.rpc("admin_send_message", { p_id: command.id, p_intervention_id: command.intervention_id, p_body: command.body });
    dbError(result.error);
    const message = output.safeParse(result.data);
    if (!message.success || message.data.id !== command.id || message.data.intervention_id !== command.intervention_id || message.data.author_id !== user.id || message.data.body !== command.body)
      throw new ApiError(503, "L’envoi n’a pas pu être vérifié. Réessayez sans modifier votre message.");
    return Response.json({ message: message.data }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Le message n’a pas pu être envoyé. Réessayez." }, { status, headers: { ...headers, ...(status === 503 || status === 429 ? { "Retry-After": "2" } : {}) } });
  }
}
