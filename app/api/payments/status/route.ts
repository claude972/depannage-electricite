import { z } from "zod";
import { authenticatedClient, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { PAYMENT_HEADERS } from "@/lib/features/payments/checkout";
export const dynamic = "force-dynamic";
const date=z.string().refine(v=>Number.isFinite(Date.parse(v)));
const fields={status:z.enum(["pending","paid","failed"]),total_cents:z.number().int().positive().max(2147483647),currency:z.literal("eur"),failure_code:z.enum(["expired","async_payment_failed"]).nullable(),created_at:date,updated_at:date,paid_at:date.nullable(),method:z.enum(["stripe","on_site_declared"])};
const paymentSchema=z.object({quote_id:uuid,...fields}).strict();
const attemptSchema=z.object({id:uuid,...fields}).strict();
const disputeState = z.enum(["none", "open", "under_review", "resolved", "closed"]);
export async function GET(request: Request) {
 try {
  const {db,user}=await authenticatedClient(request);const query=new URL(request.url).searchParams;
  if([...query].length!==1||!query.has("quote_id")||!uuid.safeParse(query.get("quote_id")).success)throw new ApiError(422,"Référence de devis invalide.");
  const quoteId=query.get("quote_id")!.toLowerCase();const quote=await db.from("quotes").select("id,artisan_id,status").eq("id",quoteId).maybeSingle();dbError(quote.error);
  if(!quote.data)throw new ApiError(404,"Ce devis est introuvable.");
  if(quote.data.id!==quoteId)throw new ApiError(503,"Le règlement doit être vérifié. Réessayez.");
  const[payment,attempts]=await Promise.all([
   db.from("payments").select("quote_id,status,total_cents,currency,failure_code,created_at,updated_at,paid_at,method").eq("quote_id",quoteId).maybeSingle(),
   db.from("payment_attempts").select("id,status,total_cents,currency,failure_code,created_at,updated_at,paid_at,method",{count:"exact"}).eq("quote_id",quoteId).order("created_at",{ascending:false}).order("id").limit(50)
  ]);dbError(payment.error);dbError(attempts.error);
  const p=paymentSchema.nullable().safeParse(payment.data),a=z.array(attemptSchema).max(50).safeParse(attempts.data);
  if(!p.success||!a.success||!Number.isSafeInteger(attempts.count)||attempts.count!<a.data.length||(p.data&&p.data.quote_id!==quoteId)||[...(p.data?[p.data]:[]),...a.data].some(v=>v.status==="paid"&&!v.paid_at))throw new ApiError(503,"Le règlement doit être vérifié. Réessayez.");
  let artisanDispute: z.infer<typeof disputeState> | undefined;
  if (quote.data.artisan_id === user.id && quote.data.status === "accepted") {
    const dispute = await db.rpc("artisan_payment_dispute", { p_quote_id: quoteId });
    dbError(dispute.error);
    artisanDispute = disputeState.parse(dispute.data);
  }
  return Response.json({payment:p.data,attempts:a.data,attempts_limit:50,history_limited:attempts.count!>50,
    ...(artisanDispute === undefined ? {} : { artisan_dispute: artisanDispute })},{headers:PAYMENT_HEADERS});
 }catch(e){const status=e instanceof ApiError?e.status:503;return Response.json({error:e instanceof ApiError?e.message:"Le règlement est momentanément indisponible. Réessayez."},{status,headers:{...PAYMENT_HEADERS,...(status===503?{"Retry-After":"2"}:{})}});}
}
