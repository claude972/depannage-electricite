import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, listRows, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
import { PLATFORM_SCOPES, type OperatorGrant } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const fields = "id,user_id,scope,status,note,granted_by,granted_at,revoked_by,revoked_at,revoke_note";
const scope = z.enum(PLATFORM_SCOPES as unknown as [string, ...string[]]);
const accountRole = z.enum(["client", "manager", "artisan", "admin"]);
const note = z.string().max(500).regex(/^[^\u0000]*$/);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), user_id: uuid, scope, note }).strict(),
  z.object({ action: z.literal("revoke"), grant_id: uuid, note }).strict(),
]);
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "super_admin");
    const list = await listRows<OperatorGrant>(db, request, { table: "platform_operator_grants", fields, order: "granted_at", allowed: ["status", "scope", "user_id"], filters: { status: z.enum(["active", "revoked"]).nullable(), scope: scope.nullable(), user_id: uuid.nullable() } });
    const ids = [...new Set(list.rows.map((g) => g.user_id))];
    const profiles = ids.length ? await db.from("profiles").select("id,full_name,role").in("id", ids) : { data: [], error: null };
    dbError(profiles.error);
    const byId = new Map((profiles.data ?? []).map((p) => [p.id, p]));
    const grants = list.rows.map((grant) => {
      const profile = byId.get(grant.user_id);
      const role = accountRole.safeParse(profile?.role);
      return { ...grant, full_name: profile?.full_name ?? null, account_role: role.success ? role.data : null };
    });
    return ok({ grants, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "super_admin");
    const data = await validated(request, bodySchema);
    const result = data.action === "grant"
      ? await db.rpc("platform_grant_scope", { p_user_id: data.user_id, p_scope: data.scope, p_note: data.note })
      : await db.rpc("platform_revoke_scope", { p_grant_id: data.grant_id, p_note: data.note });
    dbError(result.error);
    return ok(objectResult(result.data, "La modification des droits n’a pas été confirmée."));
  } catch (error) { return failed(error); }
}
