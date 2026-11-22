import { env } from "node:process";
import { z } from "zod";
import { authenticatedClient, assertOrigin, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { PAYMENT_HEADERS, checkoutConfigurationAvailable } from "@/lib/features/payments/checkout";
export const dynamic="force-dynamic";
const jobSchema=z.object({id:uuid,client_id:uuid,artisan_id:uuid.nullable(),status:z.string().min(1)}).strict();
export async function GET(request:Request){
 try{
  assertOrigin(request);const{db,user}=await authenticatedClient();const q=new URL(request.url).searchParams;
  if([...q].length!==1||!q.has("intervention_id")||!uuid.safeParse(q.get("intervention_id")).success)throw new ApiError(422,"Référence d’intervention invalide.");
  const id=q.get("intervention_id")!.toLowerCase();const r=await db.from("interventions").select("id,client_id,artisan_id,status").eq("id",id).maybeSingle();dbError(r.error);
  if(!r.data)throw new ApiError(404,"Cette intervention est introuvable.");const p=jobSchema.safeParse(r.data);
  if(!p.success||p.data.id!==id)throw new ApiError(503,"Le lien de suivi n’a pas pu être vérifié. Réessayez.");
  if(p.data.client_id!==user.id){
   if(p.data.artisan_id!==user.id)throw new ApiError(404,"Cette intervention est introuvable.");
   const profile=await db.from("profiles").select("id,role,artisan_approved").eq("id",user.id).maybeSingle();dbError(profile.error);
   if(!profile.data||profile.data.id!==user.id||profile.data.role!=="artisan"||profile.data.artisan_approved!==true)throw new ApiError(404,"Cette intervention est introuvable.");
   const application=await db.from("artisan_profiles").select("application_status").eq("user_id",user.id).maybeSingle();dbError(application.error);
   if(!Object.hasOwn(application,"data")||application.data===undefined||(application.data!==null&&(!application.data||typeof application.data!=="object"||Array.isArray(application.data)||typeof application.data.application_status!=="string")))throw new ApiError(503,"L’état professionnel n’a pas pu être vérifié. Réessayez.");
   if(application.data&&application.data.application_status!=="approved")throw new ApiError(404,"Cette intervention est introuvable.");
  }
  // A relative same-origin URL cannot carry a provider Checkout or bearer bypass.
  // The UI resolves it against window.location.origin before sharing/QR encoding.
  // Existing #detail loginLanding preserves the target, without auto-checkout.
  return Response.json({url:`/#detail/${id}`,available:true,payment_available:false,reason:p.data.status==="paid"?"already_settled":p.data.status!=="completed"?"not_completed":!checkoutConfigurationAvailable(env)?"configuration_required":"checkout_required"},{headers:PAYMENT_HEADERS});
 }catch(e){const status=e instanceof ApiError?e.status:503;return Response.json({error:e instanceof ApiError?e.message:"Le lien de suivi est momentanément indisponible."},{status,headers:{...PAYMENT_HEADERS,...(status===503?{"Retry-After":"2"}:{})}});}
}
