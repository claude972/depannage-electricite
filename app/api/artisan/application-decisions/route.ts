// ADM-02 — the artisan reads the decisions taken on his own application, with their reasons.
// The decisions are the notifications written by POST /api/admin/artisans (payload
// `application_decision`); they are read with the service client for the signed-in artisan only,
// so muting a notification kind never hides the reason of a refusal or a suspension. The
// administrator's identity is not returned.
import { z } from "zod";
import { adminClient, apiError, ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const rows = z.array(z.object({
  id: z.string(), created_at: z.string(),
  payload: z.object({ application_decision: z.enum(["approve", "request_changes", "suspend", "reinstate"]), reason: z.string().min(1).max(500), application_version: z.number().int().nonnegative(), definitive: z.boolean().optional(), reopened: z.boolean().optional() }),
})).max(20);
type ArtisanApplicationDecision = { id: string; decided_at: string; kind: "approve" | "request_changes" | "reject" | "reopen" | "suspend" | "reinstate"; reason: string; application_version: number };
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const profile = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "artisan") throw new ApiError(403, "Accès réservé à votre dossier artisan.");
    const log = await adminClient().from("notifications").select("id,created_at,payload").eq("recipient_id", user.id).in("kind", ["account_approved", "account_suspended"])
      .not("payload->>application_decision", "is", null).order("created_at", { ascending: false }).limit(20);
    const parsed = log.error ? null : rows.safeParse(log.data);
    if (!parsed?.success) throw new ApiError(503, "L’historique des décisions est momentanément indisponible. Réessayez.");
    const decisions: ArtisanApplicationDecision[] = parsed.data.map(row => ({
      id: row.id, decided_at: row.created_at, reason: row.payload.reason, application_version: row.payload.application_version,
      kind: row.payload.reopened ? "reopen" : row.payload.definitive ? "reject" : row.payload.application_decision,
    }));
    return Response.json({ decisions, refused: decisions[0]?.kind === "reject" }, { headers: privateHeaders });
  } catch (error) {
    const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
