import { z } from "zod";
import {
  authenticatedClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const version = z.number().int().min(1).max(2147483647);
const input = z
  .object({
    command_id: uuid,
    payer_id: uuid.nullable(),
    expected_version: version.max(2147483646).nullable(),
  })
  .strict();
const receipt = z
  .object({
    intervention_id: uuid,
    payer_id: uuid.nullable(),
    version,
    replayed: z.boolean(),
  })
  .strict();
const status = z
  .object({
    intervention_id: uuid,
    payer_id: uuid.nullable(),
    version: version.nullable(),
    can_manage: z.boolean(),
    can_checkout: z.boolean(),
    delegate_current: z.boolean(),
    external_session_pending: z.boolean(),
    link: z.string(),
  })
  .strict();
type Context = { params: Promise<{ id: string }> };
const fail = (e: unknown) => {
  const code =
    e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : "La délégation de paiement doit être vérifiée. Réessayez.",
    },
    {
      status: code,
      headers: { ...headers, ...(code === 503 ? { "Retry-After": "2" } : {}) },
    },
  );
};
async function scope(request: Request, context: Context) {
  const id = uuid.safeParse((await context.params).id);
  if (!id.success || new URL(request.url).searchParams.size)
    throw new ApiError(422, "Référence invalide.");
  return id.data.toLowerCase();
}
export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await scope(request, context);
    const r = await db.rpc("intervention_payer_status", {
      p_intervention_id: id,
    });
    dbError(r.error);
    const data = status.parse(r.data);
    if (
      data.intervention_id !== id ||
      data.link !== `/#detail/${id}` ||
      (data.version === null && data.payer_id !== null)
    )
      throw Error("Scope");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await scope(request, context);
    const c = await validated(request, input);
    const r = await db.rpc("set_intervention_payer", {
      p_intervention_id: id,
      p_command_id: c.command_id.toLowerCase(),
      p_payer_id: c.payer_id?.toLowerCase() ?? null,
      p_expected_version: c.expected_version,
    });
    dbError(r.error);
    const data = receipt.parse(r.data);
    if (
      data.intervention_id !== id ||
      data.payer_id !== (c.payer_id?.toLowerCase() ?? null) ||
      data.version !== (c.expected_version ?? 0) + 1
    )
      throw Error("Unconfirmed receipt");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
