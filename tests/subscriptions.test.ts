import Stripe from 'stripe';
import test from 'node:test';import assert from 'node:assert/strict';
import {createSubscriptionHandlers,type Dependencies} from '../lib/features/subscriptions/handlers';
const U='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',T='44444444-4444-4444-8444-444444444444',C='55555555-5555-4555-8555-555555555555';
function fixture(o:any={}){
 const calls:any[]=[];const live=o.live??false;
 const offer:any={id:O,version:1,live,role:'client',label:'QA explicit offer',active:true,price_id:'price_QA',amount_cents:1234,currency:'eur',interval:'month',interval_count:2,tax_behavior:'inclusive'};
 const account:any={id:A,actor:U,live,customer_id:null,created_at:new Date(Date.now()-(o.old?24*3600000:0)).toISOString(),read_seq:0,current_attempt:null};let attempt:any=null,session:any=null,subState='active';let portalCommand:any=null,eventDone=false;let lostCustomer=o.lostCustomer,lostSession=o.lostSession;
 const price:any={id:'price_QA',object:'price',active:true,livemode:o.wrongMode?!live:live,type:'recurring',billing_scheme:'per_unit',custom_unit_amount:null,transform_quantity:null,unit_amount:o.wrongPrice?5678:1234,currency:o.currency??'eur',tax_behavior:'inclusive',recurring:{interval:'month',interval_count:2,usage_type:'licensed'}};
 const context=()=>({enabled:o.gate!==false,eligible:true,role:'client',offers:[offer],account:structuredClone(account),attempt:attempt?structuredClone(attempt):null});
 const db:any={async rpc(name:string,args:any){calls.push({name,args});if(o.denied)return {data:null,error:{code:'42501'}};
  if(name==='subscription_guard')return {data:args.p_operator?'operator':'client',error:null};
  if(name==='subscription_context'){if(args.p_read)account.read_seq++;return {data:context(),error:null}}
  if(name==='begin_subscription_checkout'){
   if(o.gate===false)return {data:null,error:{code:'P0001'}};
   if(!attempt){attempt={id:T,account_id:A,command_id:args.p_command,offer,return_origin:args.p_origin,created_at:account.created_at,session_id:null,subscription_id:null,status:'preparing',cancel_at_period_end:false,period_start:null,period_end:null,observed_at:null};account.current_attempt=T}
   return {data:context(),error:null};
  }
  if(name==='bind_subscription_provider'){if(args.p_kind==='customer')account.customer_id=args.p_value;else {attempt.session_id=args.p_value;attempt.status='open'}return {data:null,error:null}}
  if(name==='begin_subscription_portal'){portalCommand??={account_id:A,command_id:args.p_command,attempt_id:T,configuration:args.p_configuration,return_url:args.p_return,created_at:o.portalOld?'2020-01-01T00:00:00Z':new Date().toISOString()};return {data:portalCommand,error:null}}
  if(name==='claim_subscription_billing_event'){account.read_seq++;return {data:eventDone||o.unknownEvent?{done:true}:{done:false,token:C,context:context()},error:null}}
  if(name==='observe_subscription'||name==='apply_subscription_billing_event'){if(o.stale)return {data:null,error:{code:'P0001'}};if(name==='apply_subscription_billing_event')eventDone=true;Object.assign(attempt,{subscription_id:args.p_subscription,status:args.p_status,cancel_at_period_end:args.p_cancel,period_start:args.p_start,period_end:args.p_end,observed_at:new Date().toISOString()});account.read_seq++;return {data:null,error:null}}
  if(name==='save_subscription_offer')return {data:{...offer,...args.p_values,version:args.p_version+1},error:null};
  throw Error(name);
 }};
 const stripe:any={prices:{retrieve:async(id:string)=>{calls.push({name:'price.retrieve',id});return price}},customers:{create:async(args:any,key:any)=>{calls.push({name:'customer.create',args,key});if(lostCustomer){lostCustomer=false;throw Error('lost')}return {id:'cus_QA',object:'customer',livemode:live,metadata:args.metadata}},retrieve:async()=>({id:o.wrongCustomer?'cus_foreign':'cus_QA',object:'customer',livemode:live,metadata:{subscription_account:A}})},checkout:{sessions:{create:async(args:any,key:any)=>{calls.push({name:'checkout.create',args,key});session??={id:'cs_test_QA',object:'checkout.session',...args,status:'open',subscription:null,livemode:live,url:'https://checkout.stripe.com/c/pay/QA#fidOpaque',currency:'eur',amount_total:1234};if(lostSession){lostSession=false;throw Error('lost')}return session},retrieve:async()=>session}},subscriptions:{retrieve:async()=>({id:'sub_QA',object:'subscription',customer:o.foreignSubscription?'cus_foreign':'cus_QA',livemode:live,status:subState,currency:'eur',metadata:{subscription_attempt:T},cancel_at_period_end:subState==='canceled',items:{has_more:false,data:[{subscription:'sub_QA',quantity:1,current_period_start:1000,current_period_end:2000,price}]}})}};
 stripe.webhooks=new Stripe('sk_test_injected').webhooks;
 stripe.billingPortal={configurations:{retrieve:async(id:string)=>({id,object:'billing_portal.configuration',active:!o.portalInactive,livemode:o.portalWrongMode?!live:live,features:{subscription_cancel:{enabled:!o.noCancel},subscription_update:{enabled:!!o.allowUpdate}}})},sessions:{create:async(args:any,key:any)=>{calls.push({name:'portal.create',args,key});if(o.disconnect)o.auth=false;if(o.lostPortal){o.lostPortal=false;throw Error('lost')}return {id:'bps_QA',object:'billing_portal.session',...args,customer:o.portalForeign?'cus_foreign':args.customer,livemode:live,on_behalf_of:null,url:o.portalUrl??'https://billing.stripe.com/p/session?secret=test_QA'}}}};
 const deps:Dependencies={authenticate:async()=>{if(o.auth===false)throw {status:401};return {db,userId:U}},admin:()=>db,stripe:()=>{calls.push({name:'stripe.client'});return stripe},env:()=>({STRIPE_SECRET_KEY:o.noKeys?undefined:live?'sk_live_injected':'sk_test_injected',STRIPE_LIVE_PAYMENTS_ENABLED:o.allowLive?'true':'false',SUBSCRIPTIONS_ENABLED:o.env===false?'false':'true',NEXT_PUBLIC_APP_URL:o.origin??'https://app.test',STRIPE_BILLING_PORTAL_CONFIGURATION_TEST:o.noPortal?undefined:'bpc_QA',STRIPE_BILLING_WEBHOOK_SECRET_TEST:'whsec_injected'})};
 const h=createSubscriptionHandlers(deps),post=(body:any)=>h.POST(new Request('https://app.test/api/subscriptions',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify(body)}));
 return {h,calls,post,portal:()=>h.PORTAL(new Request('https://app.test/api/subscriptions/portal',{method:'POST',body:JSON.stringify({command_id:C})})),billing:async(event:any={},signature=true)=>{const payload=JSON.stringify({id:'evt_QA',livemode:live,type:'customer.subscription.updated',data:{object:{id:'sub_QA',object:'subscription',status:'canceled'}},...event});return h.BILLING(new Request('https://app.test/api/subscriptions/webhook',{method:'POST',body:payload,headers:signature?{'stripe-signature':stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_injected'})}:{}}))},checkout:()=>post({action:'checkout',offer_id:O,offer_version:1,command_id:C,consent:true}),get:()=>h.GET(new Request('https://app.test/api/subscriptions')),complete:(s='active')=>{session.status='complete';session.subscription='sub_QA';subState=s},operator:()=>h.OFFER(new Request('https://app.test/api/subscriptions/offers',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify({command_id:C,id:null,expected_version:0,label:'QA explicit offer',role:'client',active:true,price_id:'price_QA'})}))};
}
test('both gates prevent checkout; catalogue remains inactive with no fake subscription',async()=>{
 for(const o of [{gate:false},{env:false}]){const f=fixture(o);assert.ok([409,503].includes((await f.checkout()).status));assert.equal(f.calls.some(c=>c.name==='checkout.create'),false);const r=await f.get();assert.equal(r.status,200);const data=await r.json();assert.equal(data.available,false);assert.deepEqual(data.offers,[])}
});
test('subscription Checkout exact Price, amount/currency/period proof and safe fragment URL',async()=>{
 const f=fixture();const r=await f.checkout();assert.equal(r.status,200);assert.equal((await r.json()).url,'https://checkout.stripe.com/c/pay/QA#fidOpaque');const sent=f.calls.find(c=>c.name==='checkout.create').args;assert.equal(sent.mode,'subscription');assert.equal(sent.currency,'eur');assert.deepEqual(sent.adaptive_pricing,{enabled:false});assert.deepEqual(sent.line_items,[{price:'price_QA',quantity:1}]);assert.equal(sent.customer,'cus_QA');assert.equal(sent.success_url,'https://app.test/?subscription=returned#profile');assert.equal(sent.subscription_data.trial_period_days,undefined);assert.equal(sent.payment_intent_data,undefined);
 assert.equal((await f.checkout()).status,200);assert.equal(f.calls.filter(c=>c.name==='checkout.create').length,1);
});
test('lost Customer/Checkout replies reuse exact durable keys and parameters',async()=>{
 for(const [option,name]of [[{lostCustomer:true},'customer.create'],[{lostSession:true},'checkout.create']]as const){const f=fixture(option);assert.equal((await f.checkout()).status,503);assert.equal((await f.checkout()).status,200);const c=f.calls.filter(x=>x.name===name);assert.deepEqual(c[0],c[1])}
});
test('window, current mode, foreign Customer and changed Price fail before checkout',async()=>{
 for(const o of [{old:true},{wrongPrice:true},{wrongMode:true},{wrongCustomer:true}]){const f=fixture(o);assert.ok([409,503].includes((await f.checkout()).status));assert.equal(f.calls.some(c=>c.name==='checkout.create'),false)}
});
test('real server reads attest subscription states, never browser return',async()=>{
 const f=fixture();await f.checkout();let r=await f.get();assert.equal((await r.json()).subscription,null);
 for(const s of ['active','past_due','unpaid','canceled']){f.complete(s);r=await f.get();assert.equal(r.status,200);const d=await r.json();assert.equal(d.subscription.status,s);assert.equal(d.subscription.offer.amount_cents,1234);assert.equal(JSON.stringify(d).includes('cus_QA'),false);assert.equal(JSON.stringify(d).includes('sub_QA'),false)}
});
test('foreign subscription and stale observation cannot change visible state',async()=>{
 for(const o of [{foreignSubscription:true},{stale:true}]){const f=fixture(o);await f.checkout();f.complete();assert.equal((await f.get()).status,409)}
});
test('operator offer fields derive from retrieved Stripe Price, never input amount',async()=>{
 const f=fixture();const r=await f.operator();assert.equal(r.status,200);const saved=f.calls.find(c=>c.name==='save_subscription_offer').args.p_values;assert.equal(saved.amount_cents,1234);assert.equal(saved.interval_count,2);assert.equal(saved.currency,'eur');assert.equal((await fixture({denied:true}).operator()).status,403);
});
test('auth, consent and event-shaped input cannot bypass the subscription action endpoint',async()=>{
 assert.equal((await fixture({auth:false}).checkout()).status,401);assert.equal((await fixture({denied:true}).checkout()).status,403);
 const f=fixture();assert.equal((await f.post({action:'checkout',offer_id:O,offer_version:1,command_id:C,consent:false})).status,422);assert.equal((await f.post({type:'customer.subscription.updated',data:{object:{status:'active'}}})).status,422);assert.equal(f.calls.some(c=>c.name==='observe_subscription'),false);
});
test('live and configured return guards remain explicit',async()=>{
 assert.equal((await fixture({live:true}).checkout()).status,503);assert.equal((await fixture({live:true,allowLive:true}).checkout()).status,200);assert.equal((await fixture({origin:'https://user:password@app.test'}).checkout()).status,503);
});

test('portal links use explicit verified configuration, durable key and exact Customer; return changes no state',async()=>{
 const o:any={lostPortal:true};const f=fixture(o);await f.checkout();f.complete();assert.equal((await f.portal()).status,503);const r=await f.portal();assert.equal(r.status,200);assert.match((await r.json()).url,/^https:\/\/billing.stripe.com/);
 const calls=f.calls.filter(x=>x.name==='portal.create');assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].args.configuration,'bpc_QA');assert.equal(calls[0].args.customer,'cus_QA');assert.equal(calls[0].args.return_url,'https://app.test/?subscription=managed#profile');
 const state=await(await f.get()).json();assert.equal(state.subscription.status,'active');assert.equal(state.portal_available,true);
});
test('portal denies absent subscription, foreign response, unsupported configuration, old command and revoked session',async()=>{
 assert.equal((await fixture().portal()).status,409);
 for(const o of [{portalInactive:true},{portalWrongMode:true},{noCancel:true},{allowUpdate:true},{portalForeign:true},{portalOld:true},{disconnect:true},{portalUrl:'https://billing.stripe.com.evil.test/x'},{noPortal:true}]){const f=fixture(o);await f.checkout();f.complete();assert.ok([401,409,503].includes((await f.portal()).status),JSON.stringify(o))}
});
test('signed billing events require no browser session, re-read provider state and deduplicate exact receipt',async()=>{
 const o:any={};const f=fixture(o);await f.checkout();f.complete('past_due');await f.get();o.auth=false;
 assert.equal((await f.billing()).status,200);assert.equal((await f.billing()).status,200);
 const applied=f.calls.filter(x=>x.name==='apply_subscription_billing_event');assert.equal(applied.length,1);assert.equal(applied[0].args.p_status,'past_due');assert.equal(applied[0].args.p_subscription,'sub_QA');
});
test('billing refuses missing signature, foreign account/mode, stale CAS and unknown association without projecting payload',async()=>{
 const f=fixture();assert.equal((await f.billing({},false)).status,400);assert.equal((await f.billing({account:'acct_foreign'})).status,400);assert.equal((await f.billing({livemode:true})).status,400);assert.equal(f.calls.some(x=>x.name==='claim_subscription_billing_event'),false);
 const unknown=fixture({unknownEvent:true});assert.equal((await unknown.billing()).status,200);assert.equal(unknown.calls.some(x=>x.name==='apply_subscription_billing_event'),false);
 const o:any={};const stale=fixture(o);await stale.checkout();stale.complete();await stale.get();o.stale=true;assert.equal((await stale.billing()).status,409);
});

test('known completed Checkout can establish initial subscription through signed event without a browser return',async()=>{
 const o:any={};const f=fixture(o);await f.checkout();f.complete();o.auth=false;
 assert.equal((await f.billing({type:'checkout.session.completed',data:{object:{id:'cs_test_QA',object:'checkout.session'}}})).status,200);
 assert.equal(f.calls.find(x=>x.name==='apply_subscription_billing_event').args.p_subscription,'sub_QA');
});

test('EUR catalogue refuses USD/JPY Price before any provider mutation or SQL catalogue write',async()=>{
 for(const currency of ['jpy','usd']){const f=fixture({currency});assert.equal((await f.operator()).status,409);assert.equal(f.calls.some(x=>x.name==='save_subscription_offer'),false);assert.equal((await f.checkout()).status,409);assert.equal(f.calls.some(x=>['customer.create','checkout.create','portal.create'].includes(x.name)),false)}
});
test('disabled service without keys is unknown state, authenticates first and never opens Stripe',async()=>{
 const f=fixture({env:false,noKeys:true});const r=await f.get();assert.equal(r.status,200);assert.deepEqual(await r.json(),{state:'unavailable',available:false,portal_available:false,offers:[],checkout_pending:null,subscription:null});assert.deepEqual(f.calls.map(x=>x.name),['subscription_guard']);
 assert.equal((await fixture({env:false,noKeys:true,auth:false}).get()).status,401);assert.equal((await fixture({env:false,noKeys:true,denied:true}).get()).status,403);
 assert.equal((await fixture({noKeys:true}).get()).status,503);
 const ready=await(await fixture().get()).json();assert.equal(ready.state,'ready');assert.equal(ready.checkout_pending,false);
});
