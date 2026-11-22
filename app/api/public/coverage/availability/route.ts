// CLI-03 — « aucun artisan disponible dans votre zone pour le moment ».
//   GET /api/public/coverage/availability?postal_code=NNNNN → { availability: "available" | "none" }
// The published coverage list (GET /api/public/coverage) says where the operator intends to serve;
// it does not say whether an artisan can take a request there today. This route answers that one
// question with the same rule as the offer eligibility (mission_eligible): an APPROVED artisan
// account whose approved application is marked available and lists the postal code.
// Read with the server credential, and reduced to a yes/no on the server: no identity, no count,
// no list of codes ever leaves this route. Informative only — a request is never blocked by it.
import { ApiError, adminClient, apiError } from "@/lib/supabase/server";
import { postalCode } from "@/lib/features/coverage/contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => new ApiError(503, "La disponibilité dans cette zone n’a pas pu être vérifiée.");
/** Bounded read: a handful of candidates is enough to answer yes/no. */
const CANDIDATES = 20;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const postal = postalCode.safeParse(params.get("postal_code"));
    if (params.size !== 1 || !postal.success) throw new ApiError(422, "Saisissez un code postal de cinq chiffres.");
    const admin = adminClient();
    const applications = await admin.from("artisan_profiles").select("user_id")
      .eq("application_status", "approved").eq("available", true)
      .contains("postal_codes", [postal.data]).limit(CANDIDATES);
    if (applications.error || !Array.isArray(applications.data)) throw unavailable();
    const ids = applications.data.map((row) => row.user_id).filter((id): id is string => typeof id === "string");
    let available = false;
    if (ids.length) {
      const accounts = await admin.from("profiles").select("id").in("id", ids).eq("role", "artisan").eq("artisan_approved", true).limit(1);
      if (accounts.error || !Array.isArray(accounts.data)) throw unavailable();
      available = accounts.data.length > 0;
    }
    return Response.json({ availability: available ? "available" : "none" }, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
