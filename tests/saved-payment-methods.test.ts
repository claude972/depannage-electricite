import test from 'node:test';
import assert from 'node:assert/strict';
import {createSavedMethodHandlers,type Dependencies} from '../lib/features/saved-payment-methods/handlers';
const U='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',K='44444444-4444-4444-8444-444444444444';
function fixture(options:{auth?:boolean;denied?:boolean;old?:boolean;live?:boolean;allowLive?:boolean;origin?:string;lostCustomer?:boolean;lostSetup?:boolean;lostDetach?:boolean;wrongCustomer?:boolean;wrongMode?:boolean;noCustomer?:boolean;badDetach?:boolean;badSession?:boolean;revoked?:boolean}={}){
 const calls:{name:string;args:any;key?:string}[]=[];
 const b:any={id:B,user_id:U,live:options.live??false,customer_id:options.noCustomer?'cus_existing':null,created_at:new Date(Date.now()-(options.old?24*3600000:0)).toISOString()};
 const commands=new Map<string,any>();let madeCustomer:any=null,madeSession:any=null;
 let lostCustomer=options.lostCustomer,lostSetup=options.lostSetup,lostDetach=options.lostDetach;
 let pm:any={id:'pm_card',object:'payment_method',type:'card',customer:options.wrongCustomer?'cus_foreign':'cus_existing',livemode:options.wrongMode?true:false,card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030,fingerprint:'NEVER_EXPOSE'},billing_details:{name:'PRIVATE'}};
 const db:any={async rpc(name:string,args:any={}){
  calls.push({name,args});
  if(name==='saved_methods_guard')return {data:options.denied?null:U,error:options.denied?{code:'42501'}:null};
  if(options.revoked&&name==='saved_methods_context')return {data:null,error:{code:'42501'}};
  if(name==='saved_methods_context')return {data:{customer:b},error:null};
  if(name==='begin_saved_method_command'){
   let c=commands.get(args.p_command);if(!c){c={id:C,user_id:U,live:b.live,command_id:args.p_command,action:args.p_action,method_id:args.p_method,return_origin:args.p_origin,consent:args.p_consent,created_at:b.created_at,session_id:null,verified_customer:null,removed:false};commands.set(args.p_command,c)}
   return {data:{customer:{...b},command:{...c}},error:null};
  }
  if(name==='bind_saved_customer')b.customer_id=args.p_customer;
  if(name==='record_saved_method_proof'){const c=commands.get(args.p_command);if(args.p_kind==='setup')c.session_id=args.p_session;if(args.p_kind==='verified')c.verified_customer=args.p_customer;if(args.p_kind==='removed')c.removed=true}
  return {data:null,error:null};
 }};
 const stripe:any={customers:{create:async(args:any,o:any)=>{calls.push({name:'customer.create',args,key:o.idempotencyKey});madeCustomer??={id:'cus_existing',object:'customer',livemode:b.live,metadata:args.metadata};if(lostCustomer){lostCustomer=false;throw new Error('lost')}return madeCustomer},retrieve:async(id:string)=>({id,object:'customer',livemode:b.live,metadata:{saved_customer_binding:B}})},checkout:{sessions:{create:async(args:any,o:any)=>{calls.push({name:'setup.create',args,key:o.idempotencyKey});madeSession??={id:'cs_test_one',object:'checkout.session',...args,mode:options.badSession?'payment':args.mode,livemode:b.live,status:'open',url:'https://checkout.stripe.com/c/pay/test',amount_total:null,payment_intent:null,subscription:null};if(lostSetup){lostSetup=false;throw new Error('lost')}return madeSession},retrieve:async()=>madeSession}},paymentMethods:{list:async(args:any)=>{calls.push({name:'methods.list',args});return {object:'list',has_more:false,data:pm.customer?[pm]:[]}},retrieve:async(id:string)=>{calls.push({name:'method.retrieve',args:id});return {...pm,id}},detach:async(id:string,_:any,o:any)=>{calls.push({name:'method.detach',args:id,key:o.idempotencyKey});pm={...pm,customer:null};if(lostDetach){lostDetach=false;throw new Error('lost')}return options.badDetach?{...pm,id:'pm_other'}:pm}}};
 const deps:Dependencies={authenticate:async()=>{if(options.auth===false)throw {status:401};return {userId:U,db}},admin:()=>db,stripe:()=>stripe,env:()=>({STRIPE_SECRET_KEY:options.live?'sk_live_injected':'sk_test_injected',STRIPE_LIVE_PAYMENTS_ENABLED:options.allowLive?'true':'false',NEXT_PUBLIC_APP_URL:options.origin??'https://app.example.test'})};
 const h=createSavedMethodHandlers(deps);
 const post=(body:any,origin='https://app.example.test')=>h.POST(new Request('https://app.example.test/api/payments/methods',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const setup=()=>post({action:'setup',consent:true,command_id:K});
 const remove=()=>post({action:'remove',method_id:'pm_card',command_id:K});
 const get=(query='')=>h.GET(new Request(`https://app.example.test/api/payments/methods${query}`));
 return {setup,remove,get,post,calls,b,commands};
}
test('setup sends no payment/charge/subscription, binds Customer and uses exact safe return',async()=>{
 const f=fixture();assert.equal((await f.setup()).status,200);const request=f.calls.find(c=>c.name==='setup.create')!;
 assert.equal(request.args.mode,'setup');assert.equal(request.args.customer,'cus_existing');assert.equal(request.args.success_url,'https://app.example.test/?saved_methods=returned#profile');
 for(const key of ['line_items','payment_intent_data','subscription_data','amount','customer_email'])assert.equal(request.args[key],undefined);
 assert.equal(f.calls.filter(c=>c.name==='customer.create').length,1);
 assert.equal((await f.setup()).status,200);assert.equal(f.calls.filter(c=>c.name==='setup.create').length,1);
});
test('Customer lost reply reuses stable binding key and identical parameters',async()=>{
 const f=fixture({lostCustomer:true});assert.equal((await f.setup()).status,503);assert.equal((await f.setup()).status,200);
 const calls=f.calls.filter(c=>c.name==='customer.create');assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
});
test('setup lost reply reuses original command key',async()=>{
 const f=fixture({lostSetup:true});assert.equal((await f.setup()).status,503);assert.equal((await f.setup()).status,200);
 const calls=f.calls.filter(c=>c.name==='setup.create');assert.deepEqual(calls[0],calls[1]);
});
test('old unresolved command cannot mutate provider',async()=>{const f=fixture({old:true});assert.equal((await f.setup()).status,409);assert.equal(f.calls.filter(c=>c.name.endsWith('.create')).length,0)});
test('listing returns only masked fields from exact Customer and fresh Stripe list',async()=>{
 const f=fixture({noCustomer:true});const r=await f.get();assert.equal(r.status,200);assert.deepEqual(await r.json(),{methods:[{id:'pm_card',brand:'visa',last4:'4242',exp_month:12,exp_year:2030}],has_more:false});assert.match(r.headers.get('cache-control')! ,/no-store/);
});
test('foreign customer or mixed Stripe mode cannot be listed or detached',async()=>{
 for(const option of [{wrongCustomer:true},{wrongMode:true}]){const f=fixture({noCustomer:true,...option});assert.ok([403,503].includes((await f.get()).status));assert.ok([403,503].includes((await f.remove()).status));assert.equal(f.calls.some(c=>c.name==='method.detach'),false)}
});
test('detach checks twice and exact returned identity before recording success',async()=>{
 const f=fixture({noCustomer:true});assert.equal((await f.remove()).status,200);assert.equal(f.calls.filter(c=>c.name==='method.retrieve').length,2);assert.equal(f.calls.filter(c=>c.name==='method.detach').length,1);
 assert.equal((await f.remove()).status,200);assert.equal(f.calls.filter(c=>c.name==='method.detach').length,1);
 const bad=fixture({noCustomer:true,badDetach:true});assert.equal((await bad.remove()).status,503);assert.equal(bad.commands.get(K).removed,false);
});
test('lost detach reply is recovered by read proof, never blindly detached again',async()=>{
 const f=fixture({noCustomer:true,lostDetach:true});assert.equal((await f.remove()).status,503);assert.equal((await f.remove()).status,200);assert.equal(f.calls.filter(c=>c.name==='method.detach').length,1);
});
test('new remove command does not claim an already detached foreign card',async()=>{
 const f=fixture({noCustomer:true});await f.remove();const r=await f.post({action:'remove',method_id:'pm_card',command_id:B});assert.equal(r.status,403);
});
test('auth, verified personal-client guard, missing consent and foreign origin fail before Stripe',async()=>{
 assert.equal((await fixture({auth:false}).setup()).status,401);assert.equal((await fixture({denied:true}).setup()).status,403);
 const f=fixture();assert.equal((await f.post({action:'setup',consent:false,command_id:K})).status,422);assert.equal((await f.post({action:'setup',consent:true,command_id:K},'https://evil.test')).status,403);assert.equal(f.calls.some(c=>c.name.endsWith('.create')),false);
});
test('live requires explicit project gate and unsafe return origins refused',async()=>{
 assert.equal((await fixture({live:true}).setup()).status,503);assert.equal((await fixture({live:true,allowLive:true}).setup()).status,200);
 for(const origin of ['http://evil.test','https://user:pass@app.example.test','https://app.example.test/path','https://app.example.test/#private'])assert.equal((await fixture({origin}).setup()).status,503);
 assert.equal((await fixture({origin:'http://localhost:3000'}).setup()).status,200);
});
test('second SQL authorization and wrong session mode prevent returning a checkout URL',async()=>{
 assert.equal((await fixture({revoked:true}).setup()).status,403);assert.equal((await fixture({badSession:true}).setup()).status,503);
});
test('pagination validates cursor ownership and rejects unknown query keys',async()=>{
 const f=fixture({noCustomer:true});assert.equal((await f.get('?after=pm_card')).status,200);assert.equal(f.calls.find(c=>c.name==='methods.list')?.args.starting_after,'pm_card');assert.equal((await f.get('?limit=100')).status,422);assert.equal((await f.get('?after=x')).status,422);
});
