import { z } from "zod";
import { authenticatedClient,assertOrigin } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { checkedId,loadGeocode,ok,failed,type Context } from "@/lib/features/tracking/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request,context:Context){try{assertOrigin(request);const {db,user}=await authenticatedClient(request);const id=await checkedId(request,context);const {query}=await validated(request,z.object({query:z.string().trim().min(2).max(200).regex(/^[^\u0000-\u001f]*$/)}).strict());return ok(await loadGeocode(db,user.id,id,query));}catch(error){return failed(error);}}
