import { z } from "zod";
import { authenticatedClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { failed, listRows, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { AuditEntry } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const targetKind = z.enum(["operator", "super_admin", "setting", "reconciliation", "ledger", "invoice", "refund_request", "dispute", "review", "public_callback"]);
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "audit_read");
    const list = await listRows<AuditEntry>(db, request, { table: "platform_audit", fields: "id,actor_id,action,target_kind,target_id,details,created_at", order: "id", allowed: ["target_kind", "target_id", "actor_id"], filters: { target_kind: targetKind.nullable(), target_id: z.string().max(80).regex(/^[A-Za-z0-9:_-]*$/).nullable(), actor_id: uuid.nullable() } });
    return ok({ entries: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
