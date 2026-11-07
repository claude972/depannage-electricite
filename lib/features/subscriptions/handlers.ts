import {z} from 'zod';
import type Stripe from 'stripe';
export interface Db{rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>}
export interface Dependencies{authenticate():Promise<{db:Db;userId:string}>;admin():Db;stripe():Pick<Stripe,'prices'|'customers'|'checkout'|'subscriptions'>;env():Record<string,string|undefined>;now?():number}
const uuid=z.uuid(),time=z.string().refine(x=>Number.isFinite(Date.parse(x))),sid=z.string().regex(/^cs_[A-Za-z0-9_]{1,240}$/),cid=z.string().regex(/^cus_[A-Za-z0-9]{1,200}$/),pid=z.string().regex(/^price_[A-Za-z0-9]{1,200}$/),subid=z.string().regex(/^sub_[A-Za-z0-9]{1,200}$/);
const offer=z.object({id:uuid,version:z.number().int().positive(),live:z.boolean(),role:z.enum(['client','artisan']),label:z.string().min(1).max(160),active:z.boolean(),price_id:pid,amount_cents:z.number().int().min(0).max(2147483647),currency:z.string().regex(/^[a-z]{3}$/),interval:z.enum(['day','week','month','year']),interval_count:z.number().int().min(1).max(1000),tax_behavior:z.enum(['inclusive','exclusive','unspecified'])}).strict();
type Offer=z.infer<typeof offer>;
const account=z.object({id:uuid,actor:uuid,live:z.boolean(),customer_id:cid.nullable(),created_at:time,read_seq:z.number().int().nonnegative(),current_attempt:uuid.nullable()}).strict();
const status=z.enum(['preparing','open','expired','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']);
const attempt=z.object({id:uuid,account_id:uuid,command_id:uuid,offer,return_origin:z.string(),created_at:time,session_id:sid.nullable(),subscription_id:subid.nullable(),status,cancel_at_period_end:z.boolean(),period_start:z.number().int().nonnegative().nullable(),period_end:z.number().int().nonnegative().nullable(),observed_at:time.nullable()}).strict();
const contextSchema=z.object({enabled:z.boolean(),eligible:z.boolean(),role:z.enum(['client','artisan']),offers:z.array(offer).max(50),account:account.nullable(),attempt:attempt.nullable()}).strict();type Context=z.infer<typeof contextSchema>;
const checkoutInput=z.object({action:z.literal('checkout'),offer_id:uuid,offer_version:z.number().int().positive(),command_id:uuid,consent:z.literal(true)}).strict();
const offerInput=z.object({command_id:uuid,id:uuid.nullable(),expected_version:z.number().int().min(0).max(2147483646),label:z.string().trim().min(1).max(160),role:z.enum(['client','artisan']),active:z.boolean(),price_id:pid}).strict();
const priceSchema=z.object({id:pid,object:z.literal('price'),active:z.boolean(),livemode:z.boolean(),type:z.literal('recurring'),billing_scheme:z.literal('per_unit'),custom_unit_amount:z.null(),transform_quantity:z.null(),unit_amount:z.number().int().min(0).max(2147483647),currency:offer.shape.currency,tax_behavior:offer.shape.tax_behavior,recurring:z.object({interval:offer.shape.interval,interval_count:offer.shape.interval_count,usage_type:z.literal('licensed')})});
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error{status:number;constructor(status:number){super();this.status=status}}
function fail(n:number):never{throw new Failure(n)}
function parse<T>(s:z.ZodType<T>,x:unknown):T{const r=s.safeParse(x);if(!r.success)fail(503);return r.data}
async function rpc(db:Db,n:string,a:Record<string,unknown>){const r=await db.rpc(n,a);if(r.error){const c=r.error.code;fail(c==='42501'?403:c==='P0001'||c==='23505'?409:['22023','23514','22P02','23502'].includes(c??'')?422:503)}return r.data}
function cfg(env:Record<string,string|undefined>){const key=env.STRIPE_SECRET_KEY??'';if(!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))fail(503);const live=/^(sk|rk)_live_/.test(key);if(live&&env.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')fail(503);let u:URL;try{u=new URL(env.NEXT_PUBLIC_APP_URL??'')}catch{fail(503)}if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))fail(503);return {live,origin:u.origin,enabled:env.SUBSCRIPTIONS_ENABLED==='true'}}
function checkPrice(value:unknown,live:boolean,expected?:Offer,active=true){const p=parse(priceSchema,value);if(p.livemode!==live||(active&&!p.active))fail(409);if(expected&&(p.id!==expected.price_id||p.unit_amount!==expected.amount_cents||p.currency!==expected.currency||p.tax_behavior!==expected.tax_behavior||p.recurring.interval!==expected.interval||p.recurring.interval_count!==expected.interval_count))fail(409);return p}
function publicOffer(o:Offer){return {id:o.id,version:o.version,label:o.label,role:o.role,amount_cents:o.amount_cents,currency:o.currency,interval:o.interval,interval_count:o.interval_count,tax_behavior:o.tax_behavior}}
function checkCustomer(value:unknown,c:Context){const p=parse(z.object({id:cid,object:z.literal('customer'),livemode:z.boolean(),metadata:z.record(z.string(),z.string())}),value);if(!c.account||p.livemode!==c.account.live||p.metadata.subscription_account!==c.account.id||(c.account.customer_id&&c.account.customer_id!==p.id))fail(503);return p}
function checkSession(value:unknown,c:Context){const s=parse(z.object({id:sid,object:z.literal('checkout.session'),mode:z.literal('subscription'),customer:cid,livemode:z.boolean(),client_reference_id:uuid,metadata:z.record(z.string(),z.string()),status:z.enum(['open','complete','expired']),subscription:subid.nullable(),url:z.string().nullable(),currency:z.string(),amount_total:z.number().int().nonnegative()}),value);const a=c.account!,t=c.attempt!;if(s.customer!==a.customer_id||s.livemode!==a.live||s.client_reference_id!==t.id||s.metadata.subscription_attempt!==t.id||(t.session_id&&s.id!==t.session_id)||s.currency!==t.offer.currency||s.amount_total!==t.offer.amount_cents)fail(409);return s}
function url(value:string|null){if(!value)fail(503);let u:URL;try{u=new URL(value)}catch{fail(503)}if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.username||u.password||(u.port&&u.port!=='443'))fail(503);return value}
export function createSubscriptionHandlers(deps:Dependencies){
 const now=deps.now??Date.now;
 function window(stamp:string){const age=now()-Date.parse(stamp);if(age< -30000)fail(503);if(age>=23*3600000)fail(409)}
 async function auth(operator=false){const a=await deps.authenticate();const role=await rpc(a.db,'subscription_guard',{p_operator:operator});if(!(operator?role==='operator':['client','artisan'].includes(String(role))))fail(403);return a}
 async function context(db:Db,actor:string,live:boolean,read=false){const c=parse(contextSchema,await rpc(db,'subscription_context',{p_actor:actor,p_live:live,p_read:read}));if(c.account&&(c.account.actor!==actor||c.account.live!==live))fail(503);if(c.attempt&&(!c.account||c.attempt.account_id!==c.account.id||c.attempt.id!==c.account.current_attempt||c.attempt.offer.live!==live))fail(503);if(c.offers.some(o=>o.live!==live||o.role!==c.role||!o.active))fail(503);return c}
 function current(c:Context,envEnabled:boolean,expected?:string){if(!c.enabled||!c.eligible||!envEnabled||!c.attempt||(expected&&c.attempt.id!==expected)||c.attempt.offer.role!==c.role||!c.offers.some(o=>o.id===c.attempt!.offer.id&&o.version===c.attempt!.offer.version))fail(409)}
 async function reconcile(db:Db,actor:string,live:boolean,stripe:ReturnType<Dependencies['stripe']>,c:Context){
  const a=c.account,t=c.attempt;if(!a?.customer_id||!t?.session_id)return c;
  checkCustomer(await stripe.customers.retrieve(a.customer_id),c);
  const session=checkSession(await stripe.checkout.sessions.retrieve(t.session_id),c);
  let state:string=session.status==='expired'?'expired':'open',cancel=false,start:number|null=null,end:number|null=null,sub:string|null=null;
  if(session.status==='complete'){
   if(!session.subscription)fail(503);sub=session.subscription;
   const s=parse(z.object({id:subid,object:z.literal('subscription'),customer:cid,livemode:z.boolean(),status:z.enum(['incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']),currency:z.string(),metadata:z.record(z.string(),z.string()),cancel_at_period_end:z.boolean(),items:z.object({has_more:z.literal(false),data:z.array(z.object({subscription:subid,quantity:z.literal(1),current_period_start:z.number().int().nonnegative(),current_period_end:z.number().int().nonnegative(),price:z.unknown()})).length(1)})}),await stripe.subscriptions.retrieve(sub));
   if(s.id!==sub||s.customer!==a.customer_id||s.livemode!==live||s.metadata.subscription_attempt!==t.id||s.currency!==t.offer.currency||s.items.data[0].subscription!==sub||s.items.data[0].current_period_end<s.items.data[0].current_period_start||(t.subscription_id&&t.subscription_id!==sub))fail(409);
   checkPrice(s.items.data[0].price,live,t.offer,false);checkPrice(await stripe.prices.retrieve(t.offer.price_id),live,t.offer,false);
   state=s.status;cancel=s.cancel_at_period_end;start=s.items.data[0].current_period_start;end=s.items.data[0].current_period_end;
  }else{if(session.subscription)fail(503);checkPrice(await stripe.prices.retrieve(t.offer.price_id),live,t.offer,false)}
  await rpc(db,'observe_subscription',{p_actor:actor,p_live:live,p_attempt:t.id,p_sequence:a.read_seq,p_session:session.id,p_subscription:sub,p_status:state,p_cancel:cancel,p_start:start,p_end:end});
  return context(db,actor,live,false);
 }
 function response(c:Context,available:boolean){const t=c.attempt;return Response.json({available,offers:available?c.offers.map(publicOffer):[],checkout_pending:!!t&&['preparing','open'].includes(t.status),subscription:t?.subscription_id?{status:t.status,cancel_at_period_end:t.cancel_at_period_end,current_period_start:t.period_start,current_period_end:t.period_end,observed_at:t.observed_at,offer:publicOffer(t.offer)}:null},{headers})}
 function error(e:unknown){const n=(e as {status?:number})?.status;const s=e instanceof Failure?e.status:n===401?401:503;const messages:Record<number,string>={401:'Connectez-vous à votre compte.',403:'Cet abonnement n’est pas accessible à votre compte.',409:'L’offre ou l’abonnement doit être relu avant de continuer.',422:'Vérifiez votre demande.',503:'Les abonnements optionnels sont indisponibles. Aucun droit existant n’est retiré.'};return Response.json({error:messages[s]},{status:s,headers})}
 async function body(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail(403);if(new URL(request.url).searchParams.size)fail(422);try{return await request.json()}catch{fail(422)}}
 return {
  GET:async(request:Request)=>{try{
   if(new URL(request.url).searchParams.size)fail(422);const a=await auth();
   // No configured provider + no enabled feature is a genuine unavailable view, not a fake subscription.
   const configuration=cfg(deps.env()),db=deps.admin();let c=await context(db,a.userId,configuration.live,true);
   if(c.attempt?.session_id)c=await reconcile(db,a.userId,configuration.live,deps.stripe(),c);
   const available=c.enabled&&c.eligible&&configuration.enabled;if(available)for(const o of c.offers)checkPrice(await deps.stripe().prices.retrieve(o.price_id),configuration.live,o,true);
   return response(c,available);
  }catch(e){return error(e)}},
  POST:async(request:Request)=>{try{
   const a=await auth(),input=checkoutInput.safeParse(await body(request));if(!input.success)fail(422);const i=input.data,configuration=cfg(deps.env());if(!configuration.enabled)fail(503);
   const db=deps.admin(),stripe=deps.stripe();let c=parse(contextSchema,await rpc(db,'begin_subscription_checkout',{p_actor:a.userId,p_live:configuration.live,p_command:i.command_id,p_offer:i.offer_id,p_version:i.offer_version,p_origin:configuration.origin}));
   c=await context(db,a.userId,configuration.live);current(c,true);let t=c.attempt!,account=c.account!;
   if(t.command_id!==i.command_id||t.offer.id!==i.offer_id||t.offer.version!==i.offer_version)fail(409);
   checkPrice(await stripe.prices.retrieve(t.offer.price_id),configuration.live,t.offer,true);
   if(!account.customer_id){c=await context(db,a.userId,configuration.live);current(c,true,t.id);window(account.created_at);window(t.created_at);
    const customer=checkCustomer(await stripe.customers.create({metadata:{subscription_account:account.id}},{idempotencyKey:`subscription-customer:${account.id}`}),c);
    await rpc(db,'bind_subscription_provider',{p_actor:a.userId,p_live:configuration.live,p_attempt:t.id,p_kind:'customer',p_value:customer.id});
    c=await context(db,a.userId,configuration.live);account=c.account!;if(!account.customer_id)fail(503);
   }
   checkCustomer(await stripe.customers.retrieve(account.customer_id!),c);let session;
   if(t.session_id)session=checkSession(await stripe.checkout.sessions.retrieve(t.session_id),c);
   else{
    c=await context(db,a.userId,configuration.live);current(c,true,t.id);window(t.created_at);
    session=checkSession(await stripe.checkout.sessions.create({mode:'subscription',customer:account.customer_id!,allowed_payment_method_types:['card'],line_items:[{price:t.offer.price_id,quantity:1}],client_reference_id:t.id,metadata:{subscription_attempt:t.id},subscription_data:{metadata:{subscription_attempt:t.id}},success_url:`${t.return_origin}/?subscription=returned#profile`,cancel_url:`${t.return_origin}/?subscription=cancelled#profile`},{idempotencyKey:`subscription-checkout:${t.id}`}),c);
    await rpc(db,'bind_subscription_provider',{p_actor:a.userId,p_live:configuration.live,p_attempt:t.id,p_kind:'session',p_value:session.id});
   }
   if(session.status!=='open')fail(409);current(await context(db,a.userId,configuration.live),true,t.id);return Response.json({url:url(session.url)},{headers});
  }catch(e){return error(e)}},
  OFFER:async(request:Request)=>{try{
   const a=await auth(true),input=offerInput.safeParse(await body(request));if(!input.success)fail(422);const i=input.data,configuration=cfg(deps.env());
   const p=checkPrice(await deps.stripe().prices.retrieve(i.price_id),configuration.live,undefined,i.active);if(p.id!==i.price_id)fail(503);
   const result=parse(offer,await rpc(deps.admin(),'save_subscription_offer',{p_actor:a.userId,p_command:i.command_id,p_id:i.id,p_version:i.expected_version,p_live:configuration.live,p_values:{role:i.role,label:i.label,active:i.active,price_id:p.id,amount_cents:p.unit_amount,currency:p.currency,interval:p.recurring.interval,interval_count:p.recurring.interval_count,tax_behavior:p.tax_behavior}}));
   if(result.live!==configuration.live||result.role!==i.role||result.price_id!==p.id||result.version!==i.expected_version+1)fail(503);return Response.json({offer:publicOffer(result),active:result.active},{headers});
  }catch(e){return error(e)}}
 };
}
