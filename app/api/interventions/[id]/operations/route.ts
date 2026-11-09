import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decline_offer"), reason: z.string().trim().max(1000) }).strict(),
  z.object({ action: z.literal("reject_quote"), quote_id: uuid, reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("save_appointment"), expected_version: z.number().int().min(0).max(2147483646), starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), note: z.string().trim().max(2000) }).strict(),
  z.object({ action: z.literal("set_travel_stage"), stage: z.enum(["planned", "en_route", "on_site"]) }).strict(),
  z.object({ action: z.literal("save_report"), command_id: uuid, summary: z.string().trim().min(10).max(8000), checks: z.array(z.object({ label: z.string().trim().min(1).max(160), result: z.enum(["pass", "issue", "not_applicable"]) }).strict()).max(50), signature_name: z.string().trim().min(1, "Indiquez le nom du déclarant.").max(120) }).strict(),
  z.object({ action: z.literal("reassign"), artisan_id: uuid.nullable(), reason: z.string().trim().min(1).max(2000) }).strict(),
]);
const privateHeaders = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
async function checkedId(context: Context) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) throw new ApiError(422, "Identifiant de dossier invalide.");
  return id;
}
export async function GET(_request: Request, context: Context) {
  try {
    const id = await checkedId(context);
    const { db } = await authenticatedClient();
    // RLS determines dossier access before any dependent record is returned.
    const job = await db.from("interventions").select("id,travel_stage").eq("id", id).maybeSingle();
    dbError(job.error);
    if (!job.data) throw new ApiError(404, "Ce dossier est introuvable.");
    const [participants, appointment, report, history] = await Promise.all([
      db.rpc("intervention_participants", { p_id: id }),
      db.from("intervention_appointments").select("*").eq("intervention_id", id).maybeSingle(),
      db.from("intervention_reports").select("*").eq("intervention_id", id).maybeSingle(),
      db.from("intervention_operation_events").select("*").eq("intervention_id", id).order("id", { ascending: false }).limit(100),
    ]);
    dbError(participants.error); dbError(appointment.error); dbError(report.error); dbError(history.error);
    return Response.json({ participants: participants.data, appointment: appointment.data, report: report.data, history: history.data, history_limit: 100, travel_stage: job.data.travel_stage }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const id = await checkedId(context);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    let result;
    switch (data.action) {
      case "decline_offer": result = await db.rpc("decline_mission", { p_id: id, p_reason: data.reason }); break;
      case "reject_quote": result = await db.rpc("reject_intervention_quote", { p_id: id, p_quote_id: data.quote_id, p_reason: data.reason }); break;
      case "save_appointment": result = await db.rpc("save_intervention_appointment", { p_id: id, p_starts_at: data.starts_at, p_ends_at: data.ends_at, p_note: data.note, p_expected_version: data.expected_version }); break;
      case "set_travel_stage": result = await db.rpc("set_travel_stage", { p_id: id, p_stage: data.stage }); break;
      case "save_report": result = await db.rpc("save_intervention_report", { p_id: id, p_summary: data.summary, p_checks: data.checks, p_signature_name: data.signature_name, p_command_id: data.command_id }); break;
      case "reassign": result = await db.rpc("reassign_intervention", { p_id: id, p_artisan_id: data.artisan_id, p_reason: data.reason }); break;
    }
    dbError(result.error);
    return Response.json({ result: result.data, success: true }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
