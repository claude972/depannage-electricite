import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { siteColumns, siteCommand, siteRecord } from "@/lib/features/site-lifecycle/contract";
import { fail, privateHeaders, routeId, unavailable, type RouteContext } from "@/lib/features/site-lifecycle/http";

function refuseQuery(request: Request) {
  if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db } = await authenticatedClient();
    refuseQuery(request);
    const id = await routeId(context);
    const result = await db.from("sites").select(siteColumns).eq("id", id).maybeSingle();
    dbError(result.error);
    if (!result.data) throw new ApiError(404, "Ce site est introuvable.");
    const parsed = siteRecord.safeParse(result.data);
    if (!parsed.success || parsed.data.id !== id) throw unavailable();
    const permission = await db.rpc("can_manage_site", { p_site_id: id });
    dbError(permission.error);
    if (typeof permission.data !== "boolean") throw unavailable();
    return Response.json({ site: parsed.data, can_write: permission.data && parsed.data.archived_at === null }, { headers: privateHeaders });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    refuseQuery(request);
    const id = await routeId(context);
    const command = await validated(request, siteCommand);
    const result = await db.rpc("write_site_settings", {
      p_site_id: id,
      p_command_id: command.command_id,
      p_expected_version: command.expected_version,
      p_action: command.action,
      p_values: command.action === "save" ? command.values : null,
    });
    dbError(result.error);
    const parsed = siteRecord.safeParse(result.data);
    if (!parsed.success || parsed.data.id !== id || parsed.data.settings_version !== command.expected_version + 1
      || (parsed.data.archived_at !== null) !== (command.action === "archive")) throw unavailable();
    if (command.action === "save") {
      const { name, address, access_notes, opening_hours } = parsed.data;
      const expected = command.values;
      if (name !== expected.name || address !== expected.address || access_notes !== expected.access_notes
        || JSON.stringify(opening_hours) !== JSON.stringify(expected.opening_hours)) throw unavailable();
    }
    return Response.json({ site: parsed.data }, { headers: privateHeaders });
  } catch (error) {
    return fail(error);
  }
}
