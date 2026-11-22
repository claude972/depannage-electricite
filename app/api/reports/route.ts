import { z } from "zod";
import { csvCell } from "@/lib/domain";
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { reportRow, reportTotals, REPORT_BASIS, SITE_TYPE_LABELS, type FinancialSiteReport } from "@/lib/features/professional-report/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const LIMIT = 1000;
const csvHeader = [
  "Site", "Activité", "Budget déclaré EUR", "Devis acceptés avec avenants EUR", "Devis acceptés actifs EUR",
  "Paiements Stripe enregistrés EUR (pas contrôle banque direct)", "Reçus sur place historiques déclarés EUR (pas banque)",
  "Paiements non vérifiés EUR", "Remboursements confirmés enregistrés EUR", "Dépense client nette EUR (pas revenu artisan)",
  "Engagement actif restant EUR (pas dette recalculée)", "Interventions", "Données financières complètes",
].map(csvCell).join(";");
const pageSchema = z.array(reportRow).max(LIMIT);

type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];
type Scope = { site: string | null; organization: string | null };
type Page = { rows: FinancialSiteReport[]; remaining: number; next: string | null };

async function readPage(db: Database, { site, organization }: Scope, after: string | null): Promise<Page> {
  const query = db.rpc("professional_report", { p_site_id: site, p_organization_id: organization }, { count: "exact" });
  if (after) query.gt("site_id", after);
  const result = await query.order("site_id", { ascending: true }).limit(LIMIT);
  dbError(result.error);
  const rows = pageSchema.parse(result.data);
  const count = result.count;
  if (count === null || !Number.isSafeInteger(count) || count < 0 || rows.length !== Math.min(count, LIMIT)
    || (site !== null && count > 1) || rows.some((row, index) => {
      const previous = index === 0 ? after : rows[index - 1].site_id;
      return (site !== null && row.site_id !== site) || (previous !== null && row.site_id <= previous);
    })) throw new ApiError(503, "Le rapport est incomplet. Réessayez.");
  if (site && !rows.length) throw new ApiError(404, "Ce site est introuvable.");
  const remaining = count - rows.length;
  return { rows, remaining, next: remaining ? rows[rows.length - 1].site_id : null };
}

function csvRow(row: FinancialSiteReport) {
  const cents = [row.budget_cents, row.accepted_cents, row.active_accepted_cents, row.paid_cents,
    row.declared_paid_cents, row.unverified_paid_cents, row.refunded_cents, row.net_paid_cents, row.committed_cents];
  return [row.name, SITE_TYPE_LABELS[row.type], ...cents.map(value => (value / 100).toFixed(2)), row.interventions,
    row.financial_complete ? "oui" : "non"].map(csvCell).join(";");
}

function streamCsv(db: Database, scope: Scope, initial: Page) {
  const encoder = new TextEncoder();
  let current = initial;
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!first && current.next) {
          const next = await readPage(db, scope, current.next);
          if (next.rows.length + next.remaining !== current.remaining) throw Error("Report scope changed during export");
          current = next;
        }
        const header = first ? `\uFEFF${csvHeader}` : "";
        controller.enqueue(encoder.encode(header + current.rows.map(row => `\r\n${csvRow(row)}`).join("")));
        first = false;
        if (!current.next) controller.close();
      } catch (error) {
        // A changed or unavailable subsequent page breaks the download instead of completing a partial CSV.
        controller.error(error);
      }
    },
  });
}

export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient(request);
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some(key =>
      !["site_id", "organization_id", "format", "after"].includes(key) || params.getAll(key).length !== 1)) {
      throw new ApiError(422, "Filtres de rapport invalides.");
    }
    const parseId = (key: string) => {
      const raw = params.get(key);
      if (raw === null) return null;
      const result = z.uuid().safeParse(raw);
      if (!result.success) throw new ApiError(422, "Périmètre de rapport invalide.");
      return result.data.toLowerCase();
    };
    const site = parseId("site_id"), organization = parseId("organization_id"), after = parseId("after");
    const format = params.get("format") ?? "json";
    if (format !== "json" && format !== "csv") throw new ApiError(422, "Format de rapport invalide.");
    if (after !== null && (site !== null || format === "csv")) throw new ApiError(422, "Ce filtre de pagination ne s’applique pas au rapport demandé.");
    const scope = { site, organization };
    const first = await readPage(db, scope, after);
    const totals = reportTotals(first.rows);
    if (format === "csv") {
      return new Response(streamCsv(db, scope, first), { headers: {
        ...HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rapport-interventions.csv"',
      } });
    }
    const complete = after === null && first.next === null;
    return Response.json({
      sites: first.rows, totals, currency: "eur",
      scope: { kind: "visible_sites", site_id: site, organization_id: organization, complete }, basis: REPORT_BASIS,
      ...(complete ? {} : { page: { limit: LIMIT, has_more: first.next !== null, next_after: first.next } }),
    }, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Les faits financiers du rapport n’ont pas pu être vérifiés. Réessayez." }, {
      status, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : {}) },
    });
  }
}
