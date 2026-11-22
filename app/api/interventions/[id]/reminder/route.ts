import {
  authenticatedClient,
  ApiError,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  state,
  command,
  receipt,
  interventionId,
} from "@/lib/features/appointment-reminders/contract";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
type Context = { params: Promise<{ id: string }> };
async function target(request: Request, context: Context) {
  const p = interventionId.safeParse((await context.params).id);
  if (!p.success || new URL(request.url).searchParams.size)
    throw new ApiError(422, "Référence ou paramètres invalides.");
  return p.data;
}
function failure(e: unknown) {
  const r = apiError(e);
  r.headers.set("Cache-Control", headers["Cache-Control"]);
  r.headers.set("Referrer-Policy", "no-referrer");
  if (r.status === 503) r.headers.set("Retry-After", "2");
  return r;
}
export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await target(request, context);
    const result = await db.rpc("read_appointment_reminder", {
      p_intervention_id: id,
    });
    dbError(result.error);
    const p = state.safeParse(result.data);
    if (
      !p.success ||
      p.data.intervention_id !== id ||
      (p.data.record && p.data.record.intervention_id !== id)
    )
      throw new ApiError(503, "Le rappel doit être vérifié. Réessayez.");
    return Response.json(p.data, { headers });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await target(request, context);
    const c = await validated(request, command);
    const result = await db.rpc("write_appointment_reminder", {
      p_intervention_id: id,
      p_command_id: c.command_id,
      p_action: c.action,
      p_expected_version: c.expected_version,
      p_appointment_version:
        c.action === "schedule" ? c.appointment_version : null,
      p_remind_at: c.action === "schedule" ? c.remind_at : null,
    });
    dbError(result.error);
    const p = receipt.safeParse(result.data);
    if (
      !p.success ||
      p.data.record.intervention_id !== id ||
      p.data.record.version !==
        (c.expected_version === null ? 1 : c.expected_version + 1) ||
      p.data.record.status !==
        (c.action === "schedule" ? "scheduled" : "cancelled") ||
      (c.action === "schedule" &&
        (p.data.record.appointment_version !== c.appointment_version ||
          Date.parse(p.data.record.remind_at) !== Date.parse(c.remind_at)))
    )
      throw new ApiError(
        503,
        "La commande doit être vérifiée avant une nouvelle tentative.",
      );
    return Response.json(p.data, { headers });
  } catch (e) {
    return failure(e);
  }
}
