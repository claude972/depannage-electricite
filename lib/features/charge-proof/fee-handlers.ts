import {z}from'zod';
import type Stripe from'stripe';
import type{Db}from'./handlers';
export interface FeeDependencies{authenticate():Promise<{db:Db;userId:string}>;admin():Db;stripe():Pick<Stripe,'applicationFees'>;env():Record<string,string|undefined>;now?():number}
const sid=(p:string)=>z.string().regex(new RegExp(`^${p}_[A-Za-z0-9_]{1,240}$`)),uuid=z.uuid(),money=z.number().int().min(0).max(2147483647),stamp=z.string().refine(x=>Number.isFinite(Date.parse(x)));
const sourceSchema=z.object({payment_id:uuid,event_id:sid('evt'),live:z.boolean(),fee_id:sid('fee'),charge_id:sid('ch'),connected_charge_id:sid('ch'),destination_account:sid('acct'),amount_cents:money,currency:z.literal('eur'),observation_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),observation_created:stamp}).strict();
const feeSchema=z.object({id:sid('fee'),object:z.literal('application_fee'),livemode:z.boolean(),currency:z.literal('eur'),account:z.unknown(),amount:money,charge:z.unknown(),originating_transaction:z.unknown(),amount_refunded:money.nullable(),refunded:z.boolean(),created:z.number().int().nonnegative()});
const qualificationSchema=z.object({event_id:sid('evt'),payment_id:uuid,source:sourceSchema,provider_amount_refunded_cents:money.nullable(),provider_refunded:z.boolean(),fee_created:z.number().int().nonnegative(),provider_observed_at:stamp,qualified_at:stamp}).strict();
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error{status:number;constructor(status:number){super();this.status=status}}
function fail(n:number):never{throw new Failure(n)}
function parse<T>(s:z.ZodType<T>,x:unknown):T{const r=s.safeParse(x);if(!r.success)fail(503);return r.data}
async function rpc(db:Db,n:string,a:Record<string,unknown>){const r=await db.rpc(n,a);if(r.error)fail(r.error.code==='42501'?403:r.error.code==='P0002'?404:['P0001','23505'].includes(r.error.code??'')?409:['22023','23514','22P02'].includes(r.error.code??'')?422:503);return r.data}
function error(e:unknown){const status=e instanceof Failure?e.status:(e as{status?:number})?.status===401?401:503;return Response.json({error:status===403?'Accès financier refusé.':'La commission ne peut pas être rapprochée avec ces preuves.'},{status,headers})}
const idOf=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'&&'id'in v?v.id:null;
type Context={params:Promise<{id:string;eventId:string}>};
export function createFeeProofHandlers(deps:FeeDependencies){
 const now=deps.now??Date.now;
 async function auth(write=false){const a=await deps.authenticate();if(await rpc(a.db,'has_platform_scope',{p_scope:'finance_read'})!==true)fail(403);if(write&&await rpc(a.db,'has_platform_scope',{p_scope:'finance_write'})!==true)fail(403);return a}
 async function ids(request:Request,ctx:Context){const p=z.object({id:uuid,eventId:sid('evt')}).safeParse(await ctx.params);if(!p.success||new URL(request.url).searchParams.size)fail(422);return p.data}
 async function read(db:Db,id:string,eventId:string){const r=parse(z.object({qualification:qualificationSchema.nullable()}).strict(),await rpc(db,'read_checkout_fee_proof',{p_payment:id,p_event:eventId})),q=r.qualification;if(q&&(q.payment_id!==id||q.event_id!==eventId||q.source.payment_id!==id||q.source.event_id!==eventId||(q.provider_amount_refunded_cents!==null&&(q.provider_amount_refunded_cents>q.source.amount_cents||q.provider_refunded!==(q.provider_amount_refunded_cents===q.source.amount_cents)))))fail(503);return r}
 return{
 GET:async(request:Request,ctx:Context)=>{try{const a=await auth(),p=await ids(request,ctx);return Response.json(await read(a.db,p.id,p.eventId),{headers})}catch(e){return error(e)}},
 POST:async(request:Request,ctx:Context)=>{try{
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail(403);const a=await auth(true),p=await ids(request,ctx);let body:unknown;try{body=await request.json()}catch{fail(422)}const input=z.object({command_id:uuid}).strict().safeParse(body);if(!input.success)fail(422);
  const env=deps.env(),key=env.STRIPE_SECRET_KEY??'';if(env.STRIPE_CHARGE_PROOF_ENABLED!=='true'||!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))fail(503);const live=/^(sk|rk)_live_/.test(key);if(live&&env.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')fail(503);
  const db=deps.admin(),c=parse(z.object({source:sourceSchema,completed:z.boolean()}).strict(),await rpc(db,'begin_checkout_fee_proof',{p_actor:a.userId,p_payment:p.id,p_event:p.eventId,p_command:input.data.command_id,p_live:live})),s=c.source;
  if(s.payment_id!==p.id||s.event_id!==p.eventId||s.live!==live)fail(503);
  if(!c.completed){
   const f=parse(feeSchema,await deps.stripe().applicationFees.retrieve(s.fee_id));
   if(f.id!==s.fee_id||f.livemode!==live||idOf(f.account)!==s.destination_account||f.amount!==s.amount_cents||idOf(f.charge)!==s.connected_charge_id||idOf(f.originating_transaction)!==s.charge_id||f.created>now()/1000||(f.amount_refunded!==null&&(f.amount_refunded>f.amount||f.refunded!==(f.amount_refunded===f.amount))))fail(409);
   if((await auth(true)).userId!==a.userId)fail(403);
   await rpc(db,'store_checkout_fee_proof',{p_actor:a.userId,p_command:input.data.command_id,p_source:s,p_provider:{id:f.id,object:f.object,livemode:f.livemode,currency:f.currency,account:idOf(f.account),amount:f.amount,charge:idOf(f.charge),originating_transaction:idOf(f.originating_transaction),amount_refunded:f.amount_refunded,refunded:f.refunded,created:f.created,observed_at:new Date(now()).toISOString()}});
  }
  return Response.json(await read(a.db,p.id,p.eventId),{headers});
 }catch(e){return error(e)}}
 };
}
