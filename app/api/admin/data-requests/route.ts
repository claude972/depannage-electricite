import {adminClient,authenticatedClient,apiError,dbError,ApiError} from '@/lib/supabase/server';
import {readExecutions} from '@/lib/features/data-requests/erasure-execution';
import {checkedPage,privateHeaders} from '@/lib/features/data-requests/contracts';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {db}=await authenticatedClient(),query=new URL(request.url).searchParams;
 for(const key of query.keys())if(!['after','limit'].includes(key)||query.getAll(key).length!==1)throw new ApiError(422,'Paramètres invalides.');
 const after=z.uuid().nullable().safeParse(query.get('after')),limit=z.coerce.number().int().min(1).max(100).safeParse(query.get('limit')??25);
 if(!after.success||!limit.success)throw new ApiError(422,'Paramètres invalides.');
 const result=await db.rpc('list_data_erasure_requests',{p_all:true,p_after:after.data,p_limit:limit.data});dbError(result.error);
 const page=checkedPage(result.data,after.data);
 // SYS-09: requests whose erasure has been executed (recorded in the platform journal). Read after the
 // scope check done by the list command above; when the journal cannot be read the key is omitted and
 // the screen says that the execution state is unknown rather than « non commencé ».
 let executions:Record<string,string>|undefined;
 try{const found=await readExecutions(adminClient(),page.rows.map(row=>row.ticket_id));executions=Object.fromEntries([...found].map(([id,e])=>[id,e.executed_at]))}catch{executions=undefined}
 return Response.json({...page,...(executions?{executions}:{})},{headers:privateHeaders});
}catch(e){const r=apiError(e);for(const [k,v]of Object.entries(privateHeaders))r.headers.set(k,v);return r}}
