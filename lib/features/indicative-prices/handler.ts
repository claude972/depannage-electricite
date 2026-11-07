import {env} from 'node:process';
import {z} from 'zod';
import {ApiError,authenticatedClient,serverClient,dbError} from '@/lib/supabase/server';
const version=z.number().int().min(1).max(2147483647);
const amount=z.number().int().min(1).max(2147483647);
const range=z.object({min_cents:amount,max_cents:amount}).strict().refine(x=>x.max_cents>=x.min_cents);
const ranges=z.object({outage:range,panel:range,socket:range,lighting:range,diagnostic:range}).strict();
const publicView=z.object({version,currency:z.literal('eur'),ranges,indicative:z.literal(true),publication_available:z.literal(false),source:z.enum(['existing_baseline','operator_version'])}).strict().refine(x=>(x.version===1)===(x.source==='existing_baseline'));
const stageView=z.object({active:publicView,latest_version:version,staged:z.object({version,ranges,reason:z.string().min(10).max(1000),created_at:z.iso.datetime({offset:true})}).strict().nullable(),publication_available:z.boolean()}).strict();
const command=z.object({action:z.literal('stage'),command_id:z.uuid(),expected_version:version,ranges,reason:z.string().trim().min(10).max(1000)}).strict();
const receipt=z.object({version,replayed:z.boolean(),publication_available:z.literal(false),active_version:version}).strict();
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function failure(error:unknown){const status=error instanceof ApiError?error.status:503;return Response.json({error:error instanceof ApiError?error.message:'Les fourchettes n’ont pas pu être vérifiées. Réessayez.'},{status,headers})}
function noQuery(request:Request){if(new URL(request.url).search)throw new ApiError(422,'Paramètres invalides.')}
export async function publicGET(request:Request){try{noQuery(request);const db=await serverClient();const result=await db.rpc('read_indicative_prices');dbError(result.error);return Response.json(publicView.parse(result.data),{headers})}catch(error){return failure(error)}}
export async function adminGET(request:Request){try{noQuery(request);const{db}=await authenticatedClient();const result=await db.rpc('read_indicative_price_staging');dbError(result.error);const data=stageView.parse(result.data);if((data.latest_version===data.active.version)!==(data.staged===null)||data.latest_version<data.active.version||data.staged&&data.staged.version!==data.latest_version)throw Error('Invalid staged version');return Response.json({...data,publication_available:data.publication_available&&env.INDICATIVE_PRICE_PUBLICATION_ENABLED==='true'},{headers})}catch(error){return failure(error)}}
export async function adminPOST(request:Request){try{
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'Origine refusée.');noQuery(request);
 const{db}=await authenticatedClient();const body=await request.text();if(Buffer.byteLength(body)>4096)throw new ApiError(422,'Requête trop longue.');
 let parsed;try{parsed=command.parse(JSON.parse(body))}catch{throw new ApiError(422,'Vérifiez les cinq fourchettes et le motif.');}
 const result=await db.rpc('stage_indicative_prices',{p_command:parsed.command_id,p_expected_version:parsed.expected_version,p_ranges:parsed.ranges,p_reason:parsed.reason});dbError(result.error);
 const data=receipt.parse(result.data);if(data.version!==parsed.expected_version+1)throw Error('Invalid version');return Response.json(data,{headers});
}catch(error){return failure(error)}}
