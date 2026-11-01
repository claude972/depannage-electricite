import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const quoteId = new URL(request.url).searchParams.get("quote_id");
    if (!uuid.safeParse(quoteId).success) throw new ApiError(422, "Référence de devis invalide.");
    const { db } = await authenticatedClient();
    const quote = await db.from("quotes").select("id").eq("id", quoteId).maybeSingle();
    dbError(quote.error);
    if (!quote.data) throw new ApiError(404, "Ce devis est introuvable.");
    const [payment, attempts] = await Promise.all([
      db.from("payments").select("quote_id,status,total_cents,currency,failure_code,created_at,updated_at,paid_at,method").eq("quote_id", quoteId).maybeSingle(),
      db.from("payment_attempts").select("id,status,total_cents,currency,failure_code,created_at,updated_at,paid_at,method", { count: "exact" }).eq("quote_id", quoteId).order("created_at", { ascending: false }).order("id").limit(50),
    ]);
    dbError(payment.error); dbError(attempts.error);
    return Response.json({ payment: payment.data, attempts: attempts.data, attempts_limit: 50, history_limited: (attempts.count ?? 0) > 50 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
