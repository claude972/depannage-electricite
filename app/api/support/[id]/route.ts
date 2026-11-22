import { z } from "zod";
import { authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { supportOperatorPermissions, supportTicketPermissions } from "@/lib/features/support/permissions";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };
const ticketFields = "id,creator_id,intervention_id,subject,status,version,created_at,updated_at,last_message_at";
const messageFields = "id,ticket_id,author_id,author_kind,version,body,created_at";
const eventFields = "id,ticket_id,actor_id,kind,from_status,to_status,version,message_id,created_at";
const revision = z.number().int().min(1).max(2147483647);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), expected_version: revision, body: z.string().trim().min(1).max(4000).regex(/^[^\u0000]*$/) }).strict(),
  z.object({ action: z.literal("set_status"), expected_version: revision, status: z.enum(["open", "in_progress", "awaiting_user", "resolved"]) }).strict(),
]);
type Context = { params: Promise<{ id: string }> };
async function ticketId(context: Context) { const { id } = await context.params; if (!uuid.safeParse(id).success) throw new ApiError(422, "Identifiant de demande invalide."); return id; }
function invalid(): never { throw new ApiError(422, "Vérifiez les paramètres de l’historique."); }
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
function count(value: number | null): number { if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "Le comptage de l’historique est indisponible."); return value; }
export async function GET(request: Request, context: Context) {
  try {
    const { db, user } = await authenticatedClient(request); const id = await ticketId(context);
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["limit", "after_version"].includes(key) || params.getAll(key).length !== 1) invalid();
    const limitText = params.get("limit") ?? "50", afterText = params.get("after_version") ?? "0";
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText) || !/^(?:0|[1-9][0-9]{0,9})$/.test(afterText) || Number(afterText) > 2147483647) invalid();
    const limit = Number(limitText), after = Number(afterText);
    const ticket = await db.from("support_tickets").select(ticketFields).eq("id", id).maybeSingle(); dbError(ticket.error);
    if (!ticket.data) throw new ApiError(404, "Cette demande est introuvable.");
    const [events, eventTotal, messageTotal, rights] = await Promise.all([
      db.from("support_events").select(eventFields, { count: "exact" }).eq("ticket_id", id).gt("version", after).order("version").limit(limit + 1),
      db.from("support_events").select("id", { count: "exact", head: true }).eq("ticket_id", id),
      db.from("support_messages").select("id", { count: "exact", head: true }).eq("ticket_id", id),
      supportOperatorPermissions(db),
    ]);
    for (const result of [events, eventTotal, messageTotal]) dbError(result.error);
    const pageEvents = (events.data ?? []).slice(0, limit), hasMore = count(events.count) > pageEvents.length;
    const end = pageEvents.at(-1)?.version ?? after;
    if (hasMore && pageEvents.length === 0) throw new ApiError(503, "L’historique n’a pas été renvoyé. Réessayez.");
    const messages = pageEvents.length ? await db.from("support_messages").select(messageFields).eq("ticket_id", id).gt("version", after).lte("version", end).order("version").limit(limit) : { data: [], error: null };
    dbError(messages.error);
    return Response.json({ ticket: ticket.data, messages: messages.data ?? [], events: pageEvents,
      permissions: supportTicketPermissions(rights, user.id, ticket.data),
      page: { limit, after_version: after, next_after_version: hasMore ? end : null, has_more: hasMore, total_events: count(eventTotal.count), total_messages: count(messageTotal.count) },
    }, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request); const id = await ticketId(context);
    if (new URL(request.url).searchParams.size) invalid();
    const data = await validated(request, schema);
    const result = await db.rpc("mutate_support_ticket", { p_id: id, p_action: data.action, p_expected_version: data.expected_version,
      ...(data.action === "reply" ? { p_body: data.body } : { p_status: data.status }),
    });
    dbError(result.error);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new ApiError(503, "La modification n’a pas été confirmée.");
    return Response.json(result.data, { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
