import {env}from 'node:process';
import {z}from 'zod';
import {authenticatedClient,adminClient,ApiError,assertOrigin,dbError}from '@/lib/supabase/server';
import {stripeClient}from '@/lib/supabase/stripe';
import {uuid,validated}from '@/lib/supabase/validation';
import {PAYMENT_HEADERS}from '@/lib/features/payments/checkout';
import {platformMfaRefusal,platformWriteError}from '@/lib/features/platform-operations/mfa';
const unavailable=()=>new ApiError(503,'Le remboursement doit être vérifié. Aucune confirmation bancaire ne peut être donnée.');
const conflict=()=>new ApiError(409,'Ce remboursement nécessite un rapprochement avant toute nouvelle émission.');
import {refundPolicy}from './policy';
export {refundPolicy}from './policy';
const money=z.number().int().positive().max(2147483647),id=z.string().min(1).max(255);
const policy=z.object({version:z.string().min(1).max(80),reverse_transfer:z.boolean(),refund_application_fee:z.boolean(),livemode:z.boolean()}).strict();
const execution=z.object({id:uuid,request_id:uuid,actor_id:uuid,request_version:z.number().int().positive(),policy:policy.nullable(),charge_id:id.nullable(),payment_intent_id:id.nullable(),provider_refund_id:id.nullable(),state:z.enum(['preparing','submitted','pending','requires_action','failed','canceled','succeeded','unknown','needs_review']),created_at:z.string(),updated_at:z.string()}).strict();
const source=z.object({execution,request:z.object({id:uuid,status:z.string(),version:z.number().int().positive(),payment_id:uuid,amount_cents:money,currency:z.literal('eur')}).strict(),payment:z.object({id:uuid,quote_id:uuid,session_id:id,total_cents:money,currency:z.literal('eur'),status:z.literal('paid'),paid_at:z.string().min(1)}).strict(),checkout:z.object({id:uuid,account_id:id,fee_cents:z.number().int().nonnegative(),amount_cents:money}).strict().nullable()}).strict();
type Source=z.infer<typeof source>;type Admin=ReturnType<typeof adminClient>;
async function rpc(db:{rpc:Function},name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);platformWriteError(r.error);return r.data;}
async function read(admin:Admin,id:string,actor:string|null){const data=source.safeParse(await rpc(admin,'refund_execution_private',{p_id:id,p_actor:actor}));if(!data.success||data.data.execution.id!==id||(actor!==null&&data.data.execution.actor_id!==actor)||data.data.request.id!==data.data.execution.request_id||data.data.payment.id!==data.data.request.payment_id||data.data.request.amount_cents>data.data.payment.total_cents||(data.success&&data.data.execution.state==='succeeded'&&(data.data.request.status!=='settled'||data.data.execution.provider_refund_id===null)))throw unavailable();return data.data;}
function objectId(v:any){return typeof v==='string'?v:v?.id;}
function meta(s:Source){return{platform_refund_execution_id:s.execution.id,platform_refund_request_id:s.request.id,payment_id:s.payment.id,quote_id:s.payment.quote_id};}
function checkRefund(r:any,s:Source,live:boolean){const e=s.execution;if(!r||r.object!=='refund'||!/^re_[A-Za-z0-9_]{1,240}$/.test(r.id)||r.amount!==s.request.amount_cents||r.currency!=='eur'||objectId(r.charge)!==e.charge_id||objectId(r.payment_intent)!==e.payment_intent_id||(e.provider_refund_id!==null&&r.id!==e.provider_refund_id)||!['pending','requires_action','succeeded','failed','canceled'].includes(r.status)||Object.entries(meta(s)).some(([k,v])=>r.metadata?.[k]!==v)||e.policy?.livemode!==live)throw unavailable();return r;}
async function qualifiedCharge(stripe:ReturnType<typeof stripeClient>,s:Source,live:boolean){const c=s.checkout;if(!c||c.amount_cents!==s.payment.total_cents)throw conflict();
 const session=await stripe.checkout.sessions.retrieve(s.payment.session_id);const piId=objectId(session.payment_intent);
 if(session.object!=='checkout.session'||session.mode!=='payment'||session.livemode!==live||session.id!==s.payment.session_id||session.client_reference_id!==s.payment.quote_id||session.metadata?.quote_id!==s.payment.quote_id||session.metadata?.platform_checkout_id!==c.id||session.amount_total!==c.amount_cents||session.currency!=='eur'||session.payment_status!=='paid'||typeof piId!=='string'||!/^pi_/.test(piId))throw unavailable();
 const pi=await stripe.paymentIntents.retrieve(piId),chargeId=objectId(pi.latest_charge);
 if(pi.id!==piId||pi.status!=='succeeded'||pi.livemode!==live||pi.amount!==c.amount_cents||pi.amount_received!==c.amount_cents||pi.currency!=='eur'||pi.metadata.quote_id!==s.payment.quote_id||pi.metadata.platform_checkout_id!==c.id||objectId(pi.transfer_data?.destination)!==c.account_id||pi.application_fee_amount!==c.fee_cents||typeof chargeId!=='string')throw unavailable();
 const charge=await stripe.charges.retrieve(chargeId);
 if(charge.id!==chargeId||charge.livemode!==live||!charge.paid||!charge.captured||charge.amount!==c.amount_cents||charge.amount_captured!==c.amount_cents||!Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<0||charge.amount_refunded+s.request.amount_cents>c.amount_cents||charge.currency!=='eur'||objectId(charge.payment_intent)!==piId||objectId(charge.transfer_data?.destination)!==c.account_id||charge.application_fee_amount!==c.fee_cents)throw unavailable();
 return{charge:charge.id,intent:pi.id};
}
function result(s:Source){return{request_status:s.request.status,execution_status:s.execution.state,execution_id:s.execution.id,bank_confirmation:s.execution.state==='succeeded'};}
function failure(e:unknown){const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:503;return Response.json(platformMfaRefusal(e)??{error:e instanceof ApiError?e.message:'Le remboursement ne peut pas être confirmé.'},{status,headers:{...PAYMENT_HEADERS,...(status===503?{'Retry-After':'2'}:{})}});}
export async function executeRefund(request:Request,context:{params:Promise<{id:string}>}){try{
 assertOrigin(request);const{db,user}=await authenticatedClient();const{id}=await context.params;if(!uuid.safeParse(id).success)throw new ApiError(404,'Demande introuvable.');if(new URL(request.url).searchParams.size)throw new ApiError(422,'Paramètres inattendus.');
 const input=await validated(request,z.object({command_id:uuid,expected_version:z.number().int().positive()}).strict());
 // Authorize before reading availability; configuration failure creates no durable intent.
 const access=await db.rpc('has_platform_scope',{p_scope:'finance_write'});dbError(access.error);if(access.data!==true)throw new ApiError(403,'Accès refusé.');
 const p=refundPolicy(env);if(!p)throw new ApiError(503,'Configuration du remboursement requise. Aucun remboursement n’a été émis.');
 const command=input.command_id.toLowerCase();const executionId=await rpc(db,'begin_refund_execution',{p_id:id.toLowerCase(),p_command:command,p_version:input.expected_version});if(executionId!==command)throw unavailable();
 const admin=adminClient(),stripe=stripeClient();let s=await read(admin,executionId,user.id);if(['succeeded','failed','canceled'].includes(s.execution.state))return Response.json(result(s),{headers:PAYMENT_HEADERS});if(s.execution.state==='needs_review')throw conflict();
 if(!s.checkout){await rpc(admin,'bind_refund_execution',{p_id:executionId,p_actor:user.id,p_refund:null,p_state:'needs_review'});throw conflict();}
 if(!s.execution.policy){const q=await qualifiedCharge(stripe,s,p.livemode);await rpc(admin,'qualify_refund_execution',{p_id:executionId,p_actor:user.id,p_policy:p,p_charge:q.charge,p_intent:q.intent});s=await read(admin,executionId,user.id);}
 const frozen=s.execution.policy;if(!frozen||frozen.livemode!==p.livemode)throw conflict();
 if(s.execution.provider_refund_id){checkRefund(await stripe.refunds.retrieve(s.execution.provider_refund_id),s,p.livemode);return Response.json(result(await read(admin,executionId,user.id)),{status:202,headers:PAYMENT_HEADERS});}
 const age=Date.now()-Date.parse(s.execution.created_at);if(!Number.isFinite(age)||age< -30000)throw unavailable();
 if(age>=23*3600000){
  let after:string|undefined;const found:any[]=[];let complete=false;
  for(let page=0;page<5;page++){const list=await stripe.refunds.list({charge:s.execution.charge_id!,limit:100,...(after?{starting_after:after}:{})});if(!list||!Array.isArray(list.data))throw unavailable();for(const r of list.data)if(r.metadata?.platform_refund_execution_id===executionId)found.push(checkRefund(r,s,p.livemode));if(!list.has_more){complete=true;break;}after=list.data.at(-1)?.id;if(!after)throw unavailable();}
  if(!complete||found.length!==1){await rpc(admin,'bind_refund_execution',{p_id:executionId,p_actor:user.id,p_refund:null,p_state:'needs_review'});throw conflict();}
  await rpc(admin,'bind_refund_execution',{p_id:executionId,p_actor:user.id,p_refund:found[0].id,p_state:'submitted'});return Response.json(result(await read(admin,executionId,user.id)),{status:202,headers:PAYMENT_HEADERS});
 }
 // Re-check JWT scope after all provider awaits; durable unknown is set before mutation.
 await rpc(db,'authorize_refund_execution',{p_id:executionId});
 if(Date.now()-Date.parse(s.execution.created_at)>=23*3600000)throw conflict();
 const refund=checkRefund(await stripe.refunds.create({charge:s.execution.charge_id!,amount:s.request.amount_cents,reverse_transfer:frozen.reverse_transfer,refund_application_fee:frozen.refund_application_fee,metadata:meta(s)},{idempotencyKey:`platform-refund:${executionId}`}),s,p.livemode);
 await rpc(admin,'bind_refund_execution',{p_id:executionId,p_actor:user.id,p_refund:refund.id,p_state:'submitted'});
 return Response.json(result(await read(admin,executionId,user.id)),{status:202,headers:PAYMENT_HEADERS});
 }catch(e){return failure(e);}}
