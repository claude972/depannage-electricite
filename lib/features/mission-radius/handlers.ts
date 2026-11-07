import {z} from 'zod';
const code=z.string().regex(/^972\d{2}$/),version=z.number().int().min(0).max(2147483647);
export const radiusCommand=z.object({expected_version:version.max(2147483646),reference_code:code.nullable(),radius_km:z.number().int().min(1).max(200).nullable()}).strict().refine(v=>(v.reference_code===null)===(v.radius_km===null));
export const radiusView=z.object({preference:z.object({version,reference_code:code.nullable(),radius_km:z.number().int().min(1).max(200).nullable()}).strict().refine(v=>(v.reference_code===null)===(v.radius_km===null)),options:z.array(z.object({code,name:z.string().min(1).max(160)}).strict()).min(1).max(100),source:z.object({url:z.literal('https://geo.api.gouv.fr/departements/972/communes?fields=nom,code,codesPostaux,centre'),retrieved_at:z.iso.datetime()}).strict(),basis:z.literal('commune_centres'),unknown_postal_policy:z.literal('postal_only')}).strict();
export type RadiusView=z.infer<typeof radiusView>;
interface Db{rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>}
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error{status:number;constructor(status:number){super();this.status=status}}
function fail(status:number):never{throw new Failure(status)}
export function createMissionRadiusHandlers(authenticate:()=>Promise<{db:Db}>){
 async function handle(request:Request,write:boolean){try{
  if(new URL(request.url).searchParams.size)fail(422);
  if(write){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail(403)}
  const {db}=await authenticate();let args:Record<string,unknown>|undefined;
  if(write){let raw:unknown;try{raw=await request.json()}catch{fail(422)}const c=radiusCommand.safeParse(raw);if(!c.success)fail(422);args={p_expected_version:c.data.expected_version,p_reference_code:c.data.reference_code,p_radius_km:c.data.radius_km}}
  const result=await db.rpc(write?'save_artisan_mission_radius':'artisan_mission_radius',args);
  if(result.error){const c=result.error.code;fail(c==='42501'?403:c==='P0001'?409:['22023','23514','23503'].includes(c??'')?422:503)}
  const view=radiusView.safeParse(result.data);if(!view.success)fail(503);
  if(new Set(view.data.options.map(o=>o.code)).size!==view.data.options.length||(view.data.preference.reference_code!==null&&!view.data.options.some(o=>o.code===view.data.preference.reference_code)))fail(503);
  if(write&&(view.data.preference.version!==Number(args!.p_expected_version)+1||view.data.preference.reference_code!==args!.p_reference_code||view.data.preference.radius_km!==args!.p_radius_km))fail(503);
  return Response.json(view.data,{headers});
 }catch(e){const known=e as {status?:number};const status=e instanceof Failure?e.status:known?.status===401?401:503;const messages:Record<number,string>={401:'Connectez-vous à votre compte artisan.',403:'Ce réglage est réservé à votre compte artisan.',409:'Ce réglage a changé. Rechargez-le avant de réessayer.',422:'Choisissez une commune et un rayon entier de 1 à 200 km, ou effacez les deux.',503:'Le rayon indicatif est momentanément indisponible.'};return Response.json({error:messages[status]},{status,headers})}}
 return {GET:(r:Request)=>handle(r,false),POST:(r:Request)=>handle(r,true)};
}
