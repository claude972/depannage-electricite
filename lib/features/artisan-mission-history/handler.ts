import{z}from'zod';
import{authenticatedClient,ApiError,dbError}from'@/lib/supabase/server';
const uuid=z.uuid().transform(x=>x.toLowerCase());
const timestamp=z.iso.datetime({offset:true}).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const filter=z.enum(['active','done']);
const cursorSchema=z.object({v:z.literal(1),actor_id:uuid,filter,created_at:timestamp,id:uuid}).strict();
const item=z.object({id:uuid,category:z.enum(['outage','panel','socket','lighting','diagnostic']),address:z.string().min(5).max(500),city:z.string().min(2).max(120),urgency:z.enum(['urgent','scheduled']),status:z.enum(['assigned','quoted','accepted','in_progress','completed','paid']),created_at:timestamp,completed_at:timestamp.nullable(),paid_at:timestamp.nullable()});
const snapshot=z.object({items:z.array(item).max(51),captured_at:timestamp});
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
// Preserve Postgres microseconds, including when timestamp offsets differ.
function micros(value:string){return BigInt(Date.parse(value))*1000n+BigInt((value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??'').slice(3).padEnd(3,'0'))}
function older(a:{created_at:string;id:string},b:{created_at:string;id:string}){const aa=micros(a.created_at),bb=micros(b.created_at);return aa<bb||(aa===bb&&a.id<b.id)}
export async function GET(request:Request){try{
 const{db,user}=await authenticatedClient(),query=new URL(request.url).searchParams;
 if(request.url.length>2048||[...query.keys()].some(k=>!['filter','cursor'].includes(k)||query.getAll(k).length!==1))throw new ApiError(422,'Paramètres invalides.');
 const selected=filter.safeParse(query.get('filter')??'active');if(!selected.success)throw new ApiError(422,'Filtre invalide.');
 let cursor:z.infer<typeof cursorSchema>|null=null;
 if(query.has('cursor')){try{const raw=query.get('cursor')!;if(!/^[A-Za-z0-9_-]{1,600}$/.test(raw))throw Error();const bytes=Buffer.from(raw,'base64url');if(bytes.toString('base64url')!==raw)throw Error();cursor=cursorSchema.parse(JSON.parse(bytes.toString('utf8')));if(cursor.actor_id!==user.id.toLowerCase()||cursor.filter!==selected.data)throw Error()}catch{throw new ApiError(422,'Curseur invalide. Rechargez les missions.')}}
 const result=await db.rpc('artisan_mission_history_page',{p_filter:selected.data,p_before_at:cursor?.created_at??null,p_before_id:cursor?.id??null});dbError(result.error);
 const data=snapshot.parse(result.data);let previous:{created_at:string;id:string}|null=cursor;const seen=new Set<string>();
 for(const row of data.items){if((selected.data==='active'?['completed','paid'].includes(row.status):!['completed','paid'].includes(row.status))||seen.has(row.id)||(previous&&!older(row,previous)))throw Error('Invalid history');seen.add(row.id);previous=row}
 const items=data.items.slice(0,50),hasMore=data.items.length>50,last=items.at(-1);const next=hasMore&&last?Buffer.from(JSON.stringify({v:1,actor_id:user.id.toLowerCase(),filter:selected.data,created_at:last.created_at,id:last.id})).toString('base64url'):null;
 return Response.json({items,filter:selected.data,order:'newest_first',captured_at:data.captured_at,page:{limit:50,has_more:hasMore,next_cursor:next}},{headers});
}catch(e){const status=e instanceof ApiError?e.status:503;return Response.json({error:e instanceof ApiError?e.message:'Les missions n’ont pas pu être vérifiées. Réessayez.'},{status,headers:{...headers,...(status===503?{'Retry-After':'2'}:{})}})}}
