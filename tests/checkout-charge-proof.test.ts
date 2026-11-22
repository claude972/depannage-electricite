import test from 'node:test';import assert from 'node:assert/strict';
import {createChargeProofHandlers,type Dependencies} from '../lib/features/charge-proof/handlers';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sourceFixture={payment_id:id(1),checkout_id:id(2),quote_id:id(3),intervention_id:id(4),session_id:'cs_test_QA',amount_cents:12000,fee_cents:2400,destination_account:'acct_QA',currency:'eur',paid_at:'2026-11-07T00:00:00Z'};
function fixture(o:any={}){
 const calls:any[]=[];let stored:any=null,lost=o.lostStore;
 const source={...sourceFixture,...o.source};
 const session:any={id:'cs_test_QA',object:'checkout.session',mode:'payment',status:'complete',payment_status:'paid',livemode:false,client_reference_id:id(3),metadata:{quote_id:id(3),platform_checkout_id:id(2)},amount_total:12000,currency:'eur',payment_intent:'pi_QA',created:1700000000,...o.session};
 const pi:any={id:'pi_QA',object:'payment_intent',status:'succeeded',livemode:false,amount:12000,amount_received:12000,currency:'eur',metadata:{quote_id:id(3),platform_checkout_id:id(2)},transfer_data:{destination:'acct_QA'},application_fee_amount:2400,latest_charge:'ch_QA',created:1700000100,...o.pi};
 const charge:any={id:'ch_QA',object:'charge',status:'succeeded',paid:true,captured:true,livemode:false,amount:12000,amount_captured:12000,currency:'eur',payment_intent:'pi_QA',transfer_data:{destination:'acct_QA'},application_fee_amount:2400,created:1700000200,billing_details:{email:'SECRET'},...o.charge};
 const db:any={rpc:async(name:string,args:any)=>{calls.push({name,args});if(o.denied)return{data:null,error:{code:'42501'}};if(name==='has_platform_scope')return{data:!(o.readOnly&&args.p_scope==='finance_write'),error:null};if(name==='begin_checkout_charge_proof')return o.sqlOff?{data:null,error:{code:'P0001'}}:{data:{source,live:false},error:null};if(name==='store_checkout_charge_proof'){if(o.changedSource)return{data:null,error:{code:'P0001'}};stored??={payment_id:id(1),live:false,source,...args.p_provider,verified_at:'2026-11-07T00:00:00Z'};if(lost){lost=false;throw Error('lost reply')}return{data:null,error:null}}if(name==='read_checkout_charge_proof')return{data:{proof:stored,dispute_observations:[],next_after:null},error:null};throw Error(name)}};
 const stripe:any={checkout:{sessions:{retrieve:async(id:string)=>{calls.push({name:'session.retrieve',id});return session}}},paymentIntents:{retrieve:async(id:string)=>{calls.push({name:'pi.retrieve',id});return pi}},charges:{retrieve:async(id:string)=>{calls.push({name:'charge.retrieve',id});if(o.revoke)o.denied=true;return charge}}};
 const deps:Dependencies={authenticate:async()=>{if(o.auth===false)throw {status:401};return{db,userId:id(9)}},admin:()=>db,stripe:()=>stripe,env:()=>({STRIPE_SECRET_KEY:o.live?'sk_live_injected':'sk_test_injected',STRIPE_CHARGE_PROOF_ENABLED:o.off?'false':'true',STRIPE_LIVE_PAYMENTS_ENABLED:o.allowLive?'true':'false'})};
 const h=createChargeProofHandlers(deps),url=`https://app.test/api/platform-operations/payments/${id(1)}/charge-proof`,ctx={params:Promise.resolve({id:id(1)})};
 return{calls,post:(body:any={command_id:id(8)},origin:string|null='https://app.test')=>h.POST(new Request(url,{method:'POST',headers:origin===null?{}:{origin},body:JSON.stringify(body)}),ctx),get:()=>h.GET(new Request(url),ctx)};
}
test('qualifies exact paid Checkout/PI/Charge via retrieves only and stores no billing details',async()=>{const f=fixture();assert.equal((await f.post()).status,200);const data=await(await f.get()).json();assert.equal(data.proof.charge_id,'ch_QA');assert.equal(data.proof.source.amount_cents,12000);assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.deepEqual(f.calls.filter(x=>x.name.endsWith('.retrieve')).map(x=>x.name),['session.retrieve','pi.retrieve','charge.retrieve']);const stored=f.calls.find(x=>x.name==='store_checkout_charge_proof');assert.deepEqual(stored.args.p_provider,{payment_intent_id:'pi_QA',charge_id:'ch_QA',charge_created:1700000200,session_created:1700000000,intent_created:1700000100})});
test('incomplete, foreign, wrong amount/mode/destination and malformed charge never become proof',async()=>{for(const o of [{session:{payment_status:'unpaid'}},{session:{mode:'setup'}},{session:{id:'cs_foreign'}},{session:{amount_total:1}},{pi:{amount_received:1}},{pi:{livemode:true}},{pi:{transfer_data:{destination:'acct_other'}}},{pi:{application_fee_amount:1}},{charge:{captured:false}},{charge:{id:'ch_other'}},{charge:{payment_intent:'pi_other'}},{charge:{currency:'usd'}},{charge:{amount_captured:1}},{charge:{transfer_data:{destination:'acct_other'}}}]){const f=fixture(o);assert.ok([409,503].includes((await f.post()).status),JSON.stringify(o));assert.equal(f.calls.some(x=>x.name==='store_checkout_charge_proof'),false)}});
test('gates, current scopes, live guard and origin refuse before provider reads',async()=>{for(const o of [{off:true},{sqlOff:true},{readOnly:true},{denied:true},{auth:false},{live:true}]){const f=fixture(o);assert.ok([401,403,409,503].includes((await f.post()).status));assert.equal(f.calls.some(x=>x.name.endsWith('.retrieve')),false)}const f=fixture();assert.equal((await f.post({command_id:id(8),amount:1})).status,422);assert.equal((await f.post(undefined,'https://evil.test')).status,403)});
test('revocation during reads and changed SQL source cannot persist a proof',async()=>{const f=fixture({revoke:true});assert.equal((await f.post()).status,403);assert.equal(f.calls.some(x=>x.name==='store_checkout_charge_proof'),false);assert.equal((await fixture({changedSource:true}).post()).status,409)});
test('lost persistence reply repeats exact command and immutable evidence; GET remains offline/read-only',async()=>{const f=fixture({lostStore:true});assert.equal((await f.post()).status,503);assert.equal((await f.post()).status,200);const saves=f.calls.filter(x=>x.name==='store_checkout_charge_proof');assert.deepEqual(saves[0],saves[1]);const offline=fixture({off:true,readOnly:true});const r=await offline.get();assert.equal(r.status,200);assert.equal((await r.json()).proof,null);assert.equal(offline.calls.some(x=>x.name.endsWith('.retrieve')),false)});

test('documented null application fee is accepted only for the exact frozen zero', async () => {
 const noFee = { application_fee_amount: null };
 const zero = fixture({ source: { fee_cents: 0 }, pi: noFee, charge: noFee });
 assert.equal((await zero.post()).status, 200);
 assert.equal((await (await zero.get()).json()).proof.source.fee_cents, 0);
 for (const broken of [
  fixture({ pi: noFee }),
  fixture({ charge: noFee }),
  fixture({ source: { fee_cents: 0 }, pi: { application_fee_amount: undefined }, charge: noFee }),
 ]) {
  assert.ok([409, 503].includes((await broken.post()).status));
  assert.equal(broken.calls.some(call => call.name === 'store_checkout_charge_proof'), false);
 }
});

test('missing origin refuses Checkout qualification before any private read', async () => {
 const f = fixture();
 assert.equal((await f.post(undefined, null)).status, 403);
 assert.deepEqual(f.calls, []);
});
