import { energyCsv } from "@/lib/features/energy-consolidation/csv";
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import {
  selection,
  energyReport,
} from "@/lib/features/energy-consolidation/report";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await authenticatedClient();
    const q = new URL(request.url).searchParams;
    if (
      request.url.length > 4096 ||
      [...q.keys()].some(
        (k) =>
          ![
            "site_ids",
            "from",
            "to",
            "previous_from",
            "previous_to",
            "format",
          ].includes(k) || q.getAll(k).length !== 1,
      )
    )
      throw new ApiError(422, "Filtres énergie invalides.");
    const format = q.get("format") ?? "json";
    if (format !== "json" && format !== "csv")
      throw new ApiError(422, "Format de rapport invalide.");
    const parsed = selection.safeParse({
      organization_id: (await context.params).id,
      site_ids: q.get("site_ids")?.split(","),
      from: q.get("from"),
      to: q.get("to"),
      previous_from: q.get("previous_from"),
      previous_to: q.get("previous_to"),
    });
    if (!parsed.success)
      throw new ApiError(
        422,
        "Choisissez 1 à 50 sites et des périodes de 366 jours au plus.",
      );
    const s = parsed.data;
    const result = await db.rpc("organization_energy_consolidation", {
      p_organization_id: s.organization_id,
      p_site_ids: s.site_ids,
      p_from: s.from,
      p_to: s.to,
      p_previous_from: s.previous_from,
      p_previous_to: s.previous_to,
    });
    dbError(result.error);
    const report = energyReport(result.data, s);
    if (format === "csv")
      return new Response(energyCsv(report), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="rapport-energie.csv"',
          "X-Content-Type-Options": "nosniff",
        },
      });
    return Response.json(report, { headers });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 503;
    return Response.json(
      {
        error:
          e instanceof ApiError
            ? e.message
            : "La consolidation énergétique n’a pas pu être vérifiée. Réessayez.",
      },
      {
        status,
        headers: {
          ...headers,
          ...(status === 503 ? { "Retry-After": "2" } : {}),
        },
      },
    );
  }
}
