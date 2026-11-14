import { z } from "zod";
import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { csvCell } from "@/lib/domain";
import { comparePostgresTime } from "@/lib/shared/postgres-time-order";
import { ENTERPRISE_EXPORT_LIMIT, ENTERPRISE_PAGE_SIZE, enterpriseInterventionInput, enterpriseInterventionRow,
  enterpriseInterventionSnapshot } from "@/lib/features/enterprise-interventions/contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const categoryLabels = {
  outage: "Coupure de courant", panel: "Tableau électrique", socket: "Prise ou interrupteur",
  lighting: "Éclairage", diagnostic: "Recherche de panne",
};
const statusLabels = {
  requested: "Demandée", assigned: "Artisan attribué", quoted: "Devis proposé", accepted: "Devis accepté",
  in_progress: "En cours", completed: "Terminée", paid: "Réglée", cancelled: "Annulée",
};
type Row = z.infer<typeof enterpriseInterventionRow>;

function csv(items: Row[]) {
  const rows = [["Référence", "Site", "Type", "Statut", "Adresse", "Estimation min (EUR)", "Estimation max (EUR)", "Date"]];
  for (const row of items) {
    rows.push([`INT-${row.id.slice(0, 6).toUpperCase()}`, row.site_name, categoryLabels[row.category],
      statusLabels[row.status], `${row.address}, ${row.postal_code} ${row.city}`,
      (row.estimate_min_cents / 100).toFixed(2), (row.estimate_max_cents / 100).toFixed(2), row.created_at]);
  }
  return new Response("\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n"), { headers: {
    ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="interventions.csv"',
  } });
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.search || Number(request.headers.get("content-length") ?? 0) > 4096) throw new ApiError(422, "Requête de recherche invalide.");
    if (request.headers.get("origin") !== url.origin && (request.headers.has("origin") || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(request.headers.get("authorization") ?? ""))) throw new ApiError(403, "Origine de la requête non autorisée.");
    const { db } = await authenticatedClient(request);
    const parsed = enterpriseInterventionInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(422, "Vérifiez le périmètre et les filtres.");
    const input = parsed.data, exporting = input.action === "export", page = exporting ? 1 : input.page;
    const result = await db.rpc("enterprise_intervention_search", {
      p_organization: input.organization_id, p_site: input.site_id, p_category: input.category, p_status: input.status,
      p_search: input.search.toLowerCase(), p_sort: input.sort, p_page: page, p_export: exporting,
    });
    dbError(result.error);
    const { items, total } = enterpriseInterventionSnapshot.parse(result.data);
    if (exporting && total > ENTERPRISE_EXPORT_LIMIT) throw new ApiError(409, "Affinez vos filtres pour exporter au maximum 5 000 interventions.");
    const expected = exporting ? total : Math.min(ENTERPRISE_PAGE_SIZE, Math.max(0, total - (page - 1) * ENTERPRISE_PAGE_SIZE));
    if (items.length !== expected || new Set(items.map(row => row.id)).size !== items.length) throw Error("Invalid enterprise page");
    let previous: Row | null = null;
    for (const row of items) {
      if ((input.site_id && row.site_id !== input.site_id.toLowerCase()) || (input.category && row.category !== input.category)
        || (input.status && row.status !== input.status)) throw Error("Inconsistent enterprise scope");
      if (previous) {
        const order = comparePostgresTime(previous.created_at, row.created_at) || (previous.id < row.id ? -1 : 1);
        if ((input.sort === "recent" ? order < 0 : order > 0)) throw Error("Unordered enterprise page");
      }
      previous = row;
    }
    if (exporting) return csv(items);
    return Response.json({ items, total, page: { number: page, limit: ENTERPRISE_PAGE_SIZE,
      pages: Math.max(1, Math.ceil(total / ENTERPRISE_PAGE_SIZE)) } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Les interventions n’ont pas pu être chargées. Réessayez." },
      { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