export async function refundExecutionStatus(request:Request,context:{params:Promise<{id:string}>}){try{const{db}=await authenticatedClient(),{id}=await context.params;if(!uuid.safeParse(id).success)throw new ApiError(404,'Demande introuvable.');if(new URL(request.url).searchParams.size)throw new ApiError(422,'Paramètres inattendus.');const r=await rpc(db,'read_refund_execution',{p_request:id});const checked=z.object({request_status:z.enum(['requested','approved','rejected','cancelled','settled']),execution_status:execution.shape.state.nullable(),execution_id:uuid.nullable(),eligible:z.boolean(),reason:z.enum(['read_only','approval_required','reconciliation_required','terminal_execution','payment_unconfirmed','legacy_binding_missing','provider_verification_required','operator_mismatch','revision_changed'])}).strict().safeParse(r);if(!checked.success||(checked.data.execution_id===null)!==(checked.data.execution_status===null))throw unavailable();const configured=refundPolicy(env)!==null;const available=configured&&checked.data.eligible;const reason=!configured?'configuration_required':checked.data.reason;return Response.json({...r,available,reason},{headers:PAYMENT_HEADERS});}catch(e){return failure(e);}}
/** Called only AFTER verified raw-body signature and account/livemode checks. */
export async function dispatchRefundEvent(event:any,stripe:ReturnType<typeof stripeClient>,admin:Admin,live:boolean){
 const object=event.data?.object;if(!object||object.object!=='refund'||!/^re_[A-Za-z0-9_]{1,240}$/.test(object.id))throw new ApiError(400,'Référence de remboursement invalide.');
 const id=object.metadata?.platform_refund_execution_id;if(!uuid.safeParse(id).success)throw new ApiError(409,'Remboursement non lié à une exécution plateforme.');
 const s=await read(admin,id,null);if(!s.execution.policy||s.execution.policy.livemode!==live)throw conflict();
 // Current provider state, never event.created ordering; signed snapshot alone may be stale.
 const current=checkRefund(await stripe.refunds.retrieve(object.id),s,live);
 // The signed object must name the SAME immutable financial object and internal binding.
 checkRefund({...object,status:current.status},s,live);
 const out=await rpc(admin,'apply_refund_execution_event',{p_id:id,p_event:event.id,p_type:event.type,p_refund:current.id,p_charge:objectId(current.charge),p_intent:objectId(current.payment_intent),p_amount:current.amount,p_currency:current.currency,p_state:current.status,p_live:live});
 if(!out||typeof out!=='object'||(out as any).state==='needs_review')throw conflict();return out;
}
