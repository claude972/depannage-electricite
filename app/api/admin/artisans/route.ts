import { z } from "zod";
import { authenticatedClient, adminClient, apiError, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { uuid, validated } from "@/lib/supabase/validation";
const schema = z.object({
  user_id: uuid,
  command_id: uuid,
  action: z.enum(["approve", "request_changes", "suspend", "reinstate"]),
  expected_version: z.number().int().min(0).max(2147483646),
  // ADM-02: reason of the application-level decision, shared with the artisan and kept in the decision log.
  reason: z.string().trim().min(10).max(500).regex(/^[^\u0000]*$/).optional(),
}).strict();
const decisionTitles = { approve: "Candidature approuvée", request_changes: "Compléments demandés sur votre candidature", suspend: "Compte professionnel suspendu", reinstate: "Compte professionnel réactivé" } as const;
const decisionRows = z.array(z.object({ id: uuid, actor_id: uuid.nullable(), created_at: z.iso.datetime({ offset: true }), payload: z.object({ application_decision: schema.shape.action, reason: z.string().min(1).max(500), application_version: z.number().int().nonnegative() }) })).max(20);
/** Decision log + payment-account state of one artisan. Read with the service role only after the
 *  caller's administrator role has been established by the session client. */
async function artisanFile(userId: string) {
  const admin = adminClient();
  const [account, log] = await Promise.all([
    admin.from("profiles").select("id,role,stripe_account_id").eq("id", userId).maybeSingle(),
    admin.from("notifications").select("id,actor_id,created_at,payload").eq("recipient_id", userId).in("kind", ["account_approved", "account_suspended"])
      .not("payload->>application_decision", "is", null).order("created_at", { ascending: false }).limit(20),
  ]);
  if (account.error || log.error) throw unavailable();
  if (!account.data || account.data.role !== "artisan") throw new ApiError(404, "Cet artisan est introuvable.");
  const rows = decisionRows.safeParse(log.data);
  if (!rows.success) throw unavailable();
  const accountId: string | null = account.data.stripe_account_id ?? null;
  // Same readiness rule as the checkout: the recipient transfer capability must be active.
  let transfers: "active" | "inactive" | "unknown" | null = null;
  if (accountId) {
    try {
      const remote = await stripeClient().v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
      transfers = remote.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active" ? "active" : "inactive";
    } catch { transfers = "unknown"; }
  }
  return {
    payment_account: { linked: Boolean(accountId), transfers },
    decisions: rows.data.map(row => ({ id: row.id, actor_id: row.actor_id, decided_at: row.created_at, action: row.payload.application_decision, reason: row.payload.reason, application_version: row.payload.application_version })),
  };
}
const artisanSchema = z.object({ id: uuid, full_name: z.string(), artisan_approved: z.boolean(), created_at: z.iso.datetime({ offset: true }) }).strict();
const applicationSchema = z.object({ user_id: uuid, application_version: z.number().int().positive(), application_status: z.enum(["draft", "submitted", "changes_requested", "approved", "suspended"]) }).strict();
const privateHeaders = { "Cache-Control": "private, no-store" };
const unavailable = () => new ApiError(503, "Les dossiers artisans sont momentanément indisponibles. Réessayez.");
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); if (response.status === 503) response.headers.set("Retry-After", "2"); return response; }
export async function GET(request?: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    const profile = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
    const params = request ? new URL(request.url).searchParams : null;
    if (params?.size) {
      const target = uuid.safeParse(params.get("user_id"));
      if (params.size !== 1 || !target.success) throw new ApiError(422, "Identifiant d’artisan invalide.");
      return Response.json(await artisanFile(target.data.toLowerCase()), { headers: privateHeaders });
    }
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
    const { db, user } = await authenticatedClient(request);
    const data = await validated(request, schema);
    const { error } = await db.rpc("decide_artisan_application", { p_user_id: data.user_id, p_action: data.action, p_expected_version: data.expected_version, p_command_id: data.command_id });
    if (error?.code === "P0001" && error.message === "A complete submitted application is required for approval or reinstatement")
      throw new ApiError(422, "Un dossier complet et soumis est requis pour approuver ou réactiver cet artisan.");
    dbError(error);
    // The SQL command has verified the administrator and applied the decision. Its reason is then
    // delivered to the artisan and kept as the decision log; a replayed command writes it once.
    let reasonRecorded: boolean | undefined;
    if (data.reason) {
      try {
        const saved = await adminClient().from("notifications").upsert({
          recipient_id: data.user_id, kind: data.action === "approve" || data.action === "reinstate" ? "account_approved" : "account_suspended",
          title: decisionTitles[data.action], body: `Motif communiqué par l’exploitant : ${data.reason}`.slice(0, 600), actor_id: user.id,
          payload: { application_decision: data.action, reason: data.reason, application_version: data.expected_version },
          dedupe_key: `application-decision:${data.command_id}`,
        }, { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true });
        reasonRecorded = !saved.error;
      } catch { reasonRecorded = false; }
    }
    return Response.json({ success: true, ...(reasonRecorded === undefined ? {} : { reason_recorded: reasonRecorded }) }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
