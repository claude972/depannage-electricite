import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_invitation"), organization_id: uuid, email: z.email().trim().toLowerCase().max(320), role: z.enum(["manager", "viewer"]), expires_in_days: z.number().int().min(1).max(14).default(7), site_scope: z.enum(["all", "selected"]).default("all"), site_grants: z.array(z.object({ site_id: uuid, can_write: z.boolean() }).strict()).max(100).default([]) }).strict(),
  z.object({ action: z.literal("revoke_invitation"), organization_id: uuid, invitation_id: uuid }).strict(),
  z.object({ action: z.literal("change_member_role"), organization_id: uuid, user_id: uuid, role: z.enum(["manager", "viewer"]) }).strict(),
  z.object({ action: z.literal("remove_member"), organization_id: uuid, user_id: uuid }).strict(),
  z.object({ action: z.literal("transfer_ownership"), organization_id: uuid, user_id: uuid }).strict(),
]);
export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get("organization_id");
    if (!uuid.safeParse(organizationId).success) throw new ApiError(422, "Choisissez une organisation valide.");
    const { db } = await authenticatedClient(request);
    const result = await db.rpc("organization_member_overview", { p_organization_id: organizationId });
    dbError(result.error);
    return Response.json(result.data, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    if (data.action === "create_invitation") {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await db.rpc("create_organization_invitation", { p_organization_id: data.organization_id, p_email: data.email, p_role: data.role, p_token_hash: tokenHash, p_expires_in_days: data.expires_in_days, p_site_scope: data.site_scope, p_site_grants: data.site_grants });
      dbError(result.error);
      // A fragment is not sent as a request URL to the app, analytics or the server.
      // The code is revealed only in this no-store response, never listed later or logged here.
      return Response.json({ invitation: result.data, invitation_code: token, invite_url: `${new URL(request.url).origin}/#join-organization/${token}`, delivery: "manual_share" }, { headers: privateHeaders });
    }
    const common = { p_organization_id: data.organization_id };
    const result = data.action === "revoke_invitation"
      ? await db.rpc("revoke_organization_invitation", { ...common, p_invitation_id: data.invitation_id })
      : data.action === "change_member_role"
        ? await db.rpc("change_organization_member_role", { ...common, p_user_id: data.user_id, p_role: data.role })
        : data.action === "remove_member"
          ? await db.rpc("remove_organization_member", { ...common, p_user_id: data.user_id })
          : await db.rpc("transfer_organization_ownership", { ...common, p_user_id: data.user_id });
    dbError(result.error);
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
