import { env } from "node:process";
import { z } from "zod";
import { authenticatedClient, adminClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { stripeClient, appUrl, commissionBps } from "@/lib/supabase/stripe";
import { safeCheckoutUrl } from "@/lib/shared/stripe-checkout-url";

export const PAYMENT_HEADERS={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
const cents=z.number().int().positive().max(2147483647);
const date=z.string().refine(s=>/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s)));
const source=z.object({id:uuid,quote_id:uuid,intervention_id:uuid,actor_id:uuid,artisan_id:uuid,amount_cents:cents,currency:z.literal("eur"),amendments:z.array(z.object({id:uuid,version:z.number().int().positive(),total_cents:cents}).strict()).max(10000),account_id:z.string().regex(/^acct_[A-Za-z0-9]{1,200}$/),return_origin:z.string().nullable(),fee_bps:z.number().int().min(0).max(9999).nullable(),fee_cents:z.number().int().nonnegative().nullable(),status:z.enum(["preparing","open","awaiting_bank","paid","expired","needs_review"]),session_id:z.string().regex(/^cs_[A-Za-z0-9_]{1,240}$/).nullable(),created_at:date,expires_at:date.nullable(),paid_at:date.nullable()}).strict().superRefine((v,ctx)=>{
 if((v.fee_bps===null)!==(v.fee_cents===null)||(v.fee_bps!==null&&(v.return_origin===null||v.fee_cents!==Math.round(v.amount_cents*v.fee_bps/10000)||v.fee_cents>=v.amount_cents)))ctx.addIssue({code:"custom",message:"Invalid financial qualification"});
 if(v.return_origin!==null&&!safeOrigin(v.return_origin))ctx.addIssue({code:"custom",message:"Invalid return origin"});
 if(v.status!=="preparing"&&v.status!=="needs_review"&&!v.session_id)ctx.addIssue({code:"custom",message:"Missing session"});
});
export type CheckoutLedger=z.infer<typeof source>;
const checkoutContext = z.object({
  ledger: z.unknown(),
  saved_customer: z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]{1,200}$/), binding_id: uuid }).strict().nullable(),
}).strict();
type CheckoutContext = CheckoutLedger & { savedCustomer: z.infer<typeof checkoutContext>["saved_customer"] };
const unavailable=()=>new ApiError(503,"Le paiement ne peut pas être vérifié pour le moment. Réessayez depuis le même dossier.");
const conflict=()=>new ApiError(409,"Le règlement doit être vérifié avant une nouvelle tentative. Actualisez le dossier ou contactez l’assistance.");
function safeOrigin(s:string){try{const u=new URL(s);return u.origin===s&&!u.username&&!u.password&&(u.protocol==="https:"||(u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)));}catch{return false}}
export function checkoutConfigurationAvailable(env:Record<string,string|undefined>){
 const key=env.STRIPE_SECRET_KEY??"",rate=Number(env.PLATFORM_FEE_BPS);let origin:string|null=null;try{origin=new URL(env.NEXT_PUBLIC_APP_URL??"").origin;}catch{}
 return /^(sk|rk)_(test|live)_/.test(key)&&(!/^(sk|rk)_live_/.test(key)||env.STRIPE_LIVE_PAYMENTS_ENABLED==="true")&&!!env.PLATFORM_FEE_BPS&&Number.isInteger(rate)&&rate>=0&&rate<10000&&!!origin&&safeOrigin(origin);
}
function ledger(value:unknown,actor:string,id:string,quote:string){const p=source.safeParse(value);if(!p.success||p.data.actor_id!==actor||p.data.id!==id||p.data.quote_id!==quote||Date.parse(p.data.created_at)>Date.now()+30000)throw unavailable();return p.data;}

type Db=ReturnType<typeof adminClient>;
async function read(admin: Db, actor: string, id: string, quote: string, live: boolean): Promise<CheckoutContext> {
  const r = await admin.rpc("platform_checkout_with_customer_private", { p_id: id, p_actor: actor, p_live: live });
  dbError(r.error);
  const parsed = checkoutContext.safeParse(r.data);
  if (!parsed.success) throw unavailable();
  return { ...ledger(parsed.data.ledger, actor, id, quote), savedCustomer: parsed.data.saved_customer };
}
async function reconcile(admin:Db,l:CheckoutLedger,state:"expired"|"awaiting_bank"|"needs_review"){const r=await admin.rpc("reconcile_platform_checkout",{p_id:l.id,p_actor:l.actor_id,p_session:l.session_id,p_state:state});dbError(r.error)}
function checkSession(s:any,l:CheckoutContext,live:boolean){
 if(!s||s.object!=="checkout.session"||s.mode!=="payment"||s.livemode!==live||s.client_reference_id!==l.quote_id||s.metadata?.quote_id!==l.quote_id||s.metadata?.platform_checkout_id!==l.id||s.currency!==l.currency||s.amount_total!==l.amount_cents||typeof s.id!=="string"||!/^cs_[A-Za-z0-9_]{1,240}$/.test(s.id)||(l.session_id!==null&&s.id!==l.session_id)||!Number.isSafeInteger(s.expires_at)||s.expires_at*1000<=Date.parse(l.created_at)||s.expires_at*1000>Date.parse(l.created_at)+25*3600000)throw unavailable();
 if(!["open","complete","expired"].includes(s.status)||!["unpaid","paid","no_payment_required"].includes(s.payment_status)||s.payment_status==="no_payment_required")throw unavailable();
 if (l.savedCustomer && s.customer !== l.savedCustomer.id) throw unavailable();
 return s;
}

