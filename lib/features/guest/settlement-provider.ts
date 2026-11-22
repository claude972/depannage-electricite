import { env } from "node:process";
import type Stripe from "stripe";
import { ApiError, adminClient, dbError } from "@/lib/supabase/server";
import { stripeClient, commissionBps } from "@/lib/supabase/stripe";
import { guestSettlementConfigured } from "../payments/configuration";
export type Settlement = { id:string; intervention_id:string; actor_id:string; quote_id:string; artisan_id:string; request_id:string; intent_id:string; session_id:string; authorized_max:number; amount_cents:number; account_id:string; fee_bps:number|null; transfer_cents:number|null; status:string; charge_id:string|null; transfer_id:string|null; created_at:string; transfer_started_at:string|null; retired_at?:string|null; generation?:number };
const unknown=()=>new ApiError(503,"Le statut du règlement doit être vérifié. Réessayez avec la même demande.");
const conflict=()=>new ApiError(409,"L’empreinte ou le règlement ne correspond plus au montant accepté. Aucun nouveau paiement n’est lancé.");
export function settlementConfigured() { return guestSettlementConfigured(env); }
export function settlementProvider(){if(!settlementConfigured())throw unknown();return{stripe:stripeClient(),fee:commissionBps(),live:/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY??"")};}
type Provider=ReturnType<typeof settlementProvider>;
const idOf=(v:unknown)=>typeof v==="string"?v:v&&typeof v==="object"&&"id"in v?String(v.id):null;
export async function qualifiedAccount(provider:Provider,account:string,artisan:string){
 if(!/^acct_[A-Za-z0-9]{1,200}$/.test(account))return false;
 const a=await provider.stripe.v2.core.accounts.retrieve(account,{include:["configuration.recipient"]});
 return a.id===account&&a.livemode===provider.live&&a.metadata?.artisan_id===artisan&&a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status==="active";
}
export async function settlementLedger(admin:ReturnType<typeof adminClient>,id:string,actor:string){
 const r=await admin.from("guest_settlements").select("*").eq("id",id).eq("actor_id",actor).maybeSingle();dbError(r.error);
 const l=r.data as Settlement|null;
 if(!l||l.retired_at!=null||l.id!==id||l.actor_id!==actor||!/^pi_[A-Za-z0-9]{1,200}$/.test(l.intent_id)||!Number.isSafeInteger(l.amount_cents)||l.amount_cents<=0||l.amount_cents>l.authorized_max||!Number.isFinite(Date.parse(l.created_at)))throw unknown();
 if(!/^[a-f0-9-]{36}$/i.test(l.quote_id)||!/^[a-f0-9-]{36}$/i.test(l.artisan_id)||!/^[a-f0-9-]{36}$/i.test(l.request_id)||!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,200}$/.test(l.session_id)||!/^acct_[A-Za-z0-9]{1,200}$/.test(l.account_id)||!["processing","captured_transfer_pending","paid","needs_review"].includes(l.status)||(l.fee_bps!==null&&(!Number.isInteger(l.fee_bps)||l.fee_bps<0||l.fee_bps>10000))||(l.transfer_cents!==null&&(!Number.isSafeInteger(l.transfer_cents)||l.transfer_cents<=0||l.transfer_cents>l.amount_cents)))throw unknown();return l;
}
async function paymentProof(p:Provider,l:Settlement){
 const pi=await p.stripe.paymentIntents.retrieve(l.intent_id);
 if(pi.id!==l.intent_id||pi.livemode!==p.live||pi.capture_method!=="manual"||pi.currency!=="eur"||pi.metadata?.booking_actor!==l.actor_id||pi.metadata?.booking_request!==l.request_id||pi.metadata?.booking_method!=="card_hold"||pi.transfer_data!=null||pi.application_fee_amount!=null||pi.on_behalf_of!=null)throw unknown();
 const chargeId=idOf(pi.latest_charge);if(!chargeId||!/^ch_[A-Za-z0-9]{1,200}$/.test(chargeId)||(l.charge_id!==null&&l.charge_id!==chargeId))throw unknown();
 const charge=await p.stripe.charges.retrieve(chargeId);
 if(charge.id!==chargeId||idOf(charge.payment_intent)!==l.intent_id||charge.livemode!==p.live||charge.currency!=="eur"||charge.amount!==l.authorized_max||charge.amount_refunded!==0||charge.refunded!==false||charge.disputed!==false||charge.metadata?.booking_actor!==l.actor_id||charge.metadata?.booking_request!==l.request_id||charge.metadata?.booking_method!=="card_hold")throw unknown();
 return{pi,charge};
}
function captured(l:Settlement,proof:Awaited<ReturnType<typeof paymentProof>>){return proof.pi.status==="succeeded"&&(proof.pi.amount===l.authorized_max||proof.pi.amount===l.amount_cents)&&proof.pi.amount_received===l.amount_cents&&proof.pi.amount_capturable===0&&proof.charge.status==="succeeded"&&proof.charge.captured===true&&proof.charge.paid===true&&proof.charge.amount_captured===l.amount_cents;}
const freshAttempt=(date:string|null)=>!!date&&Number.isFinite(Date.parse(date))&&Date.parse(date)<=Date.now()+30000&&Date.now()-Date.parse(date)<23*3600000;
async function markReview(admin:ReturnType<typeof adminClient>,l:Settlement){const r=await admin.rpc("review_guest_settlement",{p_id:l.id,p_actor:l.actor_id});dbError(r.error);}
function transferProof(t:Stripe.Transfer,l:Settlement,charge:string,p:Provider){
 return t.livemode===p.live&&t.amount===l.transfer_cents&&t.currency==="eur"&&idOf(t.destination)===l.account_id&&idOf(t.source_transaction)===charge&&t.transfer_group===`guest-settlement:${l.id}`&&t.metadata?.settlement_id===l.id&&t.metadata?.actor_id===l.actor_id&&t.amount_reversed===0&&t.reversed===false&&/^tr_[A-Za-z0-9]{1,200}$/.test(t.id);
}
/** Books the commission kept on a paid card-hold settlement in the platform ledger (service-only
 * RPC platform_record_commission_withheld). The amount is the frozen difference between the captured
 * amount and the transfer already proven at the provider; the key is the settlement itself, so a
 * replay writes nothing (the RPC answers false, or « Commission already recorded »). Best effort:
 * the money has already moved, a ledger refusal never turns a confirmed settlement into an error. */
