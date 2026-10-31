import { z } from "zod";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ action: z.enum(["review", "resolve", "close"]), expected_version: z.number().int().min(1), note: z.string().max(2000).regex(/^[^\u0000]*$/), outcome: z.enum(["refund_requested", "no_refund", "other"]).optional(), refund_request_id: uuid.nullable().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertOrigin(request);
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Ce litige est introuvable.");
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "finance_write");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_decide_dispute", { p_id: id, p_action: data.action, p_expected_version: data.expected_version, p_note: data.note, p_outcome: data.outcome ?? null, p_refund_request_id: data.refund_request_id ?? null });
    dbError(result.error);
    return ok(objectResult(result.data, "La décision n’a pas été confirmée."));
  } catch (error) { return failed(error); }
}
