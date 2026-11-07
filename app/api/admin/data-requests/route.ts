import {authenticatedClient,apiError,dbError,ApiError} from '@/lib/supabase/server';
import {checkedPage,privateHeaders} from '@/lib/features/data-requests/contracts';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const {db}=await authenticatedClient(),query=new URL(request.url).searchParams;
 for(const key of query.keys())if(!['after','limit'].includes(key)||query.getAll(key).length!==1)throw new ApiError(422,'Paramètres invalides.');
 const after=z.uuid().nullable().safeParse(query.get('after')),limit=z.coerce.number().int().min(1).max(100).safeParse(query.get('limit')??25);
 if(!after.success||!limit.success)throw new ApiError(422,'Paramètres invalides.');
 const result=await db.rpc('list_data_erasure_requests',{p_all:true,p_after:after.data,p_limit:limit.data});dbError(result.error);
 return Response.json(checkedPage(result.data,after.data),{headers:privateHeaders});
}catch(e){const r=apiError(e);for(const [k,v]of Object.entries(privateHeaders))r.headers.set(k,v);return r}}
