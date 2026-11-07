import {z} from 'zod';
import {authenticatedClient,ApiError,dbError} from '@/lib/supabase/server';
const uuid=z.uuid().transform(s=>s.toLowerCase());
const stamp=z.iso.datetime({offset:true}).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const status=z.enum(['all','sent','accepted','rejected']);
const cursorSchema=z.object({v:z.literal(1),actor:uuid,status,at:stamp,id:uuid}).strict();
const intervention=z.object({id:uuid,artisan_id:uuid,category:z.enum(['outage','panel','socket','lighting','diagnostic']),status:z.enum(['requested','assigned','quoted','accepted','in_progress','completed','paid','cancelled'])});
const row=z.object({id:uuid,intervention_id:uuid,artisan_id:uuid,status:z.enum(['sent','accepted','rejected']),total_cents:z.number().int().positive().max(10000000),created_at:stamp,accepted_at:stamp.nullable(),intervention,author:z.object({role:z.literal('artisan')})});
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function micros(s:string){return BigInt(Date.parse(s))*1000n+BigInt((s.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??'').slice(3).padEnd(3,'0'))}
export async function GET(request:Request){try{
 const{db,user}=await authenticatedClient();const actor=user.id.toLowerCase();
 const query=new URL(request.url).searchParams;
 if(request.url.length>2048||[...query.keys()].some(k=>!['status','limit','cursor'].includes(k)||query.getAll(k).length!==1))throw new ApiError(422,'Paramètres invalides.');
 const selected=status.safeParse(query.get('status')??'all');const rawLimit=query.get('limit')??'50';
 if(!selected.success||!/^([1-9]|[1-4][0-9]|50)$/.test(rawLimit))throw new ApiError(422,'Filtre ou limite invalide.');const limit=Number(rawLimit);
 let cursor:z.infer<typeof cursorSchema>|null=null;
 if(query.has('cursor')){try{const raw=query.get('cursor')!;if(!/^[A-Za-z0-9_-]{1,600}$/.test(raw))throw Error();const bytes=Buffer.from(raw,'base64url');if(bytes.toString('base64url')!==raw)throw Error();cursor=cursorSchema.parse(JSON.parse(bytes.toString('utf8')));if(cursor.actor!==actor||cursor.status!==selected.data)throw Error()}catch{throw new ApiError(422,'Curseur invalide. Rechargez les devis.')}}
 const profile=await db.from('profiles').select('role').eq('id',actor).maybeSingle();dbError(profile.error);
 if(profile.data?.role!=='artisan')throw new ApiError(403,'Accès artisan requis.');
 // Both embedded relations are INNER and filtered in the same RLS-protected statement.
 // An old author loses this list entry as soon as the dossier is assigned elsewhere.
 let q=db.from('quotes').select('id,intervention_id,artisan_id,status,total_cents,created_at,accepted_at,intervention:interventions!inner(id,artisan_id,category,status),author:profiles!quotes_artisan_id_fkey!inner(role)').eq('artisan_id',actor).eq('intervention.artisan_id',actor).eq('author.role','artisan');
 if(selected.data!=='all')q=q.eq('status',selected.data);
 if(cursor)q=q.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
 const result=await q.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);dbError(result.error);
 const rows=z.array(row).max(limit+1).parse(result.data);const seen=new Set<string>();let prior=cursor?{created_at:cursor.at,id:cursor.id}:null;
 for(const r of rows){if(r.artisan_id!==actor||r.intervention.artisan_id!==actor||r.intervention.id!==r.intervention_id||(selected.data!=='all'&&r.status!==selected.data)||seen.has(r.id)||(prior&&!(micros(r.created_at)<micros(prior.created_at)||(micros(r.created_at)===micros(prior.created_at)&&r.id<prior.id))))throw Error('Unverifiable page');seen.add(r.id);prior=r;}
 const items=rows.slice(0,limit).map(r=>({id:r.id,intervention_id:r.intervention_id,status:r.status,total_cents:r.total_cents,created_at:r.created_at,accepted_at:r.accepted_at,intervention:{id:r.intervention.id,category:r.intervention.category,status:r.intervention.status}}));
 const hasMore=rows.length>limit,last=items.at(-1),next=hasMore&&last?Buffer.from(JSON.stringify({v:1,actor,status:selected.data,at:last.created_at,id:last.id})).toString('base64url'):null;
 return Response.json({items,page:{limit,has_more:hasMore,next_cursor:next},order:'newest_first'},{headers});
 }catch(e){const code=e instanceof ApiError?e.status:503;return Response.json({error:e instanceof ApiError?e.message:'Les devis n’ont pas pu être vérifiés. Réessayez.'},{status:code,headers:{...headers,...(code===503?{'Retry-After':'2'}:{})}})}}
