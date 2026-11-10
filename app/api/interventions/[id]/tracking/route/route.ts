import { z } from "zod";
import { authenticatedClient,assertOrigin } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { checkedId,loadRoute,ok,failed,type Context } from "@/lib/features/tracking/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request,context:Context){try{assertOrigin(request);const {db,user}=await authenticatedClient(request);const id=await checkedId(request,context);await validated(request,z.object({}).strict());return ok(await loadRoute(db,user.id,id));}catch(error){return failed(error);}}
