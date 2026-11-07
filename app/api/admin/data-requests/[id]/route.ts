import {z} from 'zod';
import {authenticatedClient,apiError,dbError,ApiError,assertOrigin} from '@/lib/supabase/server';
import {validated} from '@/lib/supabase/validation';
import {requestSchema,checked,publicRequest,privateHeaders} from '@/lib/features/data-requests/contracts';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
const decision=z.object({command_id:z.uuid(),expected_version:z.number().int().min(1).max(100),state:z.enum(['in_review','needs_information','approved','rejected']),reason:z.string().trim().min(1).max(1000)}).strict();
const history=z.array(z.object({id:z.uuid(),actor_id:z.uuid(),from_state:requestSchema.shape.state.nullable(),to_state:requestSchema.shape.state,reason:z.string().nullable(),version:z.number().int().positive(),created_at:z.string()})).max(100);
async function idOf(request:Request,ctx:Context){const id=z.uuid().safeParse((await ctx.params).id);if(!id.success||new URL(request.url).searchParams.size)throw new ApiError(422,'Demande invalide.');return id.data}
function failed(e:unknown){const r=apiError(e);for(const[k,v]of Object.entries(privateHeaders))r.headers.set(k,v);return r}
export async function GET(request:Request,ctx:Context){try{
 const {db}=await authenticatedClient(),id=await idOf(request,ctx),result=await db.rpc('get_data_erasure_review',{p_id:id});dbError(result.error);
 const receipt=checked(z.object({request:requestSchema,history,can_decide:z.boolean()}),result.data);if(receipt.request.id!==id)throw new ApiError(503,'Demande à vérifier.');
 return Response.json({...receipt,request:publicRequest(receipt.request)},{headers:privateHeaders});
}catch(e){return failed(e)}}
export async function POST(request:Request,ctx:Context){try{
 assertOrigin(request);const {db}=await authenticatedClient(),id=await idOf(request,ctx),input=await validated(request,decision);
 const result=await db.rpc('decide_data_erasure_request',{p_id:id,p_command:input.command_id,p_expected_version:input.expected_version,p_state:input.state,p_reason:input.reason});dbError(result.error);
 const receipt=checked(z.object({request:requestSchema,replayed:z.boolean()}),result.data);if(receipt.request.id!==id)throw new ApiError(503,'Demande à vérifier.');
 return Response.json({...receipt,request:publicRequest(receipt.request)},{headers:privateHeaders});
}catch(e){return failed(e)}}
