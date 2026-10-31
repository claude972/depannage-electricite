import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, listRows, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { RefundRequest } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const refundFields = "id,request_id,payment_id,amount_cents,currency,reason,status,version,requested_by,created_at,updated_at,decided_by,decided_at,decision_note,provider_reference,settled_event_id,settled_at";
const schema = z.object({ request_id: uuid, payment_id: uuid, amount_cents: z.number().int().min(1).max(10000000), reason: z.string().trim().min(10).max(2000).regex(/^[^\u0000]*$/) }).strict();
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const list = await listRows<RefundRequest>(db, request, { table: "platform_refund_requests", fields: refundFields, order: "created_at", allowed: ["status", "payment_id"], filters: { status: z.enum(["requested", "approved", "rejected", "cancelled", "settled"]).nullable(), payment_id: uuid.nullable() } });
    return ok({ requests: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
/** Creates a request only. Nothing here moves money; settlement is service-only with a provider event. */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "finance_write");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_request_refund", { p_request_id: data.request_id, p_payment_id: data.payment_id, p_amount_cents: data.amount_cents, p_reason: data.reason });
    dbError(result.error);
    return ok(objectResult(result.data, "La demande de remboursement n’a pas été confirmée."), 201);
  } catch (error) { return failed(error); }
}
