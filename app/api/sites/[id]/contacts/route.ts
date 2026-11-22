import { z } from "zod";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { contactCommand, contactRecord } from "@/lib/features/site-contacts/schemas";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const COLUMNS = "id,site_id,first_name,last_name,role_label,phone,email,note,is_primary,version,created_by,created_at,updated_by,updated_at,archived_at";
type Context = { params: Promise<{ id: string }> };
const cursorSchema = z.object({ id: z.uuid(), site_id: z.uuid() }).strict();
function failed(error: unknown) {
 const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
 return Response.json({error:error instanceof ApiError?error.message:status===400?"Le contenu envoyé est invalide.":"Les contacts n’ont pas pu être vérifiés. Réessayez."}, {status,headers:{...HEADERS,...(status===503?{"Retry-After":"2"}:{})}});
}
async function siteId(context: Context) {
 const id=z.uuid().safeParse((await context.params).id); if(!id.success)throw new ApiError(422,"Référence de site invalide.");return id.data;
}
function query(request: Request, site: string) {
 const params=new URL(request.url).searchParams;
 if(request.url.length>2048||[...params.keys()].some(k=>k!=="cursor")||params.getAll("cursor").length>1)throw new ApiError(422,"Paramètres de contacts invalides.");
 const raw=params.get("cursor");if(raw===null)return null;
 try {if(raw.length>180||!/^[-A-Za-z0-9_]+$/.test(raw))throw Error();const decoded=Buffer.from(raw,"base64url");if(decoded.toString("base64url")!==raw)throw Error();const cursor=cursorSchema.parse(JSON.parse(decoded.toString("utf8")));if(cursor.site_id!==site)throw Error();return cursor;}
 catch{throw new ApiError(422,"Le curseur est invalide. Rechargez les contacts.");}
}
export async function GET(request: Request,context: Context) {
 try {
  const {db}=await authenticatedClient(request);const id=await siteId(context),cursor=query(request,id);
  const site=await db.from("sites").select("id").eq("id",id).maybeSingle();dbError(site.error);if(!site.data)throw new ApiError(404,"Ce site est introuvable.");
  const rights=await db.rpc("can_manage_site",{p_site_id:id});dbError(rights.error);if(typeof rights.data!=="boolean")throw new ApiError(503,"Les droits du site n’ont pas pu être vérifiés.");
  let selection=db.from("site_contacts").select(COLUMNS,{count:"exact"}).eq("site_id",id).is("archived_at",null).order("id",{ascending:true}).limit(100);
  if(cursor)selection=selection.gt("id",cursor.id);
  const result=await selection;dbError(result.error);const records=z.array(contactRecord).max(100).parse(result.data);
  if(!Number.isSafeInteger(result.count)||result.count===null||result.count<0||records.length!==Math.min(result.count,100)||records.filter(r=>r.is_primary).length>1||new Set(records.map(r=>r.id)).size!==records.length||records.some((r,i)=>r.site_id!==id||r.archived_at!==null||(cursor&&r.id<=cursor.id)||(i>0&&r.id<=records[i-1].id)))throw new ApiError(503,"La liste des contacts est incomplète. Réessayez.");
  const hasMore=result.count>100,last=records.at(-1);
  const next=hasMore&&last?Buffer.from(JSON.stringify({id:last.id,site_id:id})).toString("base64url"):null;
  return Response.json({records,page:{limit:100,has_more:hasMore,next_cursor:next,remaining_count:result.count,complete:!hasMore&&cursor===null},permissions:{can_write:rights.data}}, {headers:HEADERS});
 }catch(error){return failed(error);}
}
export async function POST(request: Request,context: Context) {
 try {
  assertOrigin(request);const {db}=await authenticatedClient(request);if(new URL(request.url).searchParams.size)throw new ApiError(422,"Paramètres inattendus.");const id=await siteId(context);
  const site=await db.from("sites").select("id").eq("id",id).maybeSingle();dbError(site.error);if(!site.data)throw new ApiError(404,"Ce site est introuvable.");
  const command=await validated(request,contactCommand);
  const result=await db.rpc("write_site_contact",{p_site_id:id,p_id:command.id,p_command_id:command.command_id,p_expected_version:command.expected_version,p_action:command.action,p_values:command.action==="save"?command.values:null});dbError(result.error);
  const record=contactRecord.parse(result.data);
  const version=command.action==="save"&&command.expected_version===null?1:(command.expected_version??0)+1;
  if(record.id!==command.id||record.site_id!==id||record.version!==version||((command.action==="archive")!==(record.archived_at!==null))||(command.action==="save"&&Object.entries(command.values).some(([key,value])=>record[key as keyof typeof record]!==value)))throw new ApiError(503,"L’enregistrement doit être vérifié. Rechargez les contacts avant de réessayer.");
  return Response.json({record},{headers:HEADERS});
 }catch(error){return failed(error);}
}
