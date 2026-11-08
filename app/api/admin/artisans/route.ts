import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z.object({
  user_id: uuid,
  command_id: uuid,
  action: z.enum(["approve", "request_changes", "suspend", "reinstate"]),
  expected_version: z.number().int().min(0).max(2147483646),
}).strict();
const artisanSchema = z.object({ id: uuid, full_name: z.string(), artisan_approved: z.boolean(), created_at: z.iso.datetime({ offset: true }) }).strict();
const applicationSchema = z.object({ user_id: uuid, application_version: z.number().int().positive(), application_status: z.enum(["draft", "submitted", "changes_requested", "approved", "suspended"]) }).strict();
const privateHeaders = { "Cache-Control": "private, no-store" };
const unavailable = () => new ApiError(503, "Les dossiers artisans sont momentanément indisponibles. Réessayez.");
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); if (response.status === 503) response.headers.set("Retry-After", "2"); return response; }
export async function GET() {
  try {
    const { db, user } = await authenticatedClient();
    const profile = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
    const result = await db.from("profiles").select("id,full_name,artisan_approved,created_at", { count: "exact" }).eq("role", "artisan").order("created_at", { ascending: false }).limit(101);
    if (result.error || !Number.isSafeInteger(result.count) || result.count! < 0 || !Array.isArray(result.data) || result.data.length !== Math.min(result.count!, 101)) throw unavailable();
    const parsed = z.array(artisanSchema).max(101).safeParse(result.data);
    if (!parsed.success || new Set(parsed.data.map(p => p.id)).size !== parsed.data.length) throw unavailable();
    const rows = parsed.data.slice(0, 100), ids = rows.map(p => p.id);
    const applications = ids.length
      ? await db.from("artisan_profiles").select("user_id,application_status,application_version", { count: "exact" }).in("user_id", ids).limit(100)
      : { data: [], error: null, count: 0 };
    if (applications.error || !Number.isSafeInteger(applications.count) || applications.count! < 0 || applications.count! > ids.length || !Array.isArray(applications.data) || applications.data.length !== applications.count) throw unavailable();
    const dossiers = z.array(applicationSchema).max(100).safeParse(applications.data);
    if (!dossiers.success || new Set(dossiers.data.map(p => p.user_id)).size !== dossiers.data.length || dossiers.data.some(p => !ids.includes(p.user_id))) throw unavailable();
    const byId = new Map(dossiers.data.map(p => [p.user_id, p]));
    return Response.json({ artisans: rows.map(p => ({ ...p, application_status: byId.get(p.id)?.application_status ?? null, application_version: byId.get(p.id)?.application_version ?? 0 })), limit: 100, truncated: result.count! > 100 }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    const { error } = await db.rpc("decide_artisan_application", { p_user_id: data.user_id, p_action: data.action, p_expected_version: data.expected_version, p_command_id: data.command_id });
    if (error?.code === "P0001" && error.message === "A complete submitted application is required for approval or reinstatement")
      throw new ApiError(422, "Un dossier complet et soumis est requis pour approuver ou réactiver cet artisan.");
    dbError(error);
    return Response.json({ success: true }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
