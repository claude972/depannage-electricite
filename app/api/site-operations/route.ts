// ADV-B2B-OPERATIONS-001 — site operations (equipment, maintenance, budgets, grids, SLA, ERP).
// GET: one RLS-scoped snapshot plus server-computed SLA evaluation and completeness flags.
// POST: strictly validated commands mapped to versioned SQL entry points. Rights are decided by
// the database on every call (membership role, site grant can_write, organisation-wide write).
import { authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { commandSchema, toRpc, uuid } from "@/lib/features/site-operations/schemas";
import { buildReport } from "@/lib/features/site-operations/report";
import type { SiteOperationsSnapshot } from "@/lib/features/site-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
function failed(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
function isSnapshot(value: unknown): value is SiteOperationsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    !!v.site && typeof v.site === "object" && !!v.limits && typeof v.limits === "object" &&
    ["equipment", "maintenance_plans", "fiscal_years", "budget_lines", "budget_consumption", "sla_calendars", "sla_policies", "sla_cases", "erp_checklists", "events"].every((k) => Array.isArray(v[k])) &&
    (v.contract_grids === null || Array.isArray(v.contract_grids))
  );
}
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some((k) => k !== "site_id") || params.getAll("site_id").length !== 1)
      throw new ApiError(422, "Indiquez le site à consulter.");
    const siteId = uuid.safeParse(params.get("site_id"));
    if (!siteId.success) throw new ApiError(422, "Indiquez le site à consulter.");
    const result = await db.rpc("site_operations_snapshot", { p_site_id: siteId.data });
    dbError(result.error);
    if (!isSnapshot(result.data)) throw new ApiError(503, "Les données du site sont momentanément indisponibles. Réessayez.");
    return Response.json(buildReport(siteId.data, result.data), { headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Vérifiez les informations saisies.");
    const command = await validated(request, commandSchema);
    const { fn, args } = toRpc(command);
    const result = await db.rpc(fn, args);
    dbError(result.error);
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data))
      throw new ApiError(503, "L’enregistrement n’a pas été confirmé. Rechargez les données avant de réessayer.");
    return Response.json({ action: command.action, result: result.data }, { headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
