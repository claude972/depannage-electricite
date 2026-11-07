import {env} from 'node:process';
import {z} from 'zod';
import {ApiError,authenticatedClient,dbError} from '@/lib/supabase/server';
const version=z.number().int().min(1).max(2147483647);
const command=z.object({command_id:z.uuid(),expected_active_version:version,expected_latest_version:version,reason:z.string().trim().min(10).max(1000)}).strict().refine(x=>x.expected_latest_version>x.expected_active_version);
const receipt=z.object({published_version:version,active_version:version,replayed:z.boolean()}).strict();
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'Origine refusée.');
 const{db}=await authenticatedClient();
 if(env.INDICATIVE_PRICE_PUBLICATION_ENABLED!=='true')throw new ApiError(503,'La publication des fourchettes est désactivée.');
 if(new URL(request.url).search)throw new ApiError(422,'Paramètres invalides.');
 const body=await request.text();if(Buffer.byteLength(body)>2048)throw new ApiError(422,'Requête trop longue.');
 let parsed;try{parsed=command.parse(JSON.parse(body))}catch{throw new ApiError(422,'Vérifiez les versions et le motif.');}
 const result=await db.rpc('publish_indicative_prices',{p_command:parsed.command_id,p_expected_active:parsed.expected_active_version,p_expected_latest:parsed.expected_latest_version,p_reason:parsed.reason});dbError(result.error);
 const data=receipt.parse(result.data);if(data.published_version!==parsed.expected_latest_version||data.active_version<data.published_version||(!data.replayed&&data.active_version!==data.published_version))throw Error('Invalid publication receipt');
 return Response.json(data,{headers});
}catch(error){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:'La publication n’a pas pu être vérifiée.'},{status,headers})}}
