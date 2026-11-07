import {z} from 'zod';
import {authenticatedClient,ApiError,assertOrigin,dbError} from '@/lib/supabase/server';
import {validated} from '@/lib/supabase/validation';
import {addressCommand,addressRecord} from '@/lib/features/client-addresses/schemas';
export const dynamic='force-dynamic';export const runtime='nodejs';
const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const COLUMNS='id,user_id,label,first_name,last_name,address,postal_code,city,country_code,latitude,longitude,geo_source,is_preferred,version,created_at,updated_at,archived_at';
function failed(error:unknown){const status=error instanceof ApiError?error.status:error instanceof SyntaxError?400:503;return Response.json({error:error instanceof ApiError?error.message:status===400?'Le contenu envoyé est invalide.':'Les adresses n’ont pas pu être vérifiées. Réessayez.'},{status,headers:{...HEADERS,...(status===503?{'Retry-After':'2'}:{})}});}
function noQuery(request:Request){if(new URL(request.url).searchParams.size||request.url.length>2048)throw new ApiError(422,'Paramètres d’adresse inattendus.');}
export async function GET(request:Request){try{
 const {db,user}=await authenticatedClient();noQuery(request);
 const result=await db.from('client_addresses').select(COLUMNS,{count:'exact'}).eq('user_id',user.id).is('archived_at',null).order('id',{ascending:true}).limit(50);dbError(result.error);
 const records=z.array(addressRecord).max(50).parse(result.data);
 if(!Number.isSafeInteger(result.count)||result.count===null||result.count<0||result.count>50||records.length!==result.count||new Set(records.map(r=>r.id)).size!==records.length||records.filter(r=>r.is_preferred).length>1||records.some(r=>r.user_id!==user.id||r.archived_at!==null))throw new ApiError(503,'La liste des adresses est incomplète. Réessayez.');
 return Response.json({records,page:{limit:50,count:result.count,complete:true},permissions:{can_write:true}},{headers:HEADERS});
}catch(error){return failed(error);}}
export async function POST(request:Request){try{
 assertOrigin(request);const {db,user}=await authenticatedClient();noQuery(request);const command=await validated(request,addressCommand);
 const result=await db.rpc('write_client_address',{p_id:command.id,p_command_id:command.command_id,p_expected_version:command.expected_version,p_action:command.action,p_values:command.action==='save'?command.values:null});dbError(result.error);const record=addressRecord.parse(result.data);
 const version=command.action==='save'&&command.expected_version===null?1:(command.expected_version??0)+1;
 if(record.id!==command.id||record.user_id!==user.id||record.version!==version||((command.action==='archive')!==(record.archived_at!==null))||(command.action==='save'&&Object.entries(command.values).some(([k,v])=>record[k as keyof typeof record]!==v)))throw new ApiError(503,'L’enregistrement doit être vérifié. Rechargez les adresses avant de réessayer.');
 return Response.json({record},{headers:HEADERS});
}catch(error){return failed(error);}}
