import { z } from "zod";
import { authenticatedClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { failed, listRows, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { LedgerEntry } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const list = await listRows<LedgerEntry>(db, request, { table: "platform_ledger_entries", fields: "id,request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by,created_at", order: "created_at", allowed: ["entry_kind", "payment_id"], filters: { entry_kind: z.enum(["payment_settled", "commission_estimated", "commission_withheld", "refund_settled"]).nullable(), payment_id: uuid.nullable() } });
    return ok({ entries: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
