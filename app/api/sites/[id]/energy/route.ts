import { z } from "zod";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { energyCommand, energyDate, energyPage, energyRecord } from "@/lib/features/energy/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const COLUMNS = "id,site_id,meter_label,period_start,period_end,consumption_wh,cost_cents,source_kind,source_reference,note,version,created_by,created_at,updated_by,updated_at,archived_at";
type Context = { params: Promise<{ id: string }> };
const cursorSchema = z.object({ day: energyDate, id: z.uuid(), site_id: z.uuid(), from: energyDate.nullable(), to: energyDate.nullable() }).strict();
function failed(error: unknown) {
  const status = error instanceof ApiError ? error.status : 503;
  return Response.json({ error: error instanceof ApiError ? error.message : "Les consommations n’ont pas pu être vérifiées. Réessayez." },
    { status, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
}
async function siteId(context: Context) {
  const parsed = z.uuid().safeParse((await context.params).id);
  if (!parsed.success) throw new ApiError(422, "Référence de site invalide.");
  return parsed.data;
}
function query(request: Request, site: string) {
  const params = new URL(request.url).searchParams;
  if (request.url.length > 2048 || [...params.keys()].some(k => !["from", "to", "cursor"].includes(k)) ||
    ["from", "to", "cursor"].some(k => params.getAll(k).length > 1)) throw new ApiError(422, "Vérifiez les filtres de consommation.");
  const from = params.get("from"), to = params.get("to");
  if ((from !== null && !energyDate.safeParse(from).success) || (to !== null && !energyDate.safeParse(to).success) || (from && to && from > to))
    throw new ApiError(422, "La période demandée est invalide.");
  let cursor: z.infer<typeof cursorSchema> | null = null;
  const raw = params.get("cursor");
  if (raw !== null) {
    try {
      if (raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
      const decoded = Buffer.from(raw, "base64url");
      if (decoded.toString("base64url") !== raw) throw Error();
      cursor = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
      if (cursor.site_id !== site || cursor.from !== from || cursor.to !== to) throw Error();
    } catch { throw new ApiError(422, "Le curseur est invalide. Rechargez la liste."); }
  }
  return { from, to, cursor };
}
export async function GET(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    const id = await siteId(context), filters = query(request, id);
    const site = await db.from("sites").select("id").eq("id", id).maybeSingle();
    dbError(site.error);
    if (!site.data) throw new ApiError(404, "Ce site est introuvable.");
    const rights = await db.rpc("can_manage_site", { p_site_id: id });
    dbError(rights.error);
    if (typeof rights.data !== "boolean") throw new ApiError(503, "Les droits du site n’ont pas pu être vérifiés.");
    let selection = db.from("site_energy_periods").select(COLUMNS, { count: "exact" }).eq("site_id", id).is("archived_at", null)
      .order("period_start", { ascending: false }).order("id", { ascending: false }).limit(100);
    if (filters.from) selection = selection.gte("period_start", filters.from);
    if (filters.to) selection = selection.lte("period_end", filters.to);
    if (filters.cursor) selection = selection.or(`period_start.lt.${filters.cursor.day},and(period_start.eq.${filters.cursor.day},id.lt.${filters.cursor.id})`);
    const result = await selection;
    dbError(result.error);
    const records = z.array(energyRecord).max(100).parse(result.data);
    if (records.some(r => r.site_id !== id || r.archived_at !== null || (filters.from && r.period_start < filters.from) || (filters.to && r.period_end > filters.to)))
      throw new ApiError(503, "Les consommations reçues ne correspondent pas au site demandé.");
    if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0 || records.length !== Math.min(result.count, 100) || new Set(records.map(r => r.id)).size !== records.length)
      throw new ApiError(503, "La liste des consommations est incomplète. Réessayez.");
    const hasMore = result.count > 100, visible = records, last = visible.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({ day: last.period_start, id: last.id, site_id: id, from: filters.from, to: filters.to })).toString("base64url") : null;
    // A later page never becomes a total for the full selected period.
    const page = energyPage(visible, hasMore || filters.cursor !== null, next, rights.data);
    page.page.has_more = hasMore;
    return Response.json(page, { headers: HEADERS });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "La commande contient des paramètres inattendus.");
    const id = await siteId(context);
    const site = await db.from("sites").select("id").eq("id", id).maybeSingle();
    dbError(site.error);
    if (!site.data) throw new ApiError(404, "Ce site est introuvable.");
    const command = await validated(request, energyCommand);
    const result = command.action === "save"
      ? await db.rpc("save_site_energy_period", { p_site_id: id, p_id: command.id, p_expected_version: command.expected_version, p_values: command.values })
      : await db.rpc("archive_site_energy_period", { p_site_id: id, p_id: command.id, p_expected_version: command.expected_version });
    dbError(result.error);
    const record = energyRecord.parse(result.data);
    if (record.id !== command.id || record.site_id !== id || (command.action === "save" && record.archived_at !== null) || (command.action === "archive" && record.archived_at === null))
      throw new ApiError(503, "L’enregistrement doit être vérifié. Rechargez les consommations avant de réessayer.");
    if (command.action === "save" && (Object.entries(command.values).some(([key, value]) => record[key as keyof typeof record] !== value) ||
      (command.expected_version === null ? record.version !== 1 : ![command.expected_version, command.expected_version + 1].includes(record.version))))
      throw new ApiError(503, "Le résultat ne correspond pas à votre saisie. Rechargez les consommations avant de réessayer.");
    if (command.action === "archive" && record.version !== command.expected_version + 1)
      throw new ApiError(503, "L’archivage doit être vérifié. Rechargez les consommations.");
    return Response.json({ record }, { headers: HEADERS });
  } catch (error) { return failed(error); }
}
