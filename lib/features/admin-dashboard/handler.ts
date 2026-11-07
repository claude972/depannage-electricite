import {z} from 'zod';
import {ApiError,authenticatedClient,dbError} from '@/lib/supabase/server';
import {comparePostgresTime} from '@/lib/shared/postgres-time-order';
const uuid=z.uuid(),time=z.iso.datetime({offset:true}),count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const active=z.object({id:uuid,artisan_id:uuid.nullable(),category:z.enum(['outage','panel','socket','lighting','diagnostic']),city:z.string(),urgency:z.enum(['urgent','scheduled']),status:z.enum(['requested','assigned','quoted','accepted','in_progress','completed']),created_at:time}).strict();
const pending=z.object({id:uuid,full_name:z.string(),company_name:z.string(),application_status:z.literal('submitted'),account_created_at:time}).strict();
const snapshot=z.object({counts:z.object({interventions:count,active_interventions:count,pending_applications:count}).strict(),active:z.array(active).max(6),pending:z.array(pending).max(6),limit:z.literal(6),captured_at:time}).strict();
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function ordered(rows:{id:string;at:string}[]){let previous:{id:string;at:string}|null=null;const seen=new Set<string>();for(const row of rows){if(seen.has(row.id))throw Error('Duplicate row');seen.add(row.id);if(previous){const order=comparePostgresTime(previous.at,row.at);if(order<0||(order===0&&previous.id>=row.id))throw Error('Invalid order')}previous=row}}
export async function GET(request:Request){try{
 const{db}=await authenticatedClient();
 if(new URL(request.url).search)throw new ApiError(422,'Paramètres invalides.');
 const result=await db.rpc('admin_dashboard_snapshot');dbError(result.error);
 const data=snapshot.parse(result.data);
 if(data.counts.active_interventions>data.counts.interventions||data.active.length!==Math.min(6,data.counts.active_interventions)||data.pending.length>data.counts.pending_applications)throw Error('Invalid counts');
 ordered(data.active.map(x=>({id:x.id,at:x.created_at})));ordered(data.pending.map(x=>({id:x.id,at:x.account_created_at})));
 return Response.json(data,{headers});
}catch(error){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:'Le tableau de bord n’a pas pu être vérifié. Réessayez.'},{status,headers:{...headers,...(status===503?{'Retry-After':'2'}:{})}})}}
