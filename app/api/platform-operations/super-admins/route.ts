import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ user_id: uuid, enabled: z.boolean(), restore_role: z.enum(["client", "manager"]).optional(), note: z.string().max(500).regex(/^[^\u0000]*$/) }).strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "super_admin");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_set_super_admin", { p_user_id: data.user_id, p_enabled: data.enabled, p_restore_role: data.restore_role ?? "client", p_note: data.note });
    dbError(result.error);
    return ok(objectResult(result.data, "La modification n’a pas été confirmée."));
  } catch (error) { return failed(error); }
}
