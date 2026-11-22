// SYS-09 — execution of an approved erasure request by an administrator.
//   GET  → { request_state, execution | null, can_execute, plan | null }
//   POST { command_id, confirmation: "EFFACER" } → { execution, replayed }
// Rights: the request is read with the caller's session through the review command (assistance
// scope required, 403 otherwise); executing additionally requires the administrator role. The
// erasure itself runs with the service client, after those checks. Irreversible: the body must carry
// the confirmation word typed by the administrator.
import { z } from "zod";
import { adminClient, apiError, ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { checked, privateHeaders, requestSchema } from "@/lib/features/data-requests/contracts";
import { CONFIRMATION_WORD, erasurePlan, executeErasure, readExecutions } from "@/lib/features/data-requests/erasure-execution";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const command = z.object({ command_id: z.uuid(), confirmation: z.string().max(40) }).strict();
function failed(error: unknown) { const response = apiError(error); for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value); return response; }
async function context(request: Request, ctx: Context) {
  const { db, user } = await authenticatedClient(request);
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success || new URL(request.url).searchParams.size) throw new ApiError(422, "Demande invalide.");
  // Same read as the review screen: refuses (403) anyone without the assistance scope.
  const review = await db.rpc("get_data_erasure_review", { p_id: id.data });
  dbError(review.error);
  const receipt = checked(z.object({ request: requestSchema }), review.data);
  if (receipt.request.id !== id.data) throw new ApiError(503, "Demande à vérifier.");
  const profile = await db.from("profiles").select("role").eq("id", user.id).single();
  dbError(profile.error);
  return { user, request: receipt.request, isAdmin: profile.data?.role === "admin" };
}
const unavailable = () => new ApiError(503, "L’état de l’effacement est momentanément indisponible. Réessayez.");
export async function GET(request: Request, ctx: Context) {
  try {
    const { user, request: row, isAdmin } = await context(request, ctx);
    const admin = adminClient();
    const execution = (await readExecutions(admin, [row.ticket_id]).catch(() => { throw unavailable(); })).get(row.id) ?? null;
    // The plan (what blocks, what is kept) is only prepared for an administrator on an approved request.
    const plan = !execution && isAdmin && row.state === "approved" ? await erasurePlan(admin, row.account_id, user.id).catch(() => { throw unavailable(); }) : null;
    return Response.json({ request_state: row.state, execution, can_execute: Boolean(plan?.eligible), administrator: isAdmin, plan, confirmation_word: CONFIRMATION_WORD }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request, ctx: Context) {
  try {
    assertOrigin(request);
    const { user, request: row, isAdmin } = await context(request, ctx);
    const input = await validated(request, command, "Commande d’effacement invalide.");
    if (!isAdmin) throw new ApiError(403, "L’exécution d’un effacement est réservée aux administrateurs de la plateforme.");
    if (input.confirmation !== CONFIRMATION_WORD) throw new ApiError(422, `Saisissez ${CONFIRMATION_WORD} pour confirmer : l’effacement est irréversible.`);
    if (row.state !== "approved") throw new ApiError(409, "Seule une demande approuvée peut être exécutée.");
    let outcome;
    try { outcome = await executeErasure(adminClient(), { requestId: row.id, ticketId: row.ticket_id, accountId: row.account_id, actorId: user.id }); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, "L’effacement n’a pas pu être mené à son terme ou consigné. Relisez la demande avant de réessayer : les étapes déjà faites ne sont pas rejouées à tort."); }
    if (outcome.kind === "refused") return Response.json({ error: outcome.message, blockers: outcome.blockers ?? [] }, { status: outcome.status, headers: privateHeaders });
    return Response.json({ execution: outcome.execution, replayed: outcome.replayed }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
