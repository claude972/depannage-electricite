import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, invoiceFields, listRows, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { Invoice } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const basis = z.enum(["service", "platform_commission"]);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("readiness"), basis, payment_id: uuid }).strict(),
  z.object({ action: z.literal("issue"), request_id: uuid, basis, payment_id: uuid }).strict(),
  z.object({ action: z.literal("credit_note"), request_id: uuid, invoice_id: uuid, amount_cents: z.number().int().min(1).max(10000000), reason: z.string().trim().min(10).max(1000).regex(/^[^\u0000]*$/) }).strict(),
]);
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const list = await listRows<Invoice>(db, request, { table: "platform_invoices", fields: invoiceFields, order: "issued_at", allowed: ["kind", "basis", "payment_id"], filters: { kind: z.enum(["invoice", "credit_note"]).nullable(), basis: basis.nullable(), payment_id: uuid.nullable() } });
    return ok({ invoices: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    const data = await validated(request, schema);
    await requireScope(db, data.action === "readiness" ? "finance_read" : "finance_write");
    const result = data.action === "readiness"
      ? await db.rpc("platform_invoice_readiness", { p_basis: data.basis, p_payment_id: data.payment_id })
      : data.action === "issue"
        ? await db.rpc("platform_issue_invoice", { p_request_id: data.request_id, p_basis: data.basis, p_payment_id: data.payment_id })
        : await db.rpc("platform_issue_credit_note", { p_request_id: data.request_id, p_invoice_id: data.invoice_id, p_amount_cents: data.amount_cents, p_reason: data.reason });
    dbError(result.error);
    return ok(objectResult(result.data, "L’opération de facturation n’a pas été confirmée."));
  } catch (error) { return failed(error); }
}
