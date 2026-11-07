import {z}from 'zod';
import {authenticatedClient,ApiError,dbError}from '@/lib/supabase/server';
import {buildOrganizationSla}from '@/lib/features/organization-sla/report';
export const dynamic='force-dynamic';export const runtime='nodejs';
const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};type Context={params:Promise<{id:string}>};
const cursorSchema=z.object({organization_id:z.uuid(),after_site_id:z.uuid()}).strict();
export async function GET(request:Request,context:Context){try{
 const{db}=await authenticatedClient();const parsed=z.uuid().safeParse((await context.params).id);if(!parsed.success)throw new ApiError(422,'Référence d’organisation invalide.');const id=parsed.data.toLowerCase();
 const params=new URL(request.url).searchParams;if(request.url.length>2048||[...params.keys()].some(k=>k!=='cursor')||params.getAll('cursor').length>1)throw new ApiError(422,'Paramètres SLA invalides.');let after:string|null=null;const raw=params.get('cursor');
 if(raw!==null){try{if(raw.length>200||!/^[-A-Za-z0-9_]+$/.test(raw))throw Error();const decoded=Buffer.from(raw,'base64url');if(decoded.toString('base64url')!==raw)throw Error();const c=cursorSchema.parse(JSON.parse(decoded.toString('utf8')));if(c.organization_id!==id)throw Error();after=c.after_site_id;}catch{throw new ApiError(422,'Le curseur est invalide. Rechargez le rapport.');}}
 const result=await db.rpc('organization_sla_snapshot',{p_organization_id:id,p_after_site_id:after});dbError(result.error);return Response.json(buildOrganizationSla(result.data,id,after),{headers:HEADERS});
}catch(error){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:'Le rapport SLA n’a pas pu être vérifié. Réessayez.'},{status,headers:{...HEADERS,...(status===503?{'Retry-After':'2'}:{})}});}}
