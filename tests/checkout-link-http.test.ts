import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const payment="20000000-0000-4000-8000-000000000001",command="30000000-0000-4000-8000-000000000001",actor="10000000-0000-4000-8000-000000000009";
function route(options:{denied?:boolean;revokeDuringRead?:boolean;switchUser?:boolean;authenticated?:boolean}={}){
 let revoked=false,authCalls=0,written=0,reads=0;
 const db={rpc:async()=>({data:!options.denied&&!revoked,error:null})};
 const helpers=fakeServerHelpers({db,authenticated:options.authenticated});
 const m=loadModule('app/api/platform-operations/payments/[id]/checkout-link/route.ts',{
  'node:process':{env:{STRIPE_SECRET_KEY:'sk_test_synthetic'}},
  '@/lib/supabase/stripe':{stripeClient:()=>({})},
  '@/lib/supabase/server':{...helpers,adminClient:()=>({}),authenticatedClient:async()=>{
   const out=await helpers.authenticatedClient();authCalls++;
   return options.switchUser&&authCalls>1?{...out,user:{id:'10000000-0000-4000-8000-000000000010'}}:out;
  }},
  '@/lib/features/stripe-reconciliation/checkout-link':{
   CheckoutLinkError:class extends Error{},
   reconcileCheckoutLink:async(_db:unknown,_stripe:unknown,_live:boolean,selector:{paymentId:string},user:string,recheck:()=>Promise<void>)=>{
    reads++;assert.equal(user,actor);assert.equal(selector.paymentId,payment);
    if(options.revokeDuringRead)revoked=true;
    await recheck();written++;
    return{payment_id:payment,state:'linked',review_reason:null,commission:'recorded',rematched:[]};
   },
  },
 });
 return{counts:()=>({authCalls,written,reads}),post:(body:unknown={command_id:command},origin='https://qa.invalid',query='')=>(m.POST as any)(new Request('https://qa.invalid/path'+query,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:payment})})};
}
test('Checkout recovery requires finance access, same origin and exact command',async()=>{
 const denied=route({denied:true});assert.equal((await denied.post()).status,403);assert.equal(denied.counts().reads,0);
 assert.equal((await route({authenticated:false}).post()).status,401);
 const wrong=route();assert.equal((await wrong.post(undefined,'https://evil.invalid')).status,403);assert.equal(wrong.counts().reads,0);
 assert.equal((await route().post({command_id:command,fee_cents:1})).status,422);
 assert.equal((await route().post(undefined,undefined,'?payment=other')).status,422);
});
test('Checkout recovery rejects revoked permissions or changed identity after provider reads',async()=>{
 for(const options of [{revokeDuringRead:true},{switchUser:true}]){
  const f=route(options);assert.equal((await f.post()).status,403);assert.equal(f.counts().written,0);
 }
});
test('Checkout recovery returns a private receipt only after reauthorization and transaction',async()=>{
 const f=route();const r=await f.post();assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
 const body=await r.json();assert.equal(body.command_id,command);assert.equal(body.payment_id,payment);assert.equal(f.counts().written,1);assert.ok(f.counts().authCalls>=2);
});
