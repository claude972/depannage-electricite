import { z } from 'zod';
import type Stripe from 'stripe';
export interface Db { rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}> }
export interface Dependencies { authenticate():Promise<{userId:string;db:Db}>; admin():Db; stripe():Pick<Stripe,'customers'|'paymentMethods'|'checkout'>; env():Record<string,string|undefined>; now?():number }
const uuid=z.uuid(), methodId=z.string().regex(/^pm_[A-Za-z0-9]{1,200}$/), customerId=z.string().regex(/^cus_[A-Za-z0-9]{1,200}$/), sessionId=z.string().regex(/^cs_[A-Za-z0-9_]{1,240}$/);
const stamp=z.string().refine(s=>Number.isFinite(Date.parse(s)));
const bindingSchema=z.object({id:uuid,user_id:uuid,live:z.boolean(),customer_id:customerId.nullable(),created_at:stamp}).strict();
const commandSchema=z.object({id:uuid,user_id:uuid,live:z.boolean(),command_id:uuid,action:z.enum(['setup','remove']),method_id:methodId.nullable(),return_origin:z.string().nullable(),consent:z.boolean().nullable(),created_at:stamp,session_id:sessionId.nullable(),verified_customer:customerId.nullable(),removed:z.boolean()}).strict();
type Binding=z.infer<typeof bindingSchema>;type Command=z.infer<typeof commandSchema>;
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('setup'),consent:z.literal(true),command_id:uuid}).strict(),
 z.object({action:z.literal('remove'),method_id:methodId,command_id:uuid}).strict(),
]);
const pmSchema=z.object({id:methodId,object:z.literal('payment_method'),type:z.literal('card'),customer:customerId.nullable(),livemode:z.boolean(),card:z.object({brand:z.string().min(1).max(80),last4:z.string().regex(/^\d{4}$/),exp_month:z.number().int().min(1).max(12),exp_year:z.number().int().min(2000).max(9999)})});
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error {status:number;constructor(status:number){super('Saved payment methods unavailable');this.status=status}}
function fail(status:number):never{throw new Failure(status)}
async function rpc(db:Db,name:string,args?:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error){const code=r.error.code;fail(code==='42501'?403:code==='P0001'||code==='23505'?409:['22023','23514','22P02','23502'].includes(code??'')?422:503)}return r.data}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)fail(503);return r.data}
function configuration(env:Record<string,string|undefined>){
 const key=env.STRIPE_SECRET_KEY??'';if(!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))fail(503);
 const live=/^(sk|rk)_live_/.test(key);if(live&&env.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')fail(503);
 let u:URL;try{u=new URL(env.NEXT_PUBLIC_APP_URL??'')}catch{fail(503)}
 if(u.username||u.password||u.hash||u.search||u.pathname!=='/'||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))fail(503);
 return {live,origin:u.origin};
}
function customer(value:unknown,b:Binding){
 const c=parse(z.object({id:customerId,object:z.literal('customer'),livemode:z.boolean(),deleted:z.literal(false).optional(),metadata:z.record(z.string(),z.string())}),value);
 if(c.livemode!==b.live||c.metadata.saved_customer_binding!==b.id||(b.customer_id!==null&&c.id!==b.customer_id))fail(503);return c;
}
function method(value:unknown,id:string|null,b:Binding,detached=false){const p=parse(pmSchema,value);if((id&&p.id!==id)||p.livemode!==b.live)fail(503);if(p.customer!==(detached?null:b.customer_id))fail(403);return p}
function checkout(value:unknown,b:Binding,c:Command){
 const s=parse(z.object({id:sessionId,object:z.literal('checkout.session'),mode:z.literal('setup'),customer:customerId,livemode:z.boolean(),client_reference_id:uuid,metadata:z.record(z.string(),z.string()),status:z.enum(['open','complete','expired']),url:z.string().nullable(),amount_total:z.null(),payment_intent:z.null(),subscription:z.null()}),value);
 if(s.customer!==b.customer_id||s.livemode!==b.live||s.client_reference_id!==c.id||s.metadata.saved_method_command!==c.id||(c.session_id&&s.id!==c.session_id))fail(503);
 if(s.status!=='open')fail(409);
 if(!s.url)fail(503);let u:URL;try{u=new URL(s.url)}catch{fail(503)}
 if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.username||u.password||(u.port&&u.port!=='443'))fail(503);return {...s,url:s.url};
}
export function createSavedMethodHandlers(deps:Dependencies){
 const now=deps.now??Date.now;
 function withinWindow(created:string){const age=now()-Date.parse(created);if(age< -30000)fail(503);if(age>=23*3600000)fail(409)}
 async function session(){const a=await deps.authenticate();if(!uuid.safeParse(a.userId).success)fail(401);if(await rpc(a.db,'saved_methods_guard')!==a.userId)fail(403);return a}
 async function context(admin:Db,actor:string,live:boolean){const r=parse(z.object({customer:bindingSchema.nullable()}).strict(),await rpc(admin,'saved_methods_context',{p_actor:actor,p_live:live}));if(r.customer&&(r.customer.user_id!==actor||r.customer.live!==live))fail(503);return r.customer}
 async function command(admin:Db,actor:string,live:boolean,body:z.infer<typeof input>,origin:string){
  const r=parse(z.object({command:commandSchema,customer:bindingSchema}).strict(),await rpc(admin,'begin_saved_method_command',{p_actor:actor,p_live:live,p_command:body.command_id,p_action:body.action,p_method:body.action==='remove'?body.method_id:null,p_origin:body.action==='setup'?origin:null,p_consent:body.action==='setup'?true:null}));
  if(r.command.user_id!==actor||r.command.live!==live||r.command.command_id!==body.command_id||r.command.action!==body.action||r.command.method_id!==(body.action==='remove'?body.method_id:null)||r.customer.user_id!==actor||r.customer.live!==live||r.command.return_origin!==(body.action==='setup'?origin:null)||r.command.consent!==(body.action==='setup'?true:null))fail(503);return r;
 }
 async function proof(admin:Db,actor:string,live:boolean,c:Command,b:Binding,kind:string,session:string|null=null){await rpc(admin,'record_saved_method_proof',{p_actor:actor,p_live:live,p_command:c.command_id,p_customer:b.customer_id,p_kind:kind,p_session:session})}
 function error(e:unknown){const raw=e as {status?:number};const status=e instanceof Failure?e.status:[401,403].includes(raw?.status??0)?raw.status!:e instanceof SyntaxError?422:503;const messages:Record<number,string>={401:'Connectez-vous à votre compte personnel.',403:'Cette action est réservée au titulaire du compte client confirmé.',409:'Cette opération doit être vérifiée. Relisez vos moyens enregistrés avant de continuer.',422:'Vérifiez les informations de la demande.',503:'Les moyens de paiement sont indisponibles. Réessayez avec la même demande.'};return Response.json({error:messages[status]},{status,headers})}
 return {
  GET:async(request:Request)=>{try{
   const a=await session(),cfg=configuration(deps.env()),admin=deps.admin();
   const params=new URL(request.url).searchParams;if(params.size>(params.has('after')?1:0))fail(422);
   const after=params.get('after');if(after!==null&&!methodId.safeParse(after).success)fail(422);
   const b=await context(admin,a.userId,cfg.live);if(!b?.customer_id)return Response.json({methods:[],has_more:false},{headers});
   const stripe=deps.stripe();customer(await stripe.customers.retrieve(b.customer_id),b);
   if(after)method(await stripe.paymentMethods.retrieve(after),after,b);
   const page=parse(z.object({object:z.literal('list'),has_more:z.boolean(),data:z.array(z.unknown()).max(20)}),await stripe.paymentMethods.list({customer:b.customer_id,type:'card',limit:20,...(after?{starting_after:after}:{})}));
   const methods=page.data.map(v=>{const p=method(v,null,b);return {id:p.id,...p.card}});
   if(new Set(methods.map(m=>m.id)).size!==methods.length||(page.has_more&&methods.length===0))fail(503);
   await context(admin,a.userId,cfg.live);return Response.json({methods,has_more:page.has_more},{headers});
  }catch(e){return error(e)}},
  POST:async(request:Request)=>{try{
   const originHeader=request.headers.get('origin');if(originHeader&&originHeader!==new URL(request.url).origin)fail(403);
   const a=await session();let raw:unknown;try{raw=await request.json()}catch{fail(422)}const parsed=input.safeParse(raw);if(!parsed.success)fail(422);const body=parsed.data;
   const cfg=configuration(deps.env()),admin=deps.admin(),stripe=deps.stripe();
   let {command:c,customer:b}=await command(admin,a.userId,cfg.live,body,cfg.origin);
   if(body.action==='setup'){
    if(!b.customer_id){
     withinWindow(b.created_at);withinWindow(c.created_at);await context(admin,a.userId,cfg.live);withinWindow(b.created_at);withinWindow(c.created_at);
     const created=customer(await stripe.customers.create({metadata:{saved_customer_binding:b.id}},{idempotencyKey:`saved-customer:${b.id}`}),b);
     await rpc(admin,'bind_saved_customer',{p_actor:a.userId,p_live:cfg.live,p_binding:b.id,p_customer:created.id});
     const bound=await context(admin,a.userId,cfg.live);if(!bound?.customer_id||bound.id!==b.id)fail(503);b=bound;
    }
    customer(await stripe.customers.retrieve(b.customer_id!),b);
    let s;
    if(c.session_id)s=checkout(await stripe.checkout.sessions.retrieve(c.session_id),b,c);
    else{
     await context(admin,a.userId,cfg.live);withinWindow(c.created_at);
     s=checkout(await stripe.checkout.sessions.create({mode:'setup',customer:b.customer_id!,allowed_payment_method_types:['card'],locale:'fr',client_reference_id:c.id,metadata:{saved_method_command:c.id},setup_intent_data:{metadata:{saved_method_command:c.id}},success_url:`${c.return_origin}/?saved_methods=returned#profile`,cancel_url:`${c.return_origin}/?saved_methods=cancelled#profile`},{idempotencyKey:`saved-setup:${c.id}`}),b,c);
     await proof(admin,a.userId,cfg.live,c,b,'setup',s.id);
    }
    await context(admin,a.userId,cfg.live);return Response.json({url:s.url},{headers});
   }
   if(!b.customer_id)fail(403);
   customer(await stripe.customers.retrieve(b.customer_id),b);
   if(c.removed)return Response.json({removed:true},{headers});
   const initial=parse(pmSchema,await stripe.paymentMethods.retrieve(body.method_id));
   if(initial.id!==body.method_id||initial.livemode!==cfg.live)fail(503);
   // A detached method is a success ONLY after this exact command previously recorded ownership.
   if(initial.customer===null){if(c.verified_customer!==b.customer_id)fail(403);await proof(admin,a.userId,cfg.live,c,b,'removed');return Response.json({removed:true},{headers})}
   method(initial,body.method_id,b);withinWindow(c.created_at);
   await proof(admin,a.userId,cfg.live,c,b,'verified');
   await context(admin,a.userId,cfg.live);
   const second=parse(pmSchema,await stripe.paymentMethods.retrieve(body.method_id));
   if(second.id!==body.method_id||second.livemode!==cfg.live)fail(503);
   if(second.customer!==null){
    method(second,body.method_id,b);withinWindow(c.created_at);
    await context(admin,a.userId,cfg.live);withinWindow(c.created_at);
    method(await stripe.paymentMethods.detach(body.method_id,{}, {idempotencyKey:`saved-remove:${c.id}`}),body.method_id,b,true);
   }
   await proof(admin,a.userId,cfg.live,c,b,'removed');return Response.json({removed:true},{headers});
  }catch(e){return error(e)}}
 };
}
