import {createHash} from 'node:crypto';
import {authenticatedClient,adminClient,ApiError} from '@/lib/supabase/server';
import {createPhotoReviewHandlers} from '@/lib/features/photo-triage/handlers';
import {DOCUMENT_BUCKET} from '@/lib/shared/document-policy';
export const runtime='nodejs';export const dynamic='force-dynamic';
const handlers=createPhotoReviewHandlers({authenticate:async()=>{
 const {db,user}=await authenticatedClient();const {data,error}=await db.auth.getSession();
 if(error||!data.session?.access_token)throw new ApiError(401,'Session indisponible.');
 return {db,userId:user.id,sessionKey:createHash('sha256').update(data.session.access_token).digest('hex'),download:async(path:string)=>{const r=await db.storage.from(DOCUMENT_BUCKET).download(path);if(r.error||!r.data)throw new ApiError(403,'Photo indisponible.');return r.data}};
},admin:adminClient,env:()=>process.env,fetcher:(...args)=>fetch(...args)});
type Context={params:Promise<{id:string}>};
export const GET=async(r:Request,c:Context)=>handlers.GET(r,(await c.params).id);
export const POST=async(r:Request,c:Context)=>handlers.POST(r,(await c.params).id);
