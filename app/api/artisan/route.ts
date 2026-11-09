import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), company_name: z.string().trim().max(160), siret: z.string().regex(/^(?:\d{14})?$/), legal_status: z.string().trim().max(80), employee_count: z.number().int().min(0).max(100000), address: z.string().trim().max(500), postal_codes: z.array(z.string().regex(/^\d{5}$/)).max(100), categories: z.array(z.enum(["outage", "panel", "socket", "lighting", "diagnostic"])).max(5) }).strict(),
  z.object({ action: z.literal("submit_application") }).strict(),
  z.object({ action: z.literal("set_availability"), available: z.boolean() }).strict(),
  z.object({ action: z.literal("set_capacity_limit"), capacity_limit: z.number().int().min(1).max(2147483647).nullable(),
    expected_version: z.number().int().min(0).max(2147483647) }).strict(),
  z.object({ action: z.literal("link_credential"), document_id: uuid, kind: z.enum(["registration", "liability", "qualification", "other"]), expires_on: z.iso.date().nullable() }).strict(),
]);
const privateHeaders = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const target = new URL(request.url).searchParams.get("user_id") ?? user.id;
    if (!uuid.safeParse(target).success) throw new ApiError(422, "Identifiant artisan invalide.");
    const profile = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "admin" && (profile.data?.role !== "artisan" || target !== user.id)) throw new ApiError(403, "Accès réservé à votre dossier artisan.");
    const [artisan, credentials] = await Promise.all([
      db.from("artisan_profiles").select("*").eq("user_id", target).maybeSingle(),
      db.from("artisan_credentials").select("*").eq("user_id", target).order("created_at", { ascending: false }).limit(100),
    ]);
    dbError(artisan.error); dbError(credentials.error);
    return Response.json({ artisan_profile: artisan.data, credentials: credentials.data }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    let result;
    switch (data.action) {
      case "save_profile":
        result = await db.rpc("save_artisan_profile", { p_company_name: data.company_name, p_siret: data.siret, p_legal_status: data.legal_status, p_employee_count: data.employee_count, p_address: data.address, p_postal_codes: [...new Set(data.postal_codes)], p_categories: [...new Set(data.categories)] }); break;
      case "submit_application": result = await db.rpc("submit_artisan_application"); break;
      case "set_availability": result = await db.rpc("set_artisan_availability", { p_available: data.available }); break;
      case "set_capacity_limit": result = await db.rpc("set_artisan_capacity_limit", { p_limit: data.capacity_limit, p_expected_version: data.expected_version }); break;
      case "link_credential": result = await db.rpc("link_artisan_credential", { p_document_id: data.document_id, p_kind: data.kind, p_expires_on: data.expires_on }); break;
    }
    dbError(result.error);
    return Response.json({ [data.action === "link_credential" ? "credential" : "artisan_profile"]: result.data }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
