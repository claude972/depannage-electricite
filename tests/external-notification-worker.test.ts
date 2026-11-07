import test from 'node:test';
import assert from 'node:assert/strict';
import { processExternalNotifications, GENERIC_MESSAGE, type IdempotentAdapter, type RpcClient, type Outcome } from '../lib/features/notifications/external-delivery/worker';
const id='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222',recipient='33333333-3333-4333-8333-333333333333';
function fixture(send:IdempotentAdapter['send']=async()=>({outcome:'accepted',reference:'ref'})){
 const calls:{name:string,args:Record<string,unknown>}[]=[];
 let queued=true;
 const db:RpcClient={async rpc(name,args){calls.push({name,args});return {error:null,data:name==='claim_external_notification'?(queued?(queued=false,{id,lease_token:lease}):null):name==='begin_external_notification'?{id,recipient_id:recipient,channel:'email',provider:'test',idempotency_key:`notification:${id}`}:true}}};
 const adapter:IdempotentAdapter={channel:'email',provider:'test',durableIdempotency:true,send};
 return {db,adapter,calls};
}
test('real worker sends only generic content and opaque identity after begin; acceptance is persisted',async()=>{
 const f=fixture(async(input)=>{
  assert.equal(f.calls.at(-1)?.name,'begin_external_notification');
  assert.deepEqual(Object.keys(input).sort(),['body','deliveryId','idempotencyKey','leaseToken','recipientId','signal','title']);
  assert.equal(input.deliveryId,id);assert.equal(input.leaseToken,lease);
  assert.equal(input.title,GENERIC_MESSAGE.title);assert.equal(input.body,GENERIC_MESSAGE.body);assert.equal(input.recipientId,recipient);
  return {outcome:'accepted',reference:'ref'};
 });
 assert.deepEqual(await processExternalNotifications(f.db,f.adapter),{processed:1,accepted:1,uncertain:0,skipped:0,unconfirmed:0});
 assert.equal(f.calls.find(c=>c.name==='finish_external_notification')?.args.p_reference,'ref');
});
test('inactive SQL gate sends nothing',async()=>{
 let sent=false;const f=fixture(async()=>{sent=true;return {outcome:'accepted',reference:'x'}});
 await processExternalNotifications({rpc:async()=>({data:null,error:null})},f.adapter);assert.equal(sent,false);
});
test('scope/opt-in invalidated at begin sends nothing',async()=>{
 let sent=false;const f=fixture(async()=>{sent=true;return {outcome:'accepted',reference:'x'}});
 const base=f.db.rpc;f.db.rpc=(n,a)=>n==='begin_external_notification'?Promise.resolve({data:null,error:null}):base(n,a);
 assert.equal((await processExternalNotifications(f.db,f.adapter)).skipped,1);assert.equal(sent,false);
});
test('refuses adapter without durable idempotency before any RPC',async()=>{
 const f=fixture();await assert.rejects(processExternalNotifications(f.db,{...f.adapter,durableIdempotency:false}as unknown as IdempotentAdapter));assert.equal(f.calls.length,0);
});
test('timeout, throw and malformed success are uncertain, never accepted',async()=>{
 for(const send of [async()=>{throw new Error('private provider error')},()=>new Promise<Outcome>(()=>{}),async()=>({outcome:'accepted',reference:''}as Outcome)]){
  const f=fixture(send);const result=await processExternalNotifications(f.db,f.adapter,{timeoutMs:5});
  assert.equal(result.uncertain,1);assert.equal(result.accepted,0);
  assert.equal(f.calls.find(c=>c.name==='finish_external_notification')?.args.p_outcome,'uncertain');
 }
});
test('definitive refusal remains failed; retryable means proven not accepted',async()=>{
 for(const state of ['failed','retryable']as const){const f=fixture(async()=>({outcome:state}));await processExternalNotifications(f.db,f.adapter);assert.equal(f.calls.find(c=>c.name==='finish_external_notification')?.args.p_outcome,state)}
});
test('lost/stale finish is unconfirmed and stops batch',async()=>{
 const f=fixture();const base=f.db.rpc;f.db.rpc=(n,a)=>n==='finish_external_notification'?Promise.resolve({data:false,error:null}):base(n,a);
 const r=await processExternalNotifications(f.db,f.adapter);assert.equal(r.unconfirmed,1);assert.equal(r.accepted,0);
});
test('SQL failure stops processing without pretending success',async()=>{
 const f=fixture();const base=f.db.rpc;f.db.rpc=(n,a)=>n==='finish_external_notification'?Promise.resolve({data:null,error:{message:'private'}}):base(n,a);
 await assert.rejects(processExternalNotifications(f.db,f.adapter),/persistence unavailable/);
});
test('wrong source identity never reaches adapter and batch size is bounded',async()=>{
 let sent=false;const f=fixture(async()=>{sent=true;return {outcome:'accepted',reference:'x'}});const base=f.db.rpc;
 f.db.rpc=(n,a)=>n==='begin_external_notification'?Promise.resolve({error:null,data:{id,recipient_id:recipient,channel:'push',provider:'test',idempotency_key:`notification:${id}`}}):base(n,a);
 await assert.rejects(processExternalNotifications(f.db,f.adapter),/identity mismatch/);assert.equal(sent,false);
 await assert.rejects(processExternalNotifications(f.db,f.adapter,{limit:26}),/bounds/);
});
