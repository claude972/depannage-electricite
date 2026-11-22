import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { commandSchema } from "@/lib/features/tracking/state";
import { checkedId,snapshot,parseSnapshot,ok,failed,type Context } from "@/lib/features/tracking/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request,context:Context){try{const {db}=await authenticatedClient(request);const id=await checkedId(request,context);return ok(await snapshot(db,id));}catch(error){return failed(error);}}
export async function POST(request:Request,context:Context){try{assertOrigin(request);const {db}=await authenticatedClient(request);const id=await checkedId(request,context);const data=await validated(request,commandSchema);const result=await db.rpc('tracking_command',{p_id:id,p_action:data.action,p_expected_version:data.expected_version,p_payload:data.payload});dbError(result.error);return ok(parseSnapshot(result.data,id));}catch(error){return failed(error);}}
