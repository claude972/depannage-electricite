// ART-10 — performance of the connected artisan over a chosen period (month, quarter, year or
// custom bounds), recomputed on every call from payments, interventions and the action journal.
// GET /api/artisan/performance/period?start=<ISO>&end=<ISO>   (start included, end excluded)
// The artisan is ALWAYS the session user: no parameter selects another account (a third party gets
// 403, an extra parameter 422). Rows are read with the service role AFTER the role check and are
// filtered on the session user id in every query; nothing but aggregates leaves the server.
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, authenticatedClient, apiError, ApiError } from "@/lib/supabase/server";
import { buildPeriodReport, parsePeriod, type ArrivalEvent, type PaidRow, type SlotEvent } from "@/lib/features/artisan-performance/period-report";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = 1000;
const MAX_ROWS = 20000;
const unavailable = () => new ApiError(503, "Les indicateurs de la période sont momentanément indisponibles.");

type Page<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;
/** Reads every row of a filtered query, page by page (never a silently truncated total). */
async function all<T>(query: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(from, from + PAGE - 1);
    if (page.error || !page.data) throw unavailable();
    rows.push(...page.data);
    if (page.data.length < PAGE) return rows;
    if (rows.length >= MAX_ROWS) throw unavailable();
  }
}
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function read(admin: SupabaseClient, artisanId: string, start: string, end: string) {
  const paid = await all<PaidRow>((from, to) =>
    admin
      .from("payments")
      .select("id,total_cents,method,quotes!inner(artisan_id,interventions!inner(artisan_id))")
      .eq("status", "paid")
      .gte("paid_at", start)
      .lt("paid_at", end)
      .eq("quotes.artisan_id", artisanId)
      .eq("quotes.interventions.artisan_id", artisanId)
      .order("id")
      .range(from, to) as unknown as Page<PaidRow>,
  );
  const completed = await admin.from("interventions").select("id", { count: "exact", head: true }).eq("artisan_id", artisanId).in("status", ["completed", "paid"]).gte("completed_at", start).lt("completed_at", end);
  if (completed.error || completed.count === null) throw unavailable();
  // Presence events written by THIS artisan on dossiers still attributed to them, in the period…
  const presence = (from: number, to: number, inPeriod: boolean, ids?: string[]) => {
    let q = admin.from("audit_log").select("id,intervention_id,action,created_at,interventions!inner(artisan_id)").eq("actor_id", artisanId).eq("interventions.artisan_id", artisanId).in("action", ["travel_on_site", "start"]);
    if (inPeriod) q = q.gte("created_at", start).lt("created_at", end);
    if (ids) q = q.in("intervention_id", ids);
    return q.order("id").range(from, to) as unknown as Page<ArrivalEvent>;
  };
  const inPeriod = await all<ArrivalEvent>((from, to) => presence(from, to, true));
  const ids = [...new Set(inPeriod.map((e) => e.intervention_id))];
  const arrivals: ArrivalEvent[] = [];
  const slots: SlotEvent[] = [];
  // …then, for those dossiers only, every presence event (the FIRST one may predate the period)
  // and every appointment save (the slot in force at the arrival).
  for (const part of chunks(ids, 100)) {
    arrivals.push(...(await all<ArrivalEvent>((from, to) => presence(from, to, false, part))));
    const saved = await all<{ intervention_id: string; created_at: string; payload: { starts_at?: unknown; ends_at?: unknown } | null }>((from, to) =>
      admin.from("intervention_operation_events").select("id,intervention_id,created_at,payload").eq("kind", "appointment").in("intervention_id", part).order("id").range(from, to) as unknown as Page<{ intervention_id: string; created_at: string; payload: { starts_at?: unknown; ends_at?: unknown } | null }>,
    );
    for (const s of saved) if (typeof s.payload?.starts_at === "string" && typeof s.payload?.ends_at === "string") slots.push({ intervention_id: s.intervention_id, created_at: s.created_at, starts_at: s.payload.starts_at, ends_at: s.payload.ends_at });
  }
  return { paid, completed: completed.count, arrivals, slots };
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== "start" && key !== "end") || query.getAll("start").length !== 1 || query.getAll("end").length !== 1)
      throw new ApiError(422, "Indiquez le début et la fin de la période, sans autre paramètre.");
    const period = parsePeriod(query.get("start"), query.get("end"));
    if (!period.ok) throw new ApiError(422, period.message);
    const { user } = await authenticatedClient(request);
    if (!user) throw new ApiError(401, "Connectez-vous pour accéder à cet espace.");
    const admin = adminClient();
    const profile = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile.error) throw unavailable();
    if ((profile.data as { role?: string } | null)?.role !== "artisan") throw new ApiError(403, "Ces indicateurs sont réservés au compte artisan concerné.");
    let report;
    try {
      report = buildPeriodReport({ start: period.start, end: period.end, ...(await read(admin, user.id, period.start, period.end)) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
    return Response.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