/** Reads/creates a Checkout with a durable SQL snapshot before provider mutation.
 * Lost replies reuse ledger-ID idempotency within a conservative 23-hour window.
 * No browser amount, recipient, commission, actor or redirect is accepted. */
export async function createQuoteCheckout(request:Request){
 try{
  assertOrigin(request);const{db,user}=await authenticatedClient(request);const input=await validated(request,z.object({quote_id:uuid}).strict());const quote_id=input.quote_id.toLowerCase();
  const guard=await db.rpc("guard_phone_booking_checkout",{p_quote_id:quote_id});dbError(guard.error);
  // Config errors precede any durable financial intent/provider operation.
  const stripe=stripeClient(),origin=appUrl(),fee=commissionBps();
  if(fee>=10000)throw new ApiError(503,"Les conditions de commission doivent être vérifiées avant paiement.");
  const live=/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY??"");const admin=adminClient();
  // At most one verified expiry followed by one new attempt per HTTP request.
  for(let cycle=0;cycle<2;cycle++){
   const begun=await db.rpc("begin_platform_checkout_with_saved_customer",{p_quote_id:quote_id,p_live:live});dbError(begun.error);if(!uuid.safeParse(begun.data).success)throw unavailable();
   let l=await read(admin,user.id,begun.data,quote_id,live);
   if(["needs_review","awaiting_bank","paid","expired"].includes(l.status))throw conflict();
   if(l.session_id){
    const s=checkSession(await stripe.checkout.sessions.retrieve(l.session_id),l,live);
    if(s.status==="open"&&s.payment_status==="unpaid"){if(!safeCheckoutUrl(s.url))throw unavailable();await read(admin,user.id,l.id,quote_id,live);return Response.json({url:s.url},{headers:PAYMENT_HEADERS});}
    if(s.status==="expired"&&s.payment_status==="unpaid"){await reconcile(admin,l,"expired");continue;}
    if(s.status==="complete"){await reconcile(admin,l,"awaiting_bank");throw conflict();}
    throw unavailable();
   }
   if(Date.now()-Date.parse(l.created_at)>=23*3600000){await reconcile(admin,l,"needs_review");throw conflict();}
   const account=await stripe.v2.core.accounts.retrieve(l.account_id,{include:["configuration.recipient"]});
   if(account.id!==l.account_id||account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=="active")throw new ApiError(409,"Le compte de règlement de l’artisan doit être validé avant paiement.");
   const qualified=await admin.rpc("qualify_platform_checkout",{p_id:l.id,p_actor:user.id,p_account:l.account_id,p_fee:l.fee_bps??fee,p_origin:l.return_origin??origin});dbError(qualified.error);
   l=await read(admin,user.id,l.id,quote_id,live);if(l.fee_cents===null||!l.return_origin)throw unavailable();
   if (l.savedCustomer) {
     const customer = await stripe.customers.retrieve(l.savedCustomer.id);
     if (customer.deleted || customer.id !== l.savedCustomer.id || customer.livemode !== live ||
         customer.metadata.saved_customer_binding !== l.savedCustomer.binding_id) throw unavailable();
     l = await read(admin,user.id,l.id,quote_id,live);
     if(l.fee_cents===null||!l.return_origin)throw unavailable();
   }
   // The re-read is followed by a fresh clock check. A slow account lookup never
   // makes a stale creation key safe to reuse after the idempotency bound.
   if(Date.now()-Date.parse(l.created_at)>=23*3600000){await reconcile(admin,l,"needs_review");throw conflict();}
   const s=checkSession(await stripe.checkout.sessions.create({mode:"payment",allowed_payment_method_types:["card"],locale:"fr",expires_at:Math.floor(Date.parse(l.created_at)/1000)+24*3600,
    ...(l.savedCustomer ? { customer: l.savedCustomer.id, saved_payment_method_options: { allow_redisplay_filters: ["always", "unspecified"] } } : {}),
    line_items:[{quantity:1,price_data:{currency:"eur",unit_amount:l.amount_cents,product_data:{name:"Intervention électrique — devis et avenants acceptés",metadata:{quote_id:l.quote_id}}}}],client_reference_id:l.quote_id,
    metadata:{quote_id:l.quote_id,platform_checkout_id:l.id},payment_intent_data:{application_fee_amount:l.fee_cents,transfer_data:{destination:l.account_id},metadata:{quote_id:l.quote_id,platform_checkout_id:l.id}},
    success_url:`${l.return_origin}/?payment=pending&intervention=${l.intervention_id}`,cancel_url:`${l.return_origin}/?payment=cancelled&intervention=${l.intervention_id}`}, {idempotencyKey:`platform-checkout:${l.id}`}),l,live);
   if(s.status!=="open"||s.payment_status!=="unpaid"){await reconcile(admin,l,"needs_review");throw conflict();}
   if(!safeCheckoutUrl(s.url))throw unavailable();
   const bound=await admin.rpc("bind_platform_checkout",{p_id:l.id,p_actor:user.id,p_session:s.id,p_amount:l.amount_cents,p_currency:l.currency,p_expires:new Date(s.expires_at*1000).toISOString()});dbError(bound.error);
   await read(admin,user.id,l.id,quote_id,live);
   return Response.json({url:s.url},{headers:PAYMENT_HEADERS});
  }
  throw conflict();
 }catch(e){const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:503;return Response.json({error:e instanceof ApiError?e.message:"Le paiement n’a pas pu être confirmé. Réessayez depuis le même dossier."},{status,headers:{...PAYMENT_HEADERS,...(status===503?{"Retry-After":"2"}:{})}});}
}
