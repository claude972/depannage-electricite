// CODEX-INVOICE-PDF-001: private rendering from the immutable invoice register only.
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { failed, requireScope } from "@/lib/features/platform-operations/http";
import { invoiceDocumentInput } from "@/lib/features/platform-operations/invoice-document";
import { InvoicePdfError, renderInvoicePdf, invoicePdfFileName } from "@/lib/features/platform-operations/invoice-pdf";
import type { Invoice } from "@/lib/features/platform-operations/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const fields = "id,request_id,kind,basis,number,issuer_key,issuer,recipient,payment_id,quote_id,intervention_id,related_invoice_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,currency,reason,issued_by,issued_at";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Ce document est introuvable.");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (key !== "inline" || params.getAll(key).length !== 1 || params.get(key) !== "1") throw new ApiError(422, "Vérifiez les paramètres du téléchargement.");
    const result = await db.from("platform_invoices").select(fields).eq("id", id).maybeSingle();
    dbError(result.error);
    if (!result.data) throw new ApiError(404, "Ce document est introuvable.");
    const invoice = result.data as unknown as Invoice;
    let related: { number: string } | null = null;
    if (invoice.kind === "credit_note") {
      if (!uuid.safeParse(invoice.related_invoice_id).success) throw new InvoicePdfError("La facture liée à l’avoir est invalide.");
      const parent = await db.from("platform_invoices").select("id,kind,number,basis,payment_id,quote_id,intervention_id,issuer_key,total_cents,tax_cents").eq("id", invoice.related_invoice_id!).maybeSingle();
      dbError(parent.error);
      if (!parent.data || parent.data.kind !== "invoice" || parent.data.basis !== invoice.basis || parent.data.payment_id !== invoice.payment_id || parent.data.quote_id !== invoice.quote_id || parent.data.intervention_id !== invoice.intervention_id || parent.data.issuer_key !== invoice.issuer_key || invoice.total_cents > parent.data.total_cents || invoice.tax_cents > parent.data.tax_cents)
        throw new InvoicePdfError("La facture liée à l’avoir est incohérente ou indisponible.");
      related = { number: parent.data.number };
    } else if (invoice.related_invoice_id !== null) throw new InvoicePdfError("Le lien de cette facture est incohérent.");
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = renderInvoicePdf({ ...invoiceDocumentInput(invoice, related), basis: invoice.basis });
    } catch {
      throw new InvoicePdfError("L’instantané de ce document est incomplet ou incohérent.");
    }
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${params.get("inline") === "1" ? "inline" : "attachment"}; filename="${invoicePdfFileName(invoice)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return failed(error instanceof InvoicePdfError ? new ApiError(503, "Le document enregistré ne peut pas être rendu. Contactez l’assistance.") : error);
  }
}
