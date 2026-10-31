import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, listRows, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { Dispute } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const fields = "id,request_id,payment_id,intervention_id,origin,subject,description,status,outcome,refund_request_id,version,opened_by,created_at,updated_at,resolved_by,resolved_at,resolution_note";
const schema = z.object({ request_id: uuid, payment_id: uuid, origin: z.enum(["client", "artisan", "platform"]), subject: z.string().trim().min(4).max(160).regex(/^[^\u0000]*$/), description: z.string().trim().min(10).max(4000).regex(/^[^\u0000]*$/) }).strict();
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const list = await listRows<Dispute>(db, request, { table: "platform_disputes", fields, order: "created_at", allowed: ["status", "payment_id"], filters: { status: z.enum(["open", "under_review", "resolved", "closed"]).nullable(), payment_id: uuid.nullable() } });
    return ok({ disputes: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "finance_write");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_open_dispute", { p_request_id: data.request_id, p_payment_id: data.payment_id, p_origin: data.origin, p_subject: data.subject, p_description: data.description });
    dbError(result.error);
    return ok(objectResult(result.data, "Le litige n’a pas été confirmé."), 201);
  } catch (error) { return failed(error); }
}
