import {createHash} from 'node:crypto';
import {z} from 'zod';
import {classification,classifyPhoto,configuration} from './provider';
const uuid=z.uuid(),version=z.number().int().min(0).max(2147483646);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('request'),document_id:uuid,command_id:uuid,expected_version:version,consent:z.literal(true)}).strict(),
 z.object({action:z.literal('withdraw'),review_id:uuid,command_id:uuid,expected_version:version}).strict(),
 z.object({action:z.literal('review'),review_id:uuid,command_id:uuid,expected_version:version,decision:z.enum(['validate','reject'])}).strict(),
]);
const statuses=z.enum(['requested','withdrawn','uncertain','awaiting_review','validated','rejected','invalidated']);
const view=z.object({can_request:z.boolean(),items:z.array(z.object({id:uuid,document_id:uuid,version:z.number().int().positive(),status:statuses,can_withdraw:z.boolean(),can_review:z.boolean(),result:classification.nullable()}).strict()).max(20)}).strict();
const source=z.object({id:uuid,document_id:uuid,path:z.string().min(1).max(1024),mime:z.enum(['image/jpeg','image/png','image/webp']),version:z.number().int().positive(),status:statuses,request_command_id:uuid,sha256:z.string().nullable()}).strict();
export interface Db{rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>}
export interface Session{db:Db;userId:string;sessionKey:string;download(path:string):Promise<Blob>}
export interface Dependencies{authenticate():Promise<Session>;admin():Db;env():Record<string,string|undefined>;fetcher:typeof fetch}
class Failure extends Error{status:number;constructor(s:number){super();this.status=s}}
function fail(s:number):never{throw new Failure(s)}
async function rpc(db:Db,name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error)fail(r.error.code==='42501'?403:r.error.code==='P0001'||r.error.code==='23505'?409:['22023','23514','22P02'].includes(r.error.code??'')?422:503);return r.data}
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function parse<T>(s:z.ZodType<T>,x:unknown):T{const v=s.safeParse(x);if(!v.success)fail(503);return v.data}
function digest(b:Uint8Array){return createHash('sha256').update(b).digest('hex')}
async function image(s:Session,p:z.infer<typeof source>){
 if(p.path.startsWith('/')||p.path.includes('\\')||p.path.split('/').some(x=>!x||x==='.'||x==='..')||/[\u0000-\u001f]/.test(p.path))fail(503);
 const blob=await s.download(p.path);if(blob.size<1||blob.size>4194304)fail(422);const b=new Uint8Array(await blob.arrayBuffer());
 const magic=p.mime==='image/jpeg'?b.length>=5&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217:
 p.mime==='image/png'?b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v):
 b.length>=16&&Buffer.from(b.slice(0,4)).toString()==='RIFF'&&Buffer.from(b.slice(8,12)).toString()==='WEBP'&&new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(4,true)+8===b.length;
 if(!magic||b.length!==blob.size)fail(422);return b;
}
export function createPhotoReviewHandlers(deps:Dependencies){
 async function same(original:Session){const s=await deps.authenticate();if(!s.sessionKey||s.userId!==original.userId||s.sessionKey!==original.sessionKey)fail(403);return s}
 async function render(s:Session,job:string){const v=parse(view,await rpc(s.db,'photo_review_list',{p_job:job}));if(new Set(v.items.map(i=>i.id)).size!==v.items.length)fail(503);if(v.can_request&&v.items.some(i=>i.status!=='validated'&&i.result!==null))fail(503);return Response.json({...v,provider_available:configuration(deps.env())!==null},{headers})}
 async function readSource(s:Session,job:string,id:string){const p=parse(source,await rpc(s.db,'photo_review_source',{p_job:job,p_review:id}));if(p.id!==id)fail(503);return p}
 async function run(request:Request,job:string,write:boolean){try{
  if(!uuid.safeParse(job).success||new URL(request.url).searchParams.size)fail(422);
  if(write){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail(403)}
  const session=await deps.authenticate();if(!session.sessionKey)fail(401);
  if(!write)return await render(session,job);
  let body:unknown;try{body=await request.json()}catch{fail(422)}const parsed=command.safeParse(body);if(!parsed.success)fail(422);const c=parsed.data;
  const id=parse(uuid,await rpc(session.db,'photo_review_command',{p_job:job,p_command:c.command_id,p_action:c.action,p_expected_version:c.expected_version,p_document:c.action==='request'?c.document_id:null,p_review:c.action!=='request'?c.review_id:null,p_consent:c.action==='request'?true:null,p_decision:c.action==='review'?c.decision:null}));
  const cfg=configuration(deps.env());if(c.action!=='request'||!cfg)return await render(await same(session),job);
  const p=await readSource(session,job,id);if(p.request_command_id!==c.command_id||p.status!=='requested')return await render(await same(session),job);
  if(p.document_id!==c.document_id)fail(503);
  const bytes=await image(session,p),sha=digest(bytes);let current=await same(session);
  const latest=await readSource(current,job,id);if(JSON.stringify(latest)!==JSON.stringify(p))fail(409);
  const reserved=await rpc(deps.admin(),'photo_review_provider',{p_actor:session.userId,p_job:job,p_review:id,p_action:'reserve',p_command:c.command_id,p_version:p.version,p_sha256:sha,p_category:null,p_readability:null});
  if(reserved!==true)return await render(await same(session),job);
  // Durable uncertain state BEFORE dispatch: no automatic/replayed second provider request.
  current=await same(session);const before=await readSource(current,job,id);if(before.status!=='uncertain'||before.sha256!==sha)fail(409);
  const result=await classifyPhoto(bytes,p.mime,cfg,deps.fetcher);
  current=await same(session);const after=await readSource(current,job,id);
  if(after.status!=='uncertain'||after.sha256!==sha||after.path!==p.path||after.document_id!==p.document_id||digest(await image(current,after))!==sha)fail(409);
  current=await same(session);
  if(await rpc(deps.admin(),'photo_review_provider',{p_actor:current.userId,p_job:job,p_review:id,p_action:'finish',p_command:null,p_version:null,p_sha256:sha,p_category:result.category,p_readability:result.readability})!==true)fail(409);
  return await render(await same(session),job);
 }catch(e){const known=e as {status?:number};const status=e instanceof Failure?e.status:known?.status===401?401:503;const messages:Record<number,string>={401:'Connectez-vous pour consulter cette photo.',403:'Cette photo n’est pas accessible avec vos droits actuels.',409:'La photo ou son attribution a changé. Relisez son état avant de continuer.',422:'Choisissez une photo JPEG, PNG ou WebP de moins de 4 Mo et confirmez votre choix.',503:'Le classement n’a pas pu être confirmé. Aucun nouvel envoi automatique n’est effectué.'};return Response.json({error:messages[status]},{status,headers})}}
 return {GET:(r:Request,job:string)=>run(r,job,false),POST:(r:Request,job:string)=>run(r,job,true)};
}
