import { z } from "zod";
import {
  authenticatedClient, ApiError, apiError, assertOrigin, dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
const command = z.object({
  command_id: uuid, grid_id: uuid.nullable(),
  expected_version: z.number().int().min(1).max(2147483646).nullable(),
}).strict();
const reference = z.object({
  grid_id: uuid.nullable(), version: z.number().int().positive().nullable(),
});
const editor = reference.extend({
  grids: z.array(z.object({
    id: uuid, label: z.string().min(1).max(160), version: z.number().int().positive(),
  }).strict()).max(20),
  next_cursor: uuid.nullable(),
}).strict();
const receipt = reference.extend({
  version: z.number().int().positive(), replayed: z.boolean(),
}).strict();

function failure(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function target({ params }: Context) {
  const parsed = uuid.safeParse((await params).id);
  if (!parsed.success) throw new ApiError(422, "Référence de dossier invalide.");
  return parsed.data;
}

export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await target(context);
    const params = new URL(request.url).searchParams;
    const after = uuid.nullable().safeParse(params.get("after"));
    if (!after.success || params.size !== (params.has("after") ? 1 : 0))
      throw new ApiError(422, "Curseur invalide.");
    const result = await db.rpc("read_quote_grid_access", { p_id: id, p_after: after.data });
    dbError(result.error);
    const parsed = editor.safeParse(result.data);
    if (!parsed.success || (parsed.data.grid_id !== null && parsed.data.version === null))
      throw new ApiError(503, "La grille autorisée doit être vérifiée.");
    return Response.json(parsed.data, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await target(context);
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, command);
    const result = await db.rpc("write_quote_grid_access", {
      p_id: id, p_command_id: input.command_id, p_grid_id: input.grid_id,
      p_expected_version: input.expected_version,
    });
    dbError(result.error);
    const parsed = receipt.safeParse(result.data);
    if (!parsed.success || parsed.data.version !== (input.expected_version ?? 0) + 1 ||
        parsed.data.grid_id !== (input.grid_id?.toLowerCase() ?? null))
      throw new ApiError(503, "Vérifiez l’autorisation avant de réessayer.");
    return Response.json(parsed.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
