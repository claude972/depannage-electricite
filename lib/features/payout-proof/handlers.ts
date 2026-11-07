import{z}from'zod';import type Stripe from'stripe';import type{Db}from'../charge-proof/handlers';
import{sid,money,epoch,source,line,proof,qualification,coherent}from'./contract';
export interface Dependencies{authenticate():Promise<{db:Db;userId:string}>;admin():Db;stripe():Pick<Stripe,'payouts'|'balanceTransactions'>;env():Record<string,string|undefined>;now?():number}
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
class Failure extends Error{status:number;constructor(n:number){super();this.status=n}}
function fail(n:number):never{throw new Failure(n)}
function parse<T>(s:z.ZodType<T>,v:unknown):T{const r=s.safeParse(v);if(!r.success)fail(503);return r.data}
async function rpc(db:Db,n:string,a:Record<string,unknown>){const r=await db.rpc(n,a);if(r.error)fail(r.error.code==='42501'?403:r.error.code==='P0002'?404:['P0001','23505'].includes(r.error.code??'')?409:['22023','23514','22P02'].includes(r.error.code??'')?422:503);return r.data}
function error(e:unknown){const status=e instanceof Failure?e.status:(e as{status?:number})?.status===401?401:503;return Response.json({error:status===403?'Accès financier refusé.':'Le rapprochement de ce versement reste à vérifier. Aucune réception bancaire n’est confirmée.'},{status,headers})}
const idOf=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'&&'id'in v?v.id:null;
const payoutSchema=z.object({id:sid('po'),object:z.literal('payout'),livemode:z.boolean(),amount:money.positive(),currency:z.literal('eur'),status:z.literal('paid'),automatic:z.literal(true),method:z.literal('standard'),reconciliation_status:z.literal('completed'),balance_transaction:z.unknown(),failure_balance_transaction:z.null(),created:epoch});
const rawLine=z.object({id:sid('txn'),object:z.literal('balance_transaction'),amount:money,fee:money,net:money,currency:z.literal('eur'),type:z.string(),source:z.union([z.string(),z.object({id:z.string()}),z.null()]),created:epoch,available_on:epoch,status:z.literal('available')});
function project(value:unknown){const r=parse(rawLine,value);return parse(line,{id:r.id,amount_cents:r.amount,fee_cents:r.fee,net_cents:r.net,currency:r.currency,type:r.type,source_id:idOf(r.source),created:r.created,available_on:r.available_on,status:r.status,allocation:'unallocated'})}
type Context={params:Promise<{id:string}>};
export function createPayoutProofHandlers(deps:Dependencies){
 const now=deps.now??Date.now;
 async function auth(write=false){const a=await deps.authenticate();if(await rpc(a.db,'has_platform_scope',{p_scope:'finance_read'})!==true)fail(403);if(write&&await rpc(a.db,'has_platform_scope',{p_scope:'finance_write'})!==true)fail(403);return a}
 async function event(request:Request,ctx:Context){const p=sid('evt').safeParse((await ctx.params).id);if(!p.success||new URL(request.url).searchParams.size)fail(422);return p.data}
 async function read(db:Db,id:string){const r=parse(z.object({qualification:qualification.nullable()}).strict(),await rpc(db,'read_automatic_payout_proof',{p_event:id})),q=r.qualification;if(q&&(q.event_id!==id||q.source.event_id!==id||!coherent(q.source,q.proof)))fail(503);return r}
 return{
 GET:async(request:Request,ctx:Context)=>{try{const a=await auth(),id=await event(request,ctx);return Response.json(await read(a.db,id),{headers})}catch(e){return error(e)}},
 POST:async(request:Request,ctx:Context)=>{try{
  const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)fail(403);const a=await auth(true),id=await event(request,ctx);let body:unknown;try{body=await request.json()}catch{fail(422)}const input=z.object({command_id:z.uuid()}).strict().safeParse(body);if(!input.success)fail(422);
  const env=deps.env(),key=env.STRIPE_SECRET_KEY??'';if(env.STRIPE_PAYOUT_PROOF_ENABLED!=='true'||!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))fail(503);const live=/^(sk|rk)_live_/.test(key);if(live&&env.STRIPE_LIVE_PAYMENTS_ENABLED!=='true')fail(503);
  const db=deps.admin(),c=parse(z.object({source,completed:z.boolean()}).strict(),await rpc(db,'begin_automatic_payout_proof',{p_actor:a.userId,p_event:id,p_command:input.data.command_id,p_live:live})),s=c.source;if(s.event_id!==id||s.live!==live)fail(503);
  if(!c.completed){
   const stripe=deps.stripe(),options={stripeAccount:s.account_id};
   const p=parse(payoutSchema,await stripe.payouts.retrieve(s.payout_id,{},options));if(p.id!==s.payout_id||p.livemode!==live||p.amount!==s.amount_cents||p.created>now()/1000)fail(409);const debitId=parse(sid('txn'),idOf(p.balance_transaction));
   const debit=project(await stripe.balanceTransactions.retrieve(debitId,{},options));if(debit.id!==debitId)fail(409);
   const components:z.infer<typeof line>[]=[];const seen=new Set<string>();let own=false,complete=false,pages=0,after:string|undefined,previous=Number.MAX_SAFE_INTEGER;
   for(let page=0;page<5;page++){
    const batch=parse(z.object({object:z.literal('list'),data:z.array(z.unknown()).max(100),has_more:z.boolean()}),await stripe.balanceTransactions.list({payout:s.payout_id,limit:100,...(after?{starting_after:after}:{})},options));pages++;
    if(batch.has_more&&batch.data.length===0)fail(409);
    for(const value of batch.data){const l=project(value);if(seen.has(l.id)||l.created>previous||l.net_cents!==l.amount_cents-l.fee_cents)fail(409);seen.add(l.id);previous=l.created;
     if(l.id===debitId){if(JSON.stringify(l)!==JSON.stringify(debit))fail(409);own=true}else components.push(l);after=l.id;
    }
    if(!batch.has_more){complete=true;break}
   }
   if(!complete)fail(409);
   const again=parse(payoutSchema,await stripe.payouts.retrieve(s.payout_id,{},options));if(JSON.stringify({...again,balance_transaction:idOf(again.balance_transaction)})!==JSON.stringify({...p,balance_transaction:debitId}))fail(409);
   const candidate=parse(proof,{payout_id:p.id,live:p.livemode,currency:p.currency,amount_cents:p.amount,status:p.status,automatic:p.automatic,reconciliation_status:p.reconciliation_status,payout_created:p.created,debit,components,own_debit_included:own,page_count:pages,listed_count:seen.size,net_components_cents:components.reduce((n,l)=>n+l.net_cents,0),provider_observed_at:new Date(now()).toISOString(),bank_receipt_confirmed:false});
   if(!coherent(s,candidate))fail(409);if((await auth(true)).userId!==a.userId)fail(403);
   await rpc(db,'store_automatic_payout_proof',{p_actor:a.userId,p_command:input.data.command_id,p_source:s,p_proof:candidate});
  }
  return Response.json(await read(a.db,id),{headers});
 }catch(e){return error(e)}}
 };
}
