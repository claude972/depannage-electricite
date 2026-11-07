import {z}from 'zod';
import {authenticatedClient,ApiError,assertOrigin,dbError}from '@/lib/supabase/server';
import {validated}from '@/lib/supabase/validation';
import {areaCommand,areaRecord}from '@/lib/features/site-areas/schemas';
export const dynamic='force-dynamic';export const runtime='nodejs';
const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};type Context={params:Promise<{id:string}>};
const cursorSchema=z.object({site_id:z.uuid(),after_id:z.uuid()}).strict();
function failed(e:unknown){const status=e instanceof ApiError?e.status:e instanceof SyntaxError?400:503;return Response.json({error:e instanceof ApiError?e.message:status===400?'Le contenu envoyé est invalide.':'Les zones du site n’ont pas pu être vérifiées. Réessayez.'},{status,headers:{...HEADERS,...(status===503?{'Retry-After':'2'}:{})}});}
async function siteId(context:Context){const p=z.uuid().safeParse((await context.params).id);if(!p.success)throw new ApiError(422,'Référence de site invalide.');return p.data.toLowerCase();}
export async function GET(request:Request,context:Context){try{
 const{db}=await authenticatedClient();const id=await siteId(context),p=new URL(request.url).searchParams;
 if(request.url.length>2048||[...p.keys()].some(k=>k!=='cursor')||p.getAll('cursor').length>1)throw new ApiError(422,'Paramètres de zones invalides.');let after:string|null=null;const raw=p.get('cursor');
 if(raw!==null){try{if(raw.length>180||!/^[-A-Za-z0-9_]+$/.test(raw))throw Error();const b=Buffer.from(raw,'base64url');if(b.toString('base64url')!==raw)throw Error();const c=cursorSchema.parse(JSON.parse(b.toString('utf8')));if(c.site_id!==id)throw Error();after=c.after_id;}catch{throw new ApiError(422,'Le curseur est invalide. Rechargez les zones.');}}
 const result=await db.rpc('site_area_page',{p_site_id:id,p_after_id:after});dbError(result.error);
 const data=z.object({records:z.array(areaRecord).max(100),total:z.number().int().min(0).max(1000),remaining:z.number().int().min(0).max(1000),can_write:z.boolean()}).strict().parse(result.data);
 if(data.remaining>data.total||(!after&&data.remaining!==data.total)||data.records.length!==Math.min(data.remaining,100)||new Set(data.records.map(r=>r.id)).size!==data.records.length||data.records.some((r,i)=>r.site_id!==id||r.archived_at!==null||(after&&r.id<=after)||(i>0&&r.id<=data.records[i-1].id)))throw Error('Invalid areas page');
 const more=data.remaining>100,last=data.records.at(-1);
 return Response.json({records:data.records,page:{limit:100,total:data.total,remaining:data.remaining,has_more:more,next_cursor:more&&last?Buffer.from(JSON.stringify({site_id:id,after_id:last.id})).toString('base64url'):null,complete:!after&&!more},limits:{max_depth:4,max_active:1000},permissions:{can_write:data.can_write}},{headers:HEADERS});
}catch(e){return failed(e);}}
export async function POST(request:Request,context:Context){try{
 assertOrigin(request);const{db}=await authenticatedClient();const id=await siteId(context);if(new URL(request.url).searchParams.size)throw new ApiError(422,'Paramètres inattendus.');const c=await validated(request,areaCommand);
 const result=await db.rpc('write_site_area',{p_site_id:id,p_id:c.id,p_command_id:c.command_id,p_expected_version:c.expected_version,p_action:c.action,p_values:c.action==='save'?c.values:null});dbError(result.error);const record=areaRecord.parse(result.data);
 const version=c.action==='save'&&c.expected_version===null?1:(c.expected_version??0)+1;
 if(record.id!==c.id||record.site_id!==id||record.version!==version||((c.action==='archive')!==(record.archived_at!==null))||(c.action==='save'&&Object.entries(c.values).some(([k,v])=>record[k as keyof typeof record]!==v)))throw Error('Unconfirmed area write');
 return Response.json({record},{headers:HEADERS});
}catch(e){return failed(e);}}
