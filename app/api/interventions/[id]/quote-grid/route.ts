import {
  authenticatedClient, ApiError, apiError, assertOrigin, dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { appliedGrid, applyGrid, gridOptions } from "@/lib/features/contract-quote-pricing/contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function interventionId({ params }: Context) {
  const target = uuid.safeParse((await params).id);
  if (!target.success) throw new ApiError(422, "Référence de dossier invalide.");
  return target.data.toLowerCase();
}

export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await interventionId(context);
    const params = new URL(request.url).searchParams;
    const after = uuid.nullable().safeParse(params.get("after"));
    if (!after.success || params.size !== (params.has("after") ? 1 : 0))
      throw new ApiError(422, "Curseur invalide.");
    const result = await db.rpc("read_quote_grid_options", { p_id: id, p_after: after.data });
    dbError(result.error);
    const options = gridOptions.safeParse(result.data);
    if (!options.success) throw new ApiError(503, "Les grilles applicables doivent être vérifiées.");
    return Response.json(options.data, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    const id = await interventionId(context);
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, applyGrid);
    const result = await db.rpc("apply_quote_contract_grid", {
      p_id: id,
      p_grid_id: input.grid_id,
      p_grid_version: input.grid_version,
      p_selection: input.selection,
      p_expected_version: input.expected_version,
      p_assignment_token: input.assignment_token,
      p_base_quote_id: input.base_quote_id,
      p_tax_rate: input.tax_rate,
    });
    dbError(result.error);
    const saved = appliedGrid.safeParse(result.data);
    if (!saved.success || saved.data.draft.intervention_id !== id ||
        saved.data.draft.artisan_id !== user.id ||
        saved.data.version !== input.expected_version + 1 ||
        saved.data.draft.version !== saved.data.version ||
        saved.data.assignment_token !== input.assignment_token ||
        saved.data.draft.assignment_token !== input.assignment_token)
      throw new ApiError(503, "Vérifiez le brouillon avant de réessayer.");
    return Response.json(saved.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
