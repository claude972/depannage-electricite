import { TextDecoder } from "node:util";
import { z } from "zod";
import { ApiError, authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
const uuid=z.string().uuid();
const result=z.object({method:z.enum(["on_site","on_site_declared"]),status:z.enum(["due_on_site","declared_received"]),amount_cents:z.number().int().positive().nullable(),currency:z.literal("eur"),can_declare:z.boolean(),available:z.boolean(),reason:z.enum(["artisan_only","artisan_approval_required","not_completed","quote_required","amount_invalid","payment_conflict"]).nullable().optional()}).strict().refine(v=>v.method==="on_site_declared"?v.status==="declared_received"&&v.amount_cents!==null&&!v.can_declare&&!v.available:v.status==="due_on_site");
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
async function readBody(request:Request){if(!request.body)throw new ApiError(422,"Référence invalide.");const reader=request.body.getReader(),bytes=new Uint8Array(4096);let n=0;try{for(;;){const r=await reader.read();if(r.done)break;if(n+r.value.byteLength>bytes.length){await reader.cancel();throw new ApiError(413,"Contenu trop volumineux.");}bytes.set(r.value,n);n+=r.value.byteLength;}}finally{reader.releaseLock();}try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,n)));}catch{throw new ApiError(422,"Référence invalide.");}}
export async function onsiteSettlement(request:Request,declare:boolean){
 try{
  assertOrigin(request);let id:string;
  if(declare){const p=z.object({intervention_id:uuid}).strict().safeParse(await readBody(request));if(!p.success)throw new ApiError(422,"Référence invalide.");id=p.data.intervention_id;}
  else{const q=new URL(request.url).searchParams;if([...q].length!==1||!q.has("intervention_id")||!uuid.safeParse(q.get("intervention_id")).success)throw new ApiError(422,"Référence invalide.");id=q.get("intervention_id")!;}
  const{db}=await authenticatedClient();
  const r=await db.rpc(declare?"declare_onsite_receipt":"onsite_receipt_context",declare?{p_intervention_id:id}:{p_job:id});dbError(r.error);
  const parsed=result.safeParse(r.data);if(!parsed.success||(declare&&parsed.data.status!=="declared_received"))throw new ApiError(503,"Le reçu déclaré doit être vérifié. Réessayez avec le même dossier.");
  const{reason,...rest}=parsed.data;return Response.json({...rest,...(reason?{reason}:{})},{headers});
 }catch(error){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:"Le reçu sur place n’a pas pu être vérifié. Réessayez."},{status,headers:{...headers,...(status===503?{"Retry-After":"2"}:{})}});}
}
