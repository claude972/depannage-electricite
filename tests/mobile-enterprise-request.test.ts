import test from 'node:test';
import assert from 'node:assert/strict';
import { enterpriseDraftKey, enterpriseRequestCommand, enterpriseRequestIntent, enterpriseRequestDraft } from '../apps/mobile/src/lib/enterprise-request-draft';
const actor='10000000-0000-4000-8000-000000000001', organization='10000000-0000-4000-8000-000000000002', site='10000000-0000-4000-8000-000000000003';
const intent=()=>enterpriseRequestIntent.parse({id:'10000000-0000-4000-8000-000000000004',actor_id:actor,organization_id:organization,payload:{site_id:site,category:'panel',description:'Tableau sans courant',address:'12 rue du Port',postal_code:'97200',city:'Fort-de-France',urgency:'urgent',reviewed_estimate_version:3},estimate:{min_cents:10000,max_cents:20000},reviewRequired:false});
test('enterprise retries preserve the exact key and payload without private draft metadata',()=>{
 const value=intent(), command=enterpriseRequestCommand(value,{actor,organization,site});
 assert.deepEqual(enterpriseRequestCommand(value,{actor,organization,site}),command);
 assert.equal(command.request_id,value.id);assert.equal(command.site_id,site);
 assert.equal('actor_id' in command,false);assert.equal('estimate' in command,false);
});
test('enterprise drafts and retries cannot cross account, organization or site boundaries',()=>{
 const scope={actor,organization,site};
 for(const key of ['actor','organization','site'] as const){
  const changed={...scope,[key]:'10000000-0000-4000-8000-000000000099'};
  assert.throws(()=>enterpriseRequestCommand(intent(),changed));
  assert.notEqual(enterpriseDraftKey(actor,organization,site),enterpriseDraftKey(changed.actor,changed.organization,changed.site));
 }
 assert.throws(()=>enterpriseDraftKey(actor,organization,'../site'));
});
test('a stale estimate or a malformed range prevents enterprise submission',()=>{
 assert.throws(()=>enterpriseRequestCommand({...intent(),reviewRequired:true},{actor,organization,site}));
 assert.equal(enterpriseRequestIntent.safeParse({...intent(),estimate:{min_cents:20000,max_cents:10000}}).success,false);
 assert.equal(enterpriseRequestIntent.safeParse({...intent(),payload:{...intent().payload,site_id:null}}).success,false);
});

test('unfinished enterprise forms survive serialization before any send intent exists',()=>{
 const draft={intent:null,confirmedId:null,form:{category:'socket',description:'Prise hors service',address:'12 rue du Port',postal:'97200',city:'Fort-de-France',urgency:'scheduled',step:1}};
 assert.deepEqual(enterpriseRequestDraft.parse(JSON.parse(JSON.stringify(draft))),draft);
 assert.deepEqual(enterpriseRequestDraft.parse({intent:null,confirmedId:null}),{intent:null,confirmedId:null});
});

test('a device-store reopen restores the unsent form and an explicit reset allows a second request', async()=>{
 const { createDraftStore } = await import('../apps/mobile/src/lib/draft-store');
 const disk=new Map<string,string>();
 const storage={getItem:async(key:string)=>disk.get(key)??null,setItem:async(key:string,value:string)=>{disk.set(key,value)},removeItem:async(key:string)=>{disk.delete(key)}};
 const key=enterpriseDraftKey(actor,organization,site);
 const first=createDraftStore(storage);
 const draft=enterpriseRequestDraft.parse({intent:null,confirmedId:null,form:{category:'panel',description:'Tableau en panne',address:'12 rue du Port',postal:'97200',city:'Fort-de-France',urgency:'urgent',step:2}});
 await first.write(key,draft);
 const reopened=createDraftStore(storage);
 assert.deepEqual(await reopened.read(key,enterpriseRequestDraft),draft);
 await reopened.write(key,{intent:null,confirmedId:intent().id});
 assert.equal((await reopened.read(key,enterpriseRequestDraft))?.confirmedId,intent().id);
 await reopened.write(key,{intent:null,confirmedId:null});
 assert.deepEqual(await createDraftStore(storage).read(key,enterpriseRequestDraft),{intent:null,confirmedId:null});
});
