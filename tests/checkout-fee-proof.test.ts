import test from'node:test';import assert from'node:assert/strict';
import{createFeeProofHandlers,type FeeDependencies}from'../lib/features/charge-proof/fee-handlers';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const source={payment_id:id(1),event_id:'evt_QA',live:false,fee_id:'fee_QA',charge_id:'ch_platform',connected_charge_id:'ch_connected',destination_account:'acct_QA',amount_cents:2400,currency:'eur',observation_fingerprint:'a'.repeat(64),observation_created:'2026-11-07T00:00:00Z'};
function fixture(o:any={}){const observed={...source,...o.source};const calls:any[]=[];let record:any=null,lost=o.lost;const now=Date.now();
 const fee:any={id:'fee_QA',object:'application_fee',livemode:false,currency:'eur',account:'acct_QA',amount:2400,charge:'ch_connected',originating_transaction:'ch_platform',amount_refunded:600,refunded:false,created:1700000000,metadata:{secret:'SECRET'},...o.fee};
 const db:any={rpc:async(name:string,args:any)=>{calls.push({name,args});if(o.denied)return{data:null,error:{code:'42501'}};if(name==='has_platform_scope')return{data:!(o.readOnly&&args.p_scope==='finance_write'),error:null};if(name==='begin_checkout_fee_proof')return o.sqlOff?{data:null,error:{code:'P0001'}}:{data:{source:observed,completed:!!record},error:null};if(name==='store_checkout_fee_proof'){record??={event_id:'evt_QA',payment_id:id(1),source:observed,provider_amount_refunded_cents:args.p_provider.amount_refunded,provider_refunded:args.p_provider.refunded,fee_created:args.p_provider.created,provider_observed_at:args.p_provider.observed_at,qualified_at:new Date(now).toISOString()};if(lost){lost=false;throw Error('lost response')}return{data:null,error:null}}if(name==='read_checkout_fee_proof')return{data:{qualification:record},error:null};throw Error(name)}};
 const deps:FeeDependencies={authenticate:async()=>{if(o.auth===false)throw{status:401};return{db,userId:id(2)}},admin:()=>db,stripe:()=>({applicationFees:{retrieve:async(feeId:string)=>{calls.push({name:'fee.retrieve',feeId});if(o.revoke)o.denied=true;return fee}}}as any),env:()=>({STRIPE_SECRET_KEY:o.live?'sk_live_injected':'sk_test_injected',STRIPE_CHARGE_PROOF_ENABLED:o.off?'false':'true'}),now:()=>now};
 const h=createFeeProofHandlers(deps),ctx={params:Promise.resolve({id:id(1),eventId:'evt_QA'})},url=`https://app.test/api/platform-operations/payments/${id(1)}/charge-proof/fees/evt_QA`;
 return{calls,post:(body:any={command_id:id(3)},origin:string|null='https://app.test')=>h.POST(new Request(url,{method:'POST',headers:origin===null?{}:{origin},body:JSON.stringify(body)}),ctx),get:()=>h.GET(new Request(url),ctx)};
}
test('attests exact Fee/connected charge/origin/account and keeps dated refund distinct',async()=>{const f=fixture();const r=await f.post();assert.equal(r.status,200);const q=(await r.json()).qualification;assert.equal(q.source.charge_id,'ch_platform');assert.equal(q.source.connected_charge_id,'ch_connected');assert.equal(q.source.amount_cents,2400);assert.equal(q.provider_amount_refunded_cents,600);assert.equal(q.provider_refunded,false);assert.equal(JSON.stringify(q).includes('SECRET'),false);assert.equal(f.calls.find(x=>x.name==='fee.retrieve').feeId,'fee_QA')});
test('foreign/missing origins, account, fee, currency, mode, charge and refunded amounts cannot be associated',async()=>{for(const fee of [{id:'fee_other'},{object:'fee_refund'},{originating_transaction:null},{originating_transaction:'ch_other'},{charge:'ch_platform'},{account:'acct_other'},{currency:'usd'},{livemode:true},{amount:2401},{amount_refunded:2401},{amount_refunded:600,refunded:true}]){const f=fixture({fee});assert.ok([409,503].includes((await f.post()).status),JSON.stringify(fee));assert.equal(f.calls.some(x=>x.name==='store_checkout_fee_proof'),false)}});
test('null refund amount stays unknown rather than zero',async()=>{const r=await fixture({fee:{amount_refunded:null,refunded:false}}).post();assert.equal(r.status,200);assert.equal((await r.json()).qualification.provider_amount_refunded_cents,null)});
test('lost response returns original qualification without another provider read',async()=>{const f=fixture({lost:true});assert.equal((await f.post()).status,503);const r=await f.post();assert.equal(r.status,200);assert.equal(f.calls.filter(x=>x.name==='fee.retrieve').length,1);assert.equal((await r.json()).qualification.provider_amount_refunded_cents,600)});
test('gates/scopes/revocation and input fail closed; finance reads never call provider',async()=>{for(const o of [{off:true},{sqlOff:true},{readOnly:true},{denied:true},{auth:false},{live:true}]){const f=fixture(o);assert.ok([401,403,409,503].includes((await f.post()).status));assert.equal(f.calls.some(x=>x.name==='fee.retrieve'),false)}const revoked=fixture({revoke:true});assert.equal((await revoked.post()).status,403);assert.equal(revoked.calls.some(x=>x.name==='store_checkout_fee_proof'),false);const f=fixture({off:true,readOnly:true});assert.equal((await f.get()).status,200);assert.equal(f.calls.some(x=>x.name==='fee.retrieve'),false);assert.equal((await fixture().post({command_id:id(3),fee_id:'fee_QA'})).status,422)});

test('qualification requires an exact same-origin request before any private or provider read', async () => {
 for (const origin of [null, 'https://other.test']) {
  const f = fixture();
  assert.equal((await f.post(undefined, origin)).status, 403);
  assert.deepEqual(f.calls, []);
 }
});

test("E72 — the provider must confirm the exact connected payment and platform charge", async () => {
 const payment = "py_connected";
 const f = fixture({ source: { connected_charge_id: payment }, fee: { charge: payment } });
 const result = await f.post();
 assert.equal(result.status, 200);
 assert.equal((await result.json()).qualification.source.connected_charge_id, payment);
 assert.equal(f.calls.find(x => x.name === "store_checkout_fee_proof").args.p_provider.originating_transaction, "ch_platform");
 const mismatch = fixture({ source: { connected_charge_id: payment }, fee: { charge: "py_other" } });
 assert.equal((await mismatch.post()).status, 409);
 assert.equal(mismatch.calls.some(x => x.name === "store_checkout_fee_proof"), false);
});
