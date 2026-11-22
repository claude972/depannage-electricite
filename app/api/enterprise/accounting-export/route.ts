// ENT-16 — GET /api/enterprise/accounting-export?organization_id=<uuid>[&format=csv]
// Read-only accounting export of an organisation: service invoices and credit notes issued to it
// and the settlements of its dossiers. Every read runs under the caller's own session: the invoice
// reader (customer_invoice_page) and the RLS of sites / interventions / payments decide what a member
// may see; someone who is not a member of the organisation gets 404 before anything is read.
// Default answer = JSON summary (counts); format=csv = the file. A partial file is never produced.
import { z } from "zod";
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { buildAccountingCsv, exportInvoice, exportSettlement, exportSummary, type ExportInvoice, type ExportSettlement } from "@/lib/features/enterprise-accounting-export/model";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const uuid = z.uuid().transform((v) => v.toLowerCase());
const INVOICE_PAGES = 40; // 2 000 documents
const ROW_LIMIT = 2000;
const TOO_LARGE = "Cet export dépasse 2 000 lignes par catégorie : il n’est pas produit partiellement. Contactez l’assistance pour un export complet.";

function failed(error: unknown) {
  const status = error instanceof ApiError ? error.status : 503;
  return Response.json(
    { error: error instanceof ApiError ? error.message : "L’export comptable n’a pas pu être vérifié. Réessayez." },
    { status, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : {}) } },
  );
}
type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];

async function readInvoices(db: Database, organizationId: string): Promise<ExportInvoice[]> {
  const out: ExportInvoice[] = [];
  let after: { at: string; id: string } | null = null;
  for (let page = 0; page < INVOICE_PAGES; page++) {
    const result = await db.rpc("customer_invoice_page", { p_organization_id: organizationId, p_site_id: null, p_intervention_id: null, p_kind: null, p_basis: "service", p_limit: 50, p_after_at: after?.at ?? null, p_after_id: after?.id ?? null });
    dbError(result.error);
    const data = z.object({ total: z.number().int().min(0), remaining: z.number().int().min(0), invoices: z.array(exportInvoice).max(50) }).loose().safeParse(result.data);
    if (!data.success) throw new ApiError(503, "Les factures n’ont pas pu être vérifiées. Réessayez.");
    out.push(...data.data.invoices);
    if (data.data.remaining <= data.data.invoices.length) {
      if (new Set(out.map((i) => i.id)).size !== out.length) throw new ApiError(503, "Les factures ont changé pendant l’export. Réessayez.");
      return out;
    }
    const last = data.data.invoices.at(-1);
    if (!last) break;
    after = { at: last.issued_at, id: last.id };
  }
  throw new ApiError(422, TOO_LARGE);
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    if (request.url.length > 2048 || [...params.keys()].some((k) => !["organization_id", "format"].includes(k) || params.getAll(k).length !== 1))
      throw new ApiError(422, "Paramètres d’export invalides.");
    const org = uuid.safeParse(params.get("organization_id"));
    const format = params.get("format") ?? "json";
    if (!org.success || !["json", "csv"].includes(format)) throw new ApiError(422, "Paramètres d’export invalides.");
    const organizationId = org.data;

    // Membership of THIS organisation (any role: the documents are readable by its members).
    const member = await db.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", user.id).limit(1);
    dbError(member.error);
    if (!member.data?.length) throw new ApiError(404, "Cette organisation est introuvable.");

    const invoices = await readInvoices(db, organizationId);

    // Sites and dossiers of the organisation visible to the caller, then their settlements.
    const sites = await db.from("sites").select("id,name").eq("organization_id", organizationId).limit(ROW_LIMIT + 1);
    dbError(sites.error);
    const siteRows = (sites.data ?? []) as { id: string; name: string }[];
    if (siteRows.length > ROW_LIMIT) throw new ApiError(422, TOO_LARGE);
    const siteName = new Map(siteRows.map((s) => [s.id.toLowerCase(), s.name]));
    const siteOf = new Map<string, string>();
    const settlements: ExportSettlement[] = [];
    const siteIds = [...siteName.keys()];
    for (let i = 0; i < siteIds.length; i += 50) {
      const jobs = await db.from("interventions").select("id,site_id").in("site_id", siteIds.slice(i, i + 50)).limit(ROW_LIMIT + 1);
      dbError(jobs.error);
      const jobRows = (jobs.data ?? []) as { id: string; site_id: string }[];
      if (jobRows.length > ROW_LIMIT) throw new ApiError(422, TOO_LARGE);
      for (const j of jobRows) siteOf.set(j.id.toLowerCase(), siteName.get(j.site_id.toLowerCase()) ?? "");
      const jobIds = jobRows.map((j) => j.id);
      for (let k = 0; k < jobIds.length; k += 50) {
        const quotes = await db.from("quotes").select("id,intervention_id").in("intervention_id", jobIds.slice(k, k + 50)).limit(ROW_LIMIT);
        dbError(quotes.error);
        const quoteRows = (quotes.data ?? []) as { id: string; intervention_id: string }[];
        if (!quoteRows.length) continue;
        const jobOfQuote = new Map(quoteRows.map((q) => [q.id.toLowerCase(), q.intervention_id.toLowerCase()]));
        const payments = await db.from("payments").select("id,quote_id,total_cents,status,method,paid_at,created_at").in("quote_id", quoteRows.map((q) => q.id)).limit(ROW_LIMIT);
        dbError(payments.error);
        for (const p of (payments.data ?? []) as Record<string, unknown>[]) {
          const interventionId = jobOfQuote.get(String(p.quote_id).toLowerCase());
          if (!interventionId) continue;
          const parsed = exportSettlement.safeParse({ ...p, intervention_id: interventionId, site_name: siteOf.get(interventionId) ?? "" });
          if (!parsed.success) throw new ApiError(503, "Les règlements n’ont pas pu être vérifiés. Réessayez.");
          settlements.push(parsed.data);
        }
      }
    }
    if (settlements.length > ROW_LIMIT) throw new ApiError(422, TOO_LARGE);
    settlements.sort((a, b) => (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at) || b.id.localeCompare(a.id));
    // An invoice may concern a dossier outside the caller's site scope: never the case for a document
    // the reader returned for this organisation, but a missing site name stays empty rather than guessed.
    const captured = new Date().toISOString();
    if (format === "json")
      return Response.json({ organization_id: organizationId, captured_at: captured, ...exportSummary(invoices, settlements), visible_sites: siteRows.length }, { headers: HEADERS });
    const body = new TextEncoder().encode(buildAccountingCsv(invoices, settlements, siteOf));
    return new Response(body, {
      headers: { ...HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Length": String(body.byteLength), "Content-Disposition": `attachment; filename="export-comptable-${captured.slice(0, 10)}.csv"` },
    });
  } catch (error) {
    return failed(error);
  }
}