// Écriture de la commission d’un règlement sur place au grand livre : désactivée par défaut. La
// fonction SQL utilisée a été conçue pour des événements du fournisseur ; l’exploitant doit valider
// cet usage (et le libellé de l’écriture) avant d’activer GUEST_SETTLEMENT_LEDGER_COMMISSION_ENABLED.
const LEDGER_COMMISSION_ENABLED=()=>env.GUEST_SETTLEMENT_LEDGER_COMMISSION_ENABLED==="true";
export async function recordSettlementCommission(admin:ReturnType<typeof adminClient>,l:Settlement):Promise<"recorded"|"existing"|"skipped"|"failed">{
 try{
  if(l.status!=="paid"||l.transfer_cents===null||!l.transfer_id||!/^tr_[A-Za-z0-9]{1,200}$/.test(l.transfer_id))return"skipped";
  const fee=l.amount_cents-l.transfer_cents;
  // A zero commission has no ledger entry (the register only holds positive amounts).
  if(!Number.isSafeInteger(fee)||fee<1||fee>=l.amount_cents)return"skipped";
  const pay=await admin.from("payments").select("id,status,session_id,total_cents,currency").eq("quote_id",l.quote_id).maybeSingle();
  const row=pay.data as{id?:unknown;status?:unknown;session_id?:unknown;total_cents?:unknown;currency?:unknown}|null;
  if(pay.error){console.error("guest settlement commission not booked",{settlement:l.id,code:pay.error.code});return"failed";}
  if(!row||typeof row.id!=="string"||row.status!=="paid"||row.session_id!==l.session_id||row.total_cents!==l.amount_cents||row.currency!=="eur")return"skipped";
  const r=await admin.rpc("platform_record_commission_withheld",{p_payment_id:row.id,p_event_id:`guest-settlement-commission:${l.id}`,p_event_type:"guest_settlement.transfer_confirmed",p_session_id:l.session_id,p_provider_reference:l.transfer_id,p_provider_status:"succeeded",p_amount_cents:fee,p_currency:"eur"});
  if(r.error){
   if(r.error.code==="P0001"&&r.error.message==="Commission already recorded")return"existing";
   console.error("guest settlement commission not booked",{settlement:l.id,code:r.error.code});return"failed";
  }
  return r.data===true?"recorded":"existing";
 }catch{console.error("guest settlement commission not booked",{settlement:l.id});return"failed";}
}
export async function executeSettlement(admin:ReturnType<typeof adminClient>,l:Settlement,p:Provider){
 // A settled dossier replays only the (idempotent) commission booking, never a provider call.
 if(l.status==="paid"){if(LEDGER_COMMISSION_ENABLED())await recordSettlementCommission(admin,l);return;}
 if(l.status==="needs_review")return;
 if(!await qualifiedAccount(p,l.account_id,l.artisan_id))throw conflict();
 const q=await admin.rpc("qualify_guest_settlement",{p_id:l.id,p_actor:l.actor_id,p_account:l.account_id,p_fee:l.fee_bps??p.fee});dbError(q.error);l=await settlementLedger(admin,l.id,l.actor_id);
 if(l.transfer_cents===null||l.fee_bps===null)throw unknown();
 let proof=await paymentProof(p,l);
 if(!captured(l,proof)){
  const before=proof.charge.payment_method_details?.card?.capture_before;
  if(proof.pi.status!=="requires_capture"||proof.pi.amount!==l.authorized_max||proof.pi.amount_received!==0||proof.pi.amount_capturable<l.amount_cents||proof.charge.captured||proof.charge.paid!==true||proof.charge.status!=="succeeded"||!Number.isSafeInteger(before)||(before??0)<=Date.now()/1000)throw conflict();
  if(!freshAttempt(l.created_at)){await markReview(admin,l);return;}
  // Stripe finalizes a single capture by default and rejects final_capture without multicapture.
  if(!await qualifiedAccount(p,l.account_id,l.artisan_id))throw conflict();
  const permission=await admin.rpc("authorize_guest_settlement_operation",{p_id:l.id,p_actor:l.actor_id,p_phase:"capture"});dbError(permission.error);
  if(!freshAttempt(l.created_at))throw conflict();
  await p.stripe.paymentIntents.capture(l.intent_id,{amount_to_capture:l.amount_cents},{idempotencyKey:`guest-capture:${l.id}`});
  proof=await paymentProof(p,l);if(!captured(l,proof))throw unknown();
 }
 const recorded=await admin.rpc("record_guest_settlement",{p_id:l.id,p_actor:l.actor_id,p_charge:proof.charge.id,p_amount:l.amount_cents});dbError(recorded.error);l=await settlementLedger(admin,l.id,l.actor_id);
 const listed=await p.stripe.transfers.list({transfer_group:`guest-settlement:${l.id}`,limit:2});
 if(!listed||typeof listed!=="object"||Array.isArray(listed)||listed.object!=="list"||typeof listed.has_more!=="boolean"||!Array.isArray(listed.data)||listed.has_more||listed.data.length>1||listed.data.some(t=>!t||typeof t!=="object"||Array.isArray(t)||!transferProof(t,l,proof.charge.id,p)))throw unknown();
 let transfer=listed.data[0];
 if(!transfer){
  if(!freshAttempt(l.transfer_started_at)){await markReview(admin,l);return;}
  if(!await qualifiedAccount(p,l.account_id,l.artisan_id))throw conflict();
  const permission=await admin.rpc("authorize_guest_settlement_operation",{p_id:l.id,p_actor:l.actor_id,p_phase:"transfer"});dbError(permission.error);
  if(!freshAttempt(l.transfer_started_at))throw conflict();
  transfer=await p.stripe.transfers.create({amount:l.transfer_cents!,currency:"eur",destination:l.account_id,source_transaction:proof.charge.id,transfer_group:`guest-settlement:${l.id}`,metadata:{settlement_id:l.id,actor_id:l.actor_id}},{idempotencyKey:`guest-transfer:${l.id}`});
 }
 // Retrieve the current object independently even after a successful create response.
 transfer=await p.stripe.transfers.retrieve(transfer.id);
 if(!transferProof(transfer,l,proof.charge.id,p))throw unknown();
 if(!await qualifiedAccount(p,l.account_id,l.artisan_id)){await markReview(admin,l);return;}
 const final=await admin.rpc("record_guest_settlement",{p_id:l.id,p_actor:l.actor_id,p_charge:proof.charge.id,p_amount:l.amount_cents,p_transfer:transfer.id,p_net:transfer.amount,p_account:l.account_id});dbError(final.error);
 if(LEDGER_COMMISSION_ENABLED())await recordSettlementCommission(admin,{...l,status:"paid",transfer_id:transfer.id});
}

export async function settlementReady(p:Provider,source:Record<string,unknown>){
 const l={...source,charge_id:null} as unknown as Settlement;
 const proof=await paymentProof(p,l);if(captured(l,proof))return true;
 const expiry=proof.charge.payment_method_details?.card?.capture_before;
 return proof.pi.status==='requires_capture'&&proof.pi.amount===l.authorized_max&&proof.pi.amount_received===0&&proof.pi.amount_capturable>=l.amount_cents&&!proof.charge.captured&&proof.charge.paid===true&&proof.charge.status==="succeeded"&&Number.isSafeInteger(expiry)&&(expiry??0)>Date.now()/1000;
}
