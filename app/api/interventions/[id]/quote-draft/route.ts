import { z } from "zod";
import { authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const revision = {
  expected_version: z.number().int().min(0).max(2147483647),
  assignment_token: z.string().regex(/^[a-f0-9]{64}$/),
};
const draftLine = z.object({ label: z.string().max(160), quantity: z.number().int().min(1).max(1000), unit_price_cents: z.number().int().min(0).max(10000000) }).strict();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), ...revision, base_quote_id: uuid.nullable(), lines: z.array(draftLine).max(30), tax_rate: z.union([z.literal(0),z.literal(5.5),z.literal(10),z.literal(20)]).nullable() }).strict(),
  z.object({ action: z.literal("discard"), ...revision }).strict(),
  z.object({ action: z.literal("send"), ...revision }).strict(),
]);
type Context = { params: Promise<{ id: string }> };
async function dossierId(context: Context) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) throw new ApiError(422, "Identifiant de dossier invalide.");
  return id;
}
function checkedResponse(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(503, "Le service de brouillon n’a pas renvoyé de résultat valide.");
  return Response.json(data, { headers: privateHeaders });
}
function failure(error: unknown) {
  const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
}
export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await dossierId(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Ce chargement n’accepte pas de paramètre supplémentaire.");
    const result = await db.rpc("manage_quote_draft", { p_id: id, p_action: "load" });
    dbError(result.error);
    return checkedResponse(result.data);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await dossierId(context);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Cette action n’accepte pas de paramètre supplémentaire.");
    const data = await validated(request, schema);
    const result = await db.rpc("manage_quote_draft", {
      p_id: id, p_action: data.action, p_expected_version: data.expected_version, p_assignment_token: data.assignment_token,
      ...(data.action === "save" ? { p_base_quote_id: data.base_quote_id, p_lines: data.lines, p_tax_rate: data.tax_rate } : {}),
    });
    dbError(result.error);
    return checkedResponse(result.data);
  } catch (error) { return failure(error); }
}
