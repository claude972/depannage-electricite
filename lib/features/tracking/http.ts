import { z } from "zod";
import { ApiError, apiError, adminClient, authenticatedClient, dbError } from "@/lib/supabase/server";
import { uuid,snapshotSchema,pointFresh,trackingKey,TrackingCache } from "./state";
import { TrackingProviderError,providerJson,parseRoute,parseGeocode,routeUrl,geocodeUrl } from "./provider";
import type { TrackingSnapshot,TrackingRoute,GeocodeCandidates } from "./types";
export type Database=Awaited<ReturnType<typeof authenticatedClient>>['db'];
export type Context={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
export function ok(value:unknown){return Response.json(value,{headers});}
export function failed(error:unknown){const response=error instanceof TrackingProviderError?Response.json({error:'Le calcul géographique est indisponible. Réessayez dans quelques instants.',reason:error.reason,...(error.retryAfter?{retry_after_s:error.retryAfter}:{})},{status:503,headers:{...headers,...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}}):error instanceof TrackingStateError?Response.json({error:error.message,reason:error.reason,...(error.retryAfter?{retry_after_s:error.retryAfter}:{})},{status:error.status,headers:{...headers,...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}}):apiError(error);response.headers.set('Cache-Control','private, no-store');if(response.status===429&&!response.headers.has('Retry-After'))response.headers.set('Retry-After','5');return response;}
export class TrackingStateError extends ApiError{constructor(status:number,public reason:string,message:string,public retryAfter=0){super(status,message);}}
export async function checkedId(request:Request,context:Context){const {id}=await context.params;if(!uuid.safeParse(id).success||new URL(request.url).searchParams.size)throw new ApiError(422,'Vérifiez la demande de suivi.');return id;}
export async function snapshot(db:Database,id:string):Promise<TrackingSnapshot>{const result=await db.rpc('tracking_snapshot',{p_id:id});if(result.error?.code==='42501')throw new ApiError(404,'Ce suivi est introuvable.');dbError(result.error);const parsed=snapshotSchema.safeParse(result.data);if(!parsed.success||parsed.data.tracking.intervention_id!==id)throw new ApiError(503,'Le suivi n’a pas été confirmé.');return parsed.data;}
export function parseSnapshot(value:unknown,id:string):TrackingSnapshot{const parsed=snapshotSchema.safeParse(value);if(!parsed.success||parsed.data.tracking.intervention_id!==id)throw new ApiError(503,'Le suivi n’a pas été confirmé.');return parsed.data;}
function requireRoute(s:TrackingSnapshot){if(!pointFresh(s))throw new TrackingStateError(503,'position_unavailable','Aucune position récente partagée.');if(!s.tracking.destination)throw new TrackingStateError(503,'destination_required','Confirmez le point de destination.');}
const routeCache=new TrackingCache<TrackingRoute>(),geocodeCache=new TrackingCache<GeocodeCandidates>();
async function claim(id:string,operation:'route'|'geocode',key:string){let admin:ReturnType<typeof adminClient>;try{admin=adminClient();}catch{throw new TrackingStateError(503,'server_configuration','Le calcul géographique est en cours de configuration.');}const result=await admin.rpc('claim_tracking_provider',{p_intervention_id:id,p_operation:operation,p_key:key});dbError(result.error);const parsed=z.object({allowed:z.boolean(),retry_after_s:z.number().int().min(0).max(60)}).strict().safeParse(result.data);if(!parsed.success||(!parsed.data.allowed&&parsed.data.retry_after_s<1)||(parsed.success&&parsed.data.allowed&&parsed.data.retry_after_s!==0))throw new ApiError(503,'Le quota géographique est indisponible.');if(!parsed.data.allowed)throw new TrackingStateError(429,'application_quota','Patientez avant un nouveau calcul.',parsed.data.retry_after_s);return admin;}
async function external<T>(admin:ReturnType<typeof adminClient>,url:URL,parse:(value:unknown)=>T):Promise<T>{try{return parse(await providerJson(url));}catch(error){if(error instanceof TrackingProviderError&&error.reason==='provider_quota'){const r=await admin.rpc('tracking_provider_backoff',{p_delay_seconds:error.retryAfter||30});dbError(r.error);}throw error;}}
export async function loadRoute(db:Database,userId:string,id:string){
 const before=await snapshot(db,id);requireRoute(before);const key=trackingKey(before,userId,'route');let result=routeCache.get(key);let created=false;
 if(!result){const admin=await claim(id,'route',key);result=await external(admin,routeUrl(before),v=>parseRoute(v,before));created=true;}
 // After every await (including a cache hit's rights lookup), re-read live JWT permissions and context.
 const after=await snapshot(db,id);if(trackingKey(before,userId,'route')!==trackingKey(after,userId,'route'))throw new TrackingStateError(409,'tracking_changed','Le suivi a changé pendant le calcul. Rechargez-le.');requireRoute(after);
 if(created)routeCache.set(key,result);return result;
}
export async function loadGeocode(db:Database,userId:string,id:string,query:string){
 const before=await snapshot(db,id);if(!before.permissions.can_confirm_destination)throw new ApiError(403,'Vous ne pouvez pas confirmer la destination.');
 const key=trackingKey(before,userId,'geocode',query);let result=geocodeCache.get(key);let created=false;
 if(!result){const admin=await claim(id,'geocode',key);result=await external(admin,geocodeUrl(query),parseGeocode);created=true;}
 const after=await snapshot(db,id);if(!after.permissions.can_confirm_destination)throw new ApiError(403,'Votre droit de confirmer la destination a changé.');
 if(before.tracking.intervention_id!==after.tracking.intervention_id || before.tracking.destination_version!==after.tracking.destination_version)throw new TrackingStateError(409,'tracking_changed','La destination a changé pendant la recherche.');
 if(created)geocodeCache.set(key,result);return result;
}
