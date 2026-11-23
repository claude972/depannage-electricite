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
  // Counted in characters (code points), like the database (char_length), not in UTF-16 units.
  reason: z.string().trim().regex(/^[^\u0000]*$/)
    .refine((value) => [...value].length >= 10, "Le motif doit compter au moins 10 caractères : il est conservé et communiqué à l’artisan.")
    .refine((value) => [...value].length <= 500, "Le motif ne peut pas dépasser 500 caractères.").optional(),
  // ADM-02 (web): « request_changes » with `definitive` is a refusal. The dossier has no refused state:
  // it is sent back (changes_requested), the decision log says it is refused and the artisan cannot
  // submit it again through the application until an administrator reopens it (action « reopen »).
  definitive: z.boolean().optional(),
}).strict();
/** Reopening a refused application changes no dossier state: it only lifts the refusal in the decision log. */
const reopenSchema = z.object({ user_id: uuid, command_id: uuid, action: z.literal("reopen"), expected_version: z.number().int().min(0).max(2147483646), reason: z.string("Indiquez le motif de la réouverture (10 à 500 caractères).").trim().min(10, "Le motif doit compter au moins 10 caractères.").max(500, "Le motif ne peut pas dépasser 500 caractères.").regex(/^[^\u0000]*$/) }).strict();
/** Decisions that take something away from the artisan: the reason is mandatory (422 without it). */
const NEGATIVE_ACTIONS: readonly string[] = ["request_changes", "suspend"];
const REASON_REQUIRED = "Indiquez le motif de cette décision (10 à 500 caractères) : il est conservé dans l’historique et communiqué à l’artisan.";
const decisionTitles = { approve: "Candidature approuvée", request_changes: "Compléments demandés sur votre candidature", suspend: "Compte professionnel suspendu", reinstate: "Compte professionnel réactivé" } as const;
const decisionRows = z.array(z.object({ id: uuid, actor_id: uuid.nullable(), created_at: z.iso.datetime({ offset: true }), payload: z.object({ application_decision: schema.shape.action, reason: z.string().min(1).max(500), application_version: z.number().int().nonnegative(), definitive: z.boolean().optional(), reopened: z.boolean().optional() }) })).max(20);
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
    decisions: rows.data.map(row => ({ id: row.id, actor_id: row.actor_id, decided_at: row.created_at, action: row.payload.application_decision, reason: row.payload.reason, application_version: row.payload.application_version, ...(row.payload.definitive ? { definitive: true } : {}), ...(row.payload.reopened ? { reopened: true } : {}) })),
  };
}
const artisanSchema = z.object({ id: uuid, full_name: z.string(), artisan_approved: z.boolean(), created_at: z.iso.datetime({ offset: true }) }).strict();
const applicationSchema = z.object({ user_id: uuid, application_version: z.number().int().positive(), application_status: z.enum(["draft", "submitted", "changes_requested", "approved", "suspended"]) }).strict();
const privateHeaders = { "Cache-Control": "private, no-store" };
const unavailable = () => new ApiError(503, "Les dossiers artisans sont momentanément indisponibles. Réessayez.");
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); if (response.status === 503) response.headers.set("Retry-After", "2"); return response; }
// Next validates route handlers against a required Request: an optional parameter fails the build.
export async function GET(request: Request) {
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
    // ADM-02: a dossier sent back whose latest recorded decision is a refusal is shown as refused. The
    // decision log is a convenience here: when it cannot be read the rows simply carry no `refused`.
    const refused = new Set<string>();
    const sentBack = dossiers.data.filter(p => p.application_status === "changes_requested").map(p => p.user_id);
    if (sentBack.length) {
      try {
        const log = await adminClient().from("notifications").select("recipient_id,payload,created_at").in("recipient_id", sentBack).in("kind", ["account_approved", "account_suspended"])
          .not("payload->>application_decision", "is", null).order("created_at", { ascending: false }).limit(1000);
        const seen = new Set<string>();
        for (const row of (log.error ? [] : log.data) ?? []) {
          if (typeof row.recipient_id !== "string" || seen.has(row.recipient_id)) continue;
          seen.add(row.recipient_id);
          if ((row.payload as { definitive?: unknown } | null)?.definitive === true) refused.add(row.recipient_id);
        }
      } catch { refused.clear(); }
    }
    return Response.json({ artisans: rows.map(p => ({ ...p, application_status: byId.get(p.id)?.application_status ?? null, application_version: byId.get(p.id)?.application_version ?? 0, ...(refused.has(p.id) ? { refused: true } : {}) })), limit: 100, truncated: result.count! > 100 }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient(request);
    const data = await validated(request, z.discriminatedUnion("action", [schema, reopenSchema]));
    if (data.action === "reopen") {
      // No SQL command runs here, so the administrator role is established explicitly first.
      const profile = await db.from("profiles").select("role").eq("id", user.id).single();
      dbError(profile.error);
      if (profile.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
      const admin = adminClient();
      const [dossier, last] = await Promise.all([
        admin.from("artisan_profiles").select("application_status,application_version").eq("user_id", data.user_id).maybeSingle(),
        admin.from("notifications").select("payload").eq("recipient_id", data.user_id).in("kind", ["account_approved", "account_suspended"])
          .not("payload->>application_decision", "is", null).order("created_at", { ascending: false }).limit(1),
      ]);
      if (dossier.error || last.error) throw unavailable();
      if (!dossier.data) throw new ApiError(404, "Cet artisan est introuvable.");
      if (dossier.data.application_version !== data.expected_version) throw new ApiError(409, "Ce dossier a changé depuis son affichage.");
      const lastPayload = (last.data?.[0]?.payload ?? null) as { definitive?: unknown } | null;
      if (dossier.data.application_status !== "changes_requested" || lastPayload?.definitive !== true) throw new ApiError(409, "Seule une candidature refusée peut être rouverte.");
      const saved = await admin.from("notifications").upsert({
        recipient_id: data.user_id, kind: "account_approved", title: "Candidature rouverte", actor_id: user.id,
        body: `Vous pouvez corriger puis soumettre à nouveau votre candidature. Motif communiqué par l’exploitant : ${data.reason}`.slice(0, 600),
        payload: { application_decision: "request_changes", reason: data.reason, application_version: data.expected_version, reopened: true },
        dedupe_key: `application-decision:${data.command_id}`,
      }, { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true });
      if (saved.error) throw unavailable();
      return Response.json({ success: true, reason_recorded: true }, { headers: privateHeaders });
    }
    if (NEGATIVE_ACTIONS.includes(data.action) && !data.reason) throw new ApiError(422, REASON_REQUIRED);
    if (data.definitive && data.action !== "request_changes") throw new ApiError(422, "Seule une candidature soumise peut être refusée.");
    const incomplete = (e: { code?: string; message?: string } | null) => e?.code === "P0001" && e.message === "A complete submitted application is required for approval or reinstatement";
    // The decision and its log entry (reason, « definitive ») are one SQL transaction (migration
    // 20261123090000): the refusal can no longer be lost between the two writes.
    const atomic = await db.rpc("record_artisan_application_decision", { p_user_id: data.user_id, p_action: data.action, p_expected_version: data.expected_version, p_command_id: data.command_id, p_reason: data.reason ?? null, p_definitive: data.definitive === true });
    if (!atomic.error) {
      const recorded = (atomic.data as { reason_recorded?: unknown } | null)?.reason_recorded;
      return Response.json({ success: true, ...(data.reason ? { reason_recorded: recorded === true } : {}) }, { headers: privateHeaders });
    }
    if (incomplete(atomic.error)) throw new ApiError(422, "Un dossier complet et soumis est requis pour approuver ou réactiver cet artisan.");
    // Only a database that does not have the command yet falls back to the two-step path below.
    if (atomic.error.code !== "PGRST202") dbError(atomic.error);
    const { error } = await db.rpc("decide_artisan_application", { p_user_id: data.user_id, p_action: data.action, p_expected_version: data.expected_version, p_command_id: data.command_id });
    if (incomplete(error))
      throw new ApiError(422, "Un dossier complet et soumis est requis pour approuver ou réactiver cet artisan.");
    dbError(error);
    // The SQL command has verified the administrator and applied the decision. Its reason is then
    // delivered to the artisan and kept as the decision log; a replayed command writes it once.
    let reasonRecorded: boolean | undefined;
    if (data.reason) {
      try {
        const saved = await adminClient().from("notifications").upsert({
          recipient_id: data.user_id, kind: data.action === "approve" || data.action === "reinstate" ? "account_approved" : "account_suspended",
          title: data.definitive ? "Candidature refusée" : decisionTitles[data.action], body: `Motif communiqué par l’exploitant : ${data.reason}`.slice(0, 600), actor_id: user.id,
          payload: { application_decision: data.action, reason: data.reason, application_version: data.expected_version, ...(data.definitive ? { definitive: true } : {}) },
          dedupe_key: `application-decision:${data.command_id}`,
        }, { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true });
        reasonRecorded = !saved.error;
      } catch { reasonRecorded = false; }
    }
    return Response.json({ success: true, ...(reasonRecorded === undefined ? {} : { reason_recorded: reasonRecorded }) }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
