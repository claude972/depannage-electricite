// ENT-06 — GET /api/enterprise/ticket-deadlines?site_id=<uuid>[&intervention_id=<uuid>]
// Read-only. Every read runs under the caller's own session (RLS + the site access check of the
// site operations snapshot): a member without access to the site, or a third party, is refused (403)
// before anything is computed. The deadline of each ticket is computed here, never in the browser.
import { z } from "zod";
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { historyRecord } from "@/lib/features/site-asset-links/schemas";
import { buildTicketDeadlines, type TicketRow } from "@/lib/features/enterprise-ticket-deadlines/model";
import type { SiteOperationsSnapshot } from "@/lib/features/site-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = z.uuid().transform((v) => v.toLowerCase());
const TICKET_LIMIT = 200;
const EQUIPMENT_LINK_LIMIT = 40;
const LINK_PAGES = 4;
const RESPONSE_ACTIONS = ["accept_mission", "admin_reassigned"];
const ticketSchema = z.object({
  id: uuid, status: z.string().min(1).max(40), urgency: z.string().min(1).max(40), category: z.string().min(1).max(80),
  description: z.string().max(4000), created_at: z.string().min(10), completed_at: z.string().nullable(),
});
const linkPage = z.object({ records: z.array(historyRecord).max(51), can_write: z.boolean(), site_archived: z.boolean() }).strict();

function failed(error: unknown) {
  const status = error instanceof ApiError ? error.status : 503;
  return Response.json(
    { error: error instanceof ApiError ? error.message : "Les délais des tickets n’ont pas pu être vérifiés. Réessayez." },
    { status, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : {}) } },
  );
}
function isSnapshot(value: unknown): value is SiteOperationsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return !!v.site && typeof v.site === "object" && !!v.limits && typeof v.limits === "object" && ["equipment", "sla_calendars", "sla_policies", "sla_cases"].every((k) => Array.isArray(v[k]));
}

export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some((k) => !["site_id", "intervention_id"].includes(k) || params.getAll(k).length !== 1))
      throw new ApiError(422, "Indiquez le site à consulter.");
    const site = uuid.safeParse(params.get("site_id"));
    const only = params.has("intervention_id") ? uuid.safeParse(params.get("intervention_id")) : null;
    if (!site.success || (only && !only.success)) throw new ApiError(422, "Indiquez le site à consulter.");
    const siteId = site.data;
    const onlyId = only?.success ? only.data : null;

    // Access decision + equipment, rules, calendars and delay cases of the site (one snapshot).
    const snapshotResult = await db.rpc("site_operations_snapshot", { p_site_id: siteId });
    dbError(snapshotResult.error);
    if (!isSnapshot(snapshotResult.data)) throw new ApiError(503, "Les données du site sont momentanément indisponibles. Réessayez.");
    const snapshot = snapshotResult.data;
    const partial: string[] = [];
    if (snapshot.limits.equipment_limited) partial.push("equipment_limited");
    if (snapshot.limits.sla_policies_limited) partial.push("rules_limited");
    if (snapshot.limits.sla_cases_limited) partial.push("cases_limited");

    // Tickets of the site, as the caller may read them.
    let query = db.from("interventions").select("id,status,urgency,category,description,created_at,completed_at").eq("site_id", siteId);
    if (onlyId) query = query.eq("id", onlyId);
    const ticketsResult = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(TICKET_LIMIT + 1);
    dbError(ticketsResult.error);
    const parsedTickets = z.array(ticketSchema).safeParse(ticketsResult.data);
    if (!parsedTickets.success) throw new ApiError(503, "Les tickets du site n’ont pas pu être vérifiés. Réessayez.");
    if (onlyId && !parsedTickets.data.length) throw new ApiError(404, "Ce dossier est introuvable sur ce site.");
    if (parsedTickets.data.length > TICKET_LIMIT) partial.push("tickets_limited");
    const tickets: TicketRow[] = parsedTickets.data.slice(0, TICKET_LIMIT);
    const ticketIds = new Set(tickets.map((t) => t.id));

    // First taking in charge recorded in the dossier journal (observed fact, never assumed).
    const responded = new Map<string, string>();
    const ids = [...ticketIds];
    for (let i = 0; i < ids.length; i += 50) {
      const journal = await db.from("audit_log").select("intervention_id,action,created_at").in("intervention_id", ids.slice(i, i + 50)).in("action", RESPONSE_ACTIONS).order("created_at", { ascending: true }).limit(1000);
      dbError(journal.error);
      for (const row of (journal.data ?? []) as { intervention_id: string | null; created_at: string }[])
        if (row.intervention_id && !responded.has(row.intervention_id.toLowerCase())) responded.set(row.intervention_id.toLowerCase(), row.created_at);
    }

    // Active equipment links: by ticket (single dossier) or by critical / high equipment (dashboard).
    const links = new Map<string, string[]>();
    const add = (interventionId: string, equipmentId: string) => {
      if (!ticketIds.has(interventionId)) return;
      const list = links.get(interventionId) ?? [];
      if (!list.includes(equipmentId)) list.push(equipmentId);
      links.set(interventionId, list);
    };
    const readLinks = async (args: { p_kind: string | null; p_asset_id: string | null; p_intervention_id: string | null }) => {
      let after: string | null = null;
      for (let page = 0; page < LINK_PAGES; page++) {
        const result = await db.rpc("site_asset_link_page", { p_site_id: siteId, ...args, p_after_id: after });
        dbError(result.error);
        const data = linkPage.safeParse(result.data);
        if (!data.success) throw new ApiError(503, "Les liens entre tickets et équipements n’ont pas pu être vérifiés. Réessayez.");
        for (const r of data.data.records.slice(0, 50)) if (r.active && r.kind === "equipment" && r.site_id === siteId) add(r.intervention_id, r.asset_id);
        if (data.data.records.length <= 50) return;
        after = data.data.records[49].id;
      }
      partial.push("links_limited");
    };
    if (onlyId) await readLinks({ p_kind: null, p_asset_id: null, p_intervention_id: onlyId });
    else {
      const watched = snapshot.equipment.filter((e) => (e.criticality === "critical" || e.criticality === "high") && e.status !== "retired");
      if (watched.length > EQUIPMENT_LINK_LIMIT) partial.push("equipment_links_limited");
      for (const e of watched.slice(0, EQUIPMENT_LINK_LIMIT)) await readLinks({ p_kind: "equipment", p_asset_id: e.id.toLowerCase(), p_intervention_id: null });
    }

    const report = buildTicketDeadlines({
      site: { id: siteId, name: String(snapshot.site.name ?? ""), type: String(snapshot.site.type ?? ""), organization_id: String(snapshot.site.organization_id ?? "") },
      tickets,
      equipment: snapshot.equipment.map((e) => ({ ...e, id: e.id.toLowerCase() })),
      policies: snapshot.sla_policies,
      calendars: snapshot.sla_calendars,
      cases: snapshot.sla_cases.map((c) => ({ ...c, intervention_id: c.intervention_id?.toLowerCase() ?? null })),
      links,
      responded,
      partial: [...new Set(partial)],
      now: new Date().toISOString(),
    });
    return Response.json(report, { headers: HEADERS });
  } catch (error) {
    return failed(error);
  }
}
