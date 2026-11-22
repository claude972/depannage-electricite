import {z} from 'zod';
import type Stripe from 'stripe';
export interface Db{rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>}
export interface Dependencies{authenticate():Promise<{db:Db;userId:string}>;admin():Db;stripe():Pick<Stripe,'checkout'|'paymentIntents'|'charges'>;env():Record<string,string|undefined>}
const uuid=z.uuid(),stripeId=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,240}$`));
const timestamp=z.string().refine(x=>Number.isFinite(Date.parse(x))),amount=z.number().int().positive().max(2147483647),epoch=z.number().int().nonnegative();
const stripeFeeAmount = z.number().int().nonnegative().nullable();
const sourceSchema=z.object({payment_id:uuid,checkout_id:uuid,quote_id:uuid,intervention_id:uuid,session_id:stripeId('cs'),amount_cents:amount,fee_cents:z.number().int().nonnegative(),destination_account:stripeId('acct'),currency:z.literal('eur'),paid_at:timestamp}).strict();type Source=z.infer<typeof sourceSchema>;
const providerSchema=z.object({payment_intent_id:stripeId('pi'),charge_id:stripeId('ch'),charge_created:epoch,session_created:epoch,intent_created:epoch}).strict();
const proofSchema=providerSchema.extend({payment_id:uuid,live:z.boolean(),source:sourceSchema,verified_at:timestamp}).strict();
const pageSchema=z.object({proof:proofSchema.nullable(),dispute_observations:z.array(z.object({event_id:stripeId('evt'),observation_version:z.number().int().positive(),dispute_id:stripeId('du'),observed_status:z.string().max(80).nullable(),disputed_amount_cents:amount,currency:z.literal('eur'),observed_at:timestamp}).strict()).max(50),next_after:stripeId('evt').nullable()}).strict();
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error{status:number;constructor(status:number){super();this.status=status}}
function fail(status:number):never{throw new Failure(status)}
function parse<T>(s:z.ZodType<T>,v:unknown):T{const r=s.safeParse(v);if(!r.success)fail(503);return r.data}
async function rpc(db:Db,name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error)fail(r.error.code==='42501'?403:r.error.code==='P0002'?404:['P0001','23505'].includes(r.error.code??'')?409:['22023','23514','22P02'].includes(r.error.code??'')?422:503);return r.data}
function error(e:unknown){const s=e instanceof Failure?e.status:(e as {status?:number})?.status===401?401:503;return Response.json({error:s===401?'Connectez-vous.':s===403?'Accès financier refusé.':s===409?'La preuve ou ses références doivent être revérifiées.':'La preuve de paiement ne peut pas être confirmée.'},{status:s,headers})}
function idOf(value:unknown){return typeof value==='string'?value:value&&typeof value==='object'&&'id'in value?value.id:null}
async function qualify(stripe:ReturnType<Dependencies['stripe']>,s:Source,live:boolean){
 const session=parse(z.object({id:stripeId('cs'),object:z.literal('checkout.session'),mode:z.literal('payment'),status:z.literal('complete'),payment_status:z.literal('paid'),livemode:z.boolean(),client_reference_id:uuid,amount_total:amount,currency:z.literal('eur'),payment_intent:z.unknown(),metadata:z.record(z.string(),z.string()),created:epoch}),await stripe.checkout.sessions.retrieve(s.session_id));
 const piId=parse(stripeId('pi'),idOf(session.payment_intent));
 if(session.id!==s.session_id||session.livemode!==live||session.client_reference_id!==s.quote_id||session.metadata.quote_id!==s.quote_id||session.metadata.platform_checkout_id!==s.checkout_id||session.amount_total!==s.amount_cents)fail(409);
 const pi=parse(z.object({id:stripeId('pi'),object:z.literal('payment_intent'),status:z.literal('succeeded'),livemode:z.boolean(),amount,amount_received:amount,currency:z.literal('eur'),metadata:z.record(z.string(),z.string()),transfer_data:z.object({destination:z.unknown()}),application_fee_amount:stripeFeeAmount,latest_charge:z.unknown(),created:epoch}),await stripe.paymentIntents.retrieve(piId));
 const chargeId=parse(stripeId('ch'),idOf(pi.latest_charge));
 // Stripe returns an explicit null when no application fee was requested. The frozen zero is still required.
 if(pi.id!==piId||pi.livemode!==live||pi.amount!==s.amount_cents||pi.amount_received!==s.amount_cents||pi.metadata.quote_id!==s.quote_id||pi.metadata.platform_checkout_id!==s.checkout_id||idOf(pi.transfer_data.destination)!==s.destination_account||(pi.application_fee_amount??0)!==s.fee_cents)fail(409);
 const charge=parse(z.object({id:stripeId('ch'),object:z.literal('charge'),status:z.literal('succeeded'),paid:z.literal(true),captured:z.literal(true),livemode:z.boolean(),amount,amount_captured:amount,currency:z.literal('eur'),payment_intent:z.unknown(),transfer_data:z.object({destination:z.unknown()}),application_fee_amount:stripeFeeAmount,created:epoch}),await stripe.charges.retrieve(chargeId));
 if(charge.id!==chargeId||charge.livemode!==live||charge.amount!==s.amount_cents||charge.amount_captured!==s.amount_cents||idOf(charge.payment_intent)!==piId||idOf(charge.transfer_data.destination)!==s.destination_account||(charge.application_fee_amount??0)!==s.fee_cents||charge.created> Date.now()/1000+300||session.created>charge.created||pi.created>charge.created)fail(409);
 return{payment_intent_id:piId,charge_id:chargeId,charge_created:charge.created,session_created:session.created,intent_created:pi.created};
}
export function createChargeProofHandlers(deps:Dependencies){
 async function auth(write=false){const a=await deps.authenticate();if(await rpc(a.db,'has_platform_scope',{p_scope:'finance_read'})!==true)fail(403);if(write&&await rpc(a.db,'has_platform_scope',{p_scope:'finance_write'})!==true)fail(403);return a}
 async function payment(ctx:{params:Promise<{id:string}>}){const r=uuid.safeParse((await ctx.params).id);if(!r.success)fail(422);return r.data}
 async function read(db:Db,id:string,after:string|null){const p=parse(pageSchema,await rpc(db,'read_checkout_charge_proof',{p_payment:id,p_after:after}));if(p.proof&&(p.proof.payment_id!==id||p.proof.source.payment_id!==id||p.proof.source.fee_cents>=p.proof.source.amount_cents))fail(503);if(!p.proof&&(p.dispute_observations.length||p.next_after))fail(503);let previous=after??'';for(const o of p.dispute_observations){if(o.event_id<=previous||o.disputed_amount_cents>p.proof!.source.amount_cents)fail(503);previous=o.event_id}if(p.next_after&&(p.dispute_observations.length!==50||p.next_after!==previous))fail(503);return p}
 return{
 GET:async(request:Request,ctx:{params:Promise<{id:string}>})=>{try{const a=await auth(),id=await payment(ctx),q=new URL(request.url).searchParams;for(const k of q.keys())if(k!=='after'||q.getAll(k).length!==1)fail(422);const after=q.get('after');if(after&&!stripeId('evt').safeParse(after).success)fail(422);return Response.json(await read(a.db,id,after),{headers})}catch(e){return error(e)}},
 POST:async(request:Request,ctx:{params:Promise<{id:string}>})=>{try{
  const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)fail(403);if(new URL(request.url).searchParams.size)fail(422);
  const a=await auth(true),id=await payment(ctx);let body:unknown;try{body=await request.json()}catch{fail(422)}const input=z.object({command_id:uuid}).strict().safeParse(body);if(!input.success)fail(422);
  const env=deps.env(),key=env.STRIPE_SECRET_KEY??'';if(env.STRIPE_CHARGE_PROOF_ENABLED!=='true'||!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))fail(503);const live=/^(sk|rk)_live_/.test(key);if(live&&env.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')fail(503);
  const db=deps.admin(),c=parse(z.object({source:sourceSchema,live:z.boolean()}).strict(),await rpc(db,'begin_checkout_charge_proof',{p_actor:a.userId,p_payment:id,p_command:input.data.command_id,p_live:live}));if(c.live!==live||c.source.payment_id!==id||c.source.fee_cents>=c.source.amount_cents)fail(503);
  const proof=await qualify(deps.stripe(),c.source,live);if((await auth(true)).userId!==a.userId)fail(403);
  await rpc(db,'store_checkout_charge_proof',{p_actor:a.userId,p_payment:id,p_command:input.data.command_id,p_live:live,p_source:c.source,p_provider:proof});
  return Response.json(await read(a.db,id,null),{headers});
 }catch(e){return error(e)}}
 };
}
