import { csvCell } from "@/lib/domain";
import {
  authenticatedClient,
  ApiError,
  apiError,
  dbError,
} from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
interface ReportRow {
  site_id: string;
  name: string;
  type: string;
  budget_cents: number;
  paid_cents: number;
  committed_cents: number;
  interventions: number;
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const query = new URL(request.url).searchParams;
    const siteId = query.get("site_id");
    if (siteId && !uuid.safeParse(siteId).success)
      throw new ApiError(422, "Site invalide.");
    const profile = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    dbError(profile.error);
    if (!["manager", "admin"].includes(profile.data?.role))
      throw new ApiError(403, "Rapport réservé à l’espace professionnel.");
    // The invoker RPC aggregates inside one SQL snapshot under RLS. Exact count detects
    // provider max_rows caps; never return a silently partial consolidated report.
    const result = await db
      .rpc(
        "professional_report",
        { p_site_id: siteId || null },
        { count: "exact" },
      )
      .limit(1001);
    dbError(result.error);
    const rows: ReportRow[] = (result.data ?? []).map((row: ReportRow) => ({
      ...row,
      budget_cents: Number(row.budget_cents),
      paid_cents: Number(row.paid_cents),
      committed_cents: Number(row.committed_cents),
      interventions: Number(row.interventions),
    }));
    if (
      result.count === null ||
      result.count > rows.length ||
      rows.length > 1000
    )
      throw new ApiError(
        422,
        "Le volume du rapport nécessite un export par site. Sélectionnez un site pour obtenir un rapport complet.",
      );
    if (siteId && !rows.length)
      throw new ApiError(403, "Vous n’avez pas accès à ce site.");
    const totals = rows.reduce(
      (total, row) => ({
        budget_cents: total.budget_cents + row.budget_cents,
        paid_cents: total.paid_cents + row.paid_cents,
        committed_cents: total.committed_cents + row.committed_cents,
      }),
      { budget_cents: 0, paid_cents: 0, committed_cents: 0 },
    );
    if (
      [
        ...rows.flatMap((row) => [
          row.budget_cents,
          row.paid_cents,
          row.committed_cents,
          row.interventions,
        ]),
        ...Object.values(totals),
      ].some((value) => !Number.isSafeInteger(value))
    )
      throw new ApiError(
        422,
        "Ce rapport dépasse les limites de précision. Réduisez son périmètre.",
      );
    if (query.get("format") === "csv") {
      const body =
        "\uFEFF" +
        [
          [
            "Site",
            "Activité",
            "Budget EUR",
            "Payé EUR",
            "Engagé non payé EUR",
            "Interventions",
          ],
          ...rows.map((row) => [
            row.name,
            row.type,
            (row.budget_cents / 100).toFixed(2),
            (row.paid_cents / 100).toFixed(2),
            (row.committed_cents / 100).toFixed(2),
            row.interventions,
          ]),
        ]
          .map((row) => row.map(csvCell).join(";"))
          .join("\r\n");
      return new Response(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="rapport-interventions.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    return Response.json(
      { sites: rows, totals, currency: "eur" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
