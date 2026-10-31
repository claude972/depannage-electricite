import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { failed, ok, requireScope } from "@/lib/features/platform-operations/http";
import { invoiceDocumentInput } from "@/lib/features/platform-operations/invoice-document";
import type { Invoice } from "@/lib/features/platform-operations/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const fields = "id,request_id,kind,basis,number,issuer_key,issuer,recipient,payment_id,quote_id,intervention_id,related_invoice_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,currency,reason,issued_by,issued_at";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!uuid.safeParse(id).success) throw new ApiError(404, "Ce document est introuvable.");
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Vérifiez les paramètres.");
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const row = await db.from("platform_invoices").select(fields).eq("id", id).maybeSingle();
    dbError(row.error);
    if (!row.data) throw new ApiError(404, "Ce document est introuvable.");
    const invoice = row.data as unknown as Invoice;
    const [notes, related] = await Promise.all([
      db.from("platform_invoices").select(fields).eq("related_invoice_id", id).order("issued_at", { ascending: true }).order("id").limit(100),
      invoice.related_invoice_id ? db.from("platform_invoices").select("number").eq("id", invoice.related_invoice_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    dbError(notes.error); dbError(related.error);
    return ok({ invoice, credit_notes: notes.data ?? [], document: invoiceDocumentInput(invoice, related.data as { number: string } | null) });
  } catch (error) { return failed(error); }
}
