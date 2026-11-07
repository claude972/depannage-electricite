import { TextDecoder } from "node:util";
import { z } from "zod";
import { ApiError, authenticatedClient, adminClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { settlementConfigured, settlementProvider, qualifiedAccount, settlementLedger, executeSettlement, settlementReady } from "./settlement-provider";
const uuid=z.string().uuid();
const dto=z.object({method:z.literal("card_hold"),status:z.enum(["not_started","processing","captured_transfer_pending","paid","needs_review"]),amount_cents:z.number().int().positive().nullable(),currency:z.literal("eur"),available:z.boolean(),reason:z.enum(["not_completed","quote_required","artisan_incomplete","quote_exceeds_hold","configuration_required","authorization_missing","authorization_unavailable","reauthorization_pending","settled","manual_review"]).nullable()}).strict();
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
const unknown=()=>new ApiError(503,"Le règlement doit être vérifié. Réessayez avec la même demande.");
async function body(request:Request){if(!request.body)throw new ApiError(422,"Référence invalide.");const reader=request.body.getReader();const bytes=new Uint8Array(4096);let size=0;try{for(;;){const r=await reader.read();if(r.done)break;if(size+r.value.length>bytes.length){await reader.cancel();throw new ApiError(413,"Contenu trop volumineux.");}bytes.set(r.value,size);size+=r.value.length;}}finally{reader.releaseLock();}try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,size)));}catch{throw new ApiError(422,"Référence invalide.");}}
export async function settlementRoute(request:Request,capture:boolean){
 try{
  assertOrigin(request);let id:string;
  if(capture){const parsed=z.object({intervention_id:uuid}).strict().safeParse(await body(request));if(!parsed.success)throw new ApiError(422,"Référence invalide.");id=parsed.data.intervention_id;}
  else{const q=new URL(request.url).searchParams;if([...q].length!==1||!q.has("intervention_id")||!uuid.safeParse(q.get("intervention_id")).success)throw new ApiError(422,"Référence invalide.");id=q.get("intervention_id")!;}
  const{db,user}=await authenticatedClient();
  const read=async()=>{const r=await db.rpc("guest_settlement_status",{p_intervention_id:id});dbError(r.error);const p=dto.safeParse(r.data);if(!p.success)throw unknown();return p.data;};
  let status=await read();
  if(!settlementConfigured()){
   if(capture&&status.status!=="paid")throw new ApiError(503,"Le règlement par empreinte n’est pas encore configuré.");
   const{reason:_reason,...rest}=status;return Response.json({...rest,available:false,reason:"configuration_required"},{headers});
  }
  if(capture&&status.status!=="paid"){
   if(!status.available)throw new ApiError(409,"Le dossier, ses avenants ou son empreinte ne permettent pas ce règlement.");
   const p=settlementProvider(); // configuration/fee validated BEFORE ledger mutation
   if(status.amount_cents===null||status.amount_cents-Math.round(status.amount_cents*p.fee/10000)<=0)throw new ApiError(503,"La commission doit permettre un versement positif avant règlement.");
   const admin=adminClient();
   const source=await admin.rpc("guest_settlement_source",{p_job:id,p_actor:user.id});dbError(source.error);
   const s=source.data;if(!s||s.actor_id!==user.id||s.intervention_id!==id||typeof s.account_id!=="string"||typeof s.artisan_id!=="string")throw unknown();
   if(!await qualifiedAccount(p,s.account_id,s.artisan_id))throw new ApiError(409,"Le compte de règlement de l’artisan doit être validé avant capture.");
   const begun=await db.rpc("begin_guest_settlement",{p_intervention_id:id});dbError(begun.error);
   if(!uuid.safeParse(begun.data).success)throw unknown();
   const ledger=await settlementLedger(admin,begun.data,user.id);
   await executeSettlement(admin,ledger,p);status=await read();
  }
  if(!capture&&status.available){
   const p=settlementProvider();const admin=adminClient(),source=await admin.rpc("guest_settlement_source",{p_job:id,p_actor:user.id});dbError(source.error);
   const s=source.data;if(!s||s.actor_id!==user.id||s.intervention_id!==id||typeof s.account_id!=="string"||typeof s.artisan_id!=="string")throw unknown();
   if(status.amount_cents===null||status.amount_cents-Math.round(status.amount_cents*p.fee/10000)<=0)status={...status,available:false,reason:"configuration_required"};
   else if(!await qualifiedAccount(p,s.account_id,s.artisan_id))status={...status,available:false,reason:"artisan_incomplete"};
   else if(!await settlementReady(p,s))status={...status,available:false,reason:"authorization_unavailable"};
  }
  const{reason,...rest}=status;return Response.json({...rest,...(reason?{reason}:{})},{headers});
 }catch(error){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:"Le statut du règlement doit être vérifié. Réessayez."},{status,headers:{...headers,...(status===503?{"Retry-After":"2"}:{})}});}
}
