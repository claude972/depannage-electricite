import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const require=createRequire(import.meta.url);
function compile(file:string,imports:Record<string,unknown>={},globals:Record<string,unknown>={}){const module={exports:{} as Record<string,any>};vm.runInNewContext(transformSync(readFileSync(new URL(file,import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,{module,exports:module.exports,require:(id:string)=>imports[id]??require(id),URL,URLSearchParams,Response,Request,ReadableStream,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date,...globals});return module.exports;}
const state=compile('../lib/features/tracking/state.ts'),provider=compile('../lib/features/tracking/provider.ts');
const id=(n:number)=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function sample(job=id(1),offset=0){const now=new Date().toISOString();return {server_time:now,permissions:{can_share:true,can_confirm_destination:true},tracking:{intervention_id:job,artisan_id:id(10),travel_stage:'en_route',session_id:id(20),control_version:2,shared:true,consent_at:now,last_seq:1,destination_version:1,position_state:'fresh',position:{latitude:14.60+offset,longitude:-61.06,accuracy_m:10,sampled_at:now,received_at:now},destination:{latitude:14.61+offset,longitude:-61.05,label:'Lieu public QA',source:'manual',confirmed_by:id(30),confirmed_at:now}}};}
function route(s=sample()){const p=s.tracking.position,d=s.tracking.destination;return {resource:'bdtopo-valhalla',resourceVersion:'2026-10-29',profile:'car',optimization:'fastest',crs:'EPSG:4326',distanceUnit:'meter',timeUnit:'second',distance:2000,duration:300,start:`${p.longitude},${p.latitude}`,end:`${d.longitude},${d.latitude}`,geometry:{type:'LineString',coordinates:[[p.longitude,p.latitude],[d.longitude,d.latitude]]}};}
const plain=(v:unknown)=>JSON.parse(JSON.stringify(v));
test('strict commands and snapshot reject identity spoof, missing consent, mixed clear and inconsistent position',()=>{
 assert.equal(state.commandSchema.safeParse({action:'start',expected_version:0,payload:{session_id:id(20),consent:true,consent_policy:'tracking-v1'}}).success,true);
 for(const input of [{action:'start',expected_version:0,payload:{session_id:id(20),consent:false,consent_policy:'tracking-v1'}},{action:'destination',expected_version:1,payload:{clear:true,latitude:14}},{action:'point',expected_version:0,payload:{session_id:id(20),seq:1,latitude:NaN,longitude:0,accuracy_m:10,sampled_at:new Date().toISOString()}},{action:'stop',expected_version:1,payload:{session_id:id(20)},user_id:id(1)}])assert.equal(state.commandSchema.safeParse(input).success,false);
 const s=sample();assert.equal(state.snapshotSchema.safeParse(s).success,true);s.tracking.shared=false;assert.equal(state.snapshotSchema.safeParse(s).success,false);
});
test('cache isolates two jobs with same artisan/session/counters and also reader identity, bounds size and expiry',()=>{
 const a=sample(id(1)),b=sample(id(2),.02);assert.notEqual(state.trackingKey(a,id(30),'route'),state.trackingKey(b,id(30),'route'));assert.notEqual(state.trackingKey(a,id(30),'route'),state.trackingKey(a,id(31),'route'));
 const cache=new state.TrackingCache(2,30);cache.set('a',1,0);cache.set('b',2,0);cache.set('c',3,0);assert.equal(cache.get('a',1),null);assert.equal(cache.get('b',1),2);assert.equal(cache.get('c',31),null);
});
test('freshness is based on both sample and receipt and never uses a stale/future point',()=>{
 const s=sample(),now=Date.now();assert.equal(state.pointFresh(s,now),true);s.tracking.position.sampled_at=new Date(now-61000).toISOString();assert.equal(state.pointFresh(s,now),false);s.tracking.position.sampled_at=new Date(now+6000).toISOString();assert.equal(state.pointFresh(s,now),false);
});
test('IGN parser accepts observed shape and units, keeps snapped points separate and rejects incompatible/far geometry',()=>{
 const s=sample(),r=route(s);const parsed=provider.parseRoute(r,s);assert.equal(parsed.duration_s,300);assert.equal(parsed.traffic,'not_available');assert.equal(parsed.source,'IGN Géoplateforme / BD TOPO');
 for(const bad of [{...r,timeUnit:'minute'},{...r,resource:'bdtopo-osrm'},{...r,duration:-1},{...r,geometry:JSON.stringify(r.geometry)},{...r,end:'0,0'},{...r,geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}])assert.throws(()=>provider.parseRoute(bad,s));
 assert.equal(provider.routeUrl(s).hostname,'data.geopf.fr');assert.equal(provider.routeUrl(s).pathname,'/navigation/itineraire');
});
test('geocode keeps ambiguous candidates with type/score and never chooses a destination',()=>{
 const result=provider.parseGeocode({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-61.067498,14.603217]},properties:{label:'Place de la Savane 97200 Fort-de-France',score:.825,type:'locality'}},{type:'Feature',geometry:{type:'Point',coordinates:[-61.07,14.60]},properties:{label:'Autre lieu',score:.446,type:'street'}}]});
 assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].type,'locality');assert.equal('destination'in result,false);assert.throws(()=>provider.parseGeocode({type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[999,0]}}]}));
});
test('provider network rejects SSRF, 429, nonJSON and oversized streams, with fixed no-redirect endpoint',async()=>{
 await assert.rejects(()=>provider.providerJson(new URL('https://attacker.invalid/navigation/itineraire'),async()=>{throw Error('must not fetch');}));
 let seen=false;await assert.rejects(()=>provider.providerJson(provider.routeUrl(sample()),async(_url:unknown,options:RequestInit)=>{seen=options.redirect==='error'&&options.cache==='no-store';return new Response('{}',{status:429,headers:{'Retry-After':'500'}});}),e=>(e as any).reason==='provider_quota'&&(e as any).retryAfter===60);assert.equal(seen,true);
 await assert.rejects(()=>provider.providerJson(provider.routeUrl(sample()),async()=>new Response('html',{headers:{'Content-Type':'text/html'}})),e=>(e as any).reason==='invalid_provider_response');
 await assert.rejects(()=>provider.providerJson(provider.routeUrl(sample()),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(600000));c.enqueue(new Uint8Array(600000));c.close();}}),{headers:{'Content-Type':'application/json'}})),e=>(e as any).reason==='invalid_provider_response');
 const fast=compile('../lib/features/tracking/provider.ts',{}, {setTimeout:(fn:()=>void)=>setTimeout(fn,0)});
 await assert.rejects(()=>fast.providerJson(provider.routeUrl(sample()),async(_u:unknown,o:RequestInit)=>new Promise((_r,reject)=>o.signal!.addEventListener('abort',()=>reject(Error('aborted'))))),e=>(e as any).reason==='provider_timeout');
});
function httpHarness(getSnapshot:()=>unknown,requestProvider:(url:URL)=>unknown,onClaim?:()=>Promise<void>){
 const calls:{rpc:string;args:unknown}[]=[];class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
 const admin={rpc:async(rpc:string,args:unknown)=>{calls.push({rpc,args});if(rpc==='claim_tracking_provider'&&onClaim)await onClaim();return {data:{allowed:true,retry_after_s:0},error:null};}};
 const db={rpc:async()=>{const v=getSnapshot();return v==='revoked'?{data:null,error:{code:'42501'}}:{data:v,error:null};}};
 const helpers={ApiError,dbError:(e:unknown)=>{if(e)throw new ApiError(503,'DB unavailable');},adminClient:()=>admin,apiError:(e:any)=>Response.json({error:e.message},{status:e.status||500})};
 const module=compile('../lib/features/tracking/http.ts',{'@/lib/supabase/server':helpers,'./state':state,'./provider':{...provider,providerJson:async(url:URL)=>requestProvider(url)}});
 return {module,db,calls};
}
test('actual route loader cannot cross-hit jobs sharing a UUID and counters; cached result still rechecks rights',async()=>{
 const a=sample(id(101)),b=sample(id(102),.02);let current=a;let count=0;
 const h=httpHarness(()=>current,()=>{count++;return route(current);});
 const ar=await h.module.loadRoute(h.db,id(30),a.tracking.intervention_id);current=b;const br=await h.module.loadRoute(h.db,id(30),b.tracking.intervention_id);current=a;const again=await h.module.loadRoute(h.db,id(30),a.tracking.intervention_id);
 assert.notDeepEqual(plain(ar.geometry),plain(br.geometry));assert.deepEqual(plain(again.geometry),plain(ar.geometry));assert.equal(count,2);
 assert.notEqual((h.calls[0].args as any).p_key,(h.calls[1].args as any).p_key);
 current='revoked' as any;await assert.rejects(()=>h.module.loadRoute(h.db,id(30),a.tracking.intervention_id),e=>(e as any).status===404);
});
test('late provider response after revocation or new point is rejected without caching stale geometry',async()=>{
 for(const change of ['revoked','point']){const original=sample(id(change==='point'?202:201));let current:any=original;
 const h=httpHarness(()=>current,()=>{const value=route(original);current=change==='revoked'?'revoked':{...original,tracking:{...original.tracking,last_seq:2}};return value;});
 await assert.rejects(()=>h.module.loadRoute(h.db,id(30),original.tracking.intervention_id),e=>(e as any).status===(change==='revoked'?404:409));
 }
});
test('geocoding works before GPS starts but rechecks destination write permission after provider await',async()=>{
 const s=sample(id(301));Object.assign(s.tracking,{shared:false,session_id:null,consent_at:null,last_seq:0,position:null,position_state:'stopped'});let current=s;
 const value={type:'FeatureCollection',features:[]};const h=httpHarness(()=>current,()=>value);const result=await h.module.loadGeocode(h.db,id(30),s.tracking.intervention_id,'Lieu public QA');assert.equal(result.candidates.length,0);
 const denied=httpHarness(()=>current,()=>{current={...s,permissions:{...s.permissions,can_confirm_destination:false}};return value;});await assert.rejects(()=>denied.module.loadGeocode(denied.db,id(30),s.tracking.intervention_id,'Autre lieu public QA'),e=>(e as any).status===403);
});
test('missing or malformed tracking RPC never becomes a successful snapshot',async()=>{
 for(const value of [null,{},[],{...sample(),tracking:{...sample().tracking,intervention_id:id(99)}}]){const h=httpHarness(()=>value,()=>route());await assert.rejects(()=>h.module.snapshot(h.db,id(1)),e=>(e as any).status===503);}
});

function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
test('quota-wait route revocation, stop or newer point prevents every external provider call',async()=>{
 for(const [index,change] of ['revoked','stop','point'].entries()){
  const original=sample(id(401+index));let current:any=original;let providerCalls=0;const entered=deferred(),finish=deferred();
  const h=httpHarness(()=>current,()=>{providerCalls++;return route(original);},async()=>{entered.release();await finish.promise;});
  const pending=h.module.loadRoute(h.db,id(30),original.tracking.intervention_id);
  await entered.promise;
  current=change==='revoked'?'revoked':change==='point'?{...original,tracking:{...original.tracking,last_seq:2}}:{...original,tracking:{...original.tracking,control_version:3,shared:false,session_id:null,consent_at:null,position:null,position_state:'stopped'}};
  finish.release();await assert.rejects(pending,e=>(e as any).status===(change==='revoked'?404:409));assert.equal(providerCalls,0,change+' must not emit coordinates');
 }
});
test('quota-wait geocode rechecks write right and context before emission without requiring an active GPS point',async()=>{
 for(const [index,change] of ['revoked','permission','version'].entries()){
  const original=sample(id(501+index));Object.assign(original.tracking,{shared:false,session_id:null,consent_at:null,last_seq:0,position:null,position_state:'stopped'});let current:any=original;let providerCalls=0;const entered=deferred(),finish=deferred();
  const h=httpHarness(()=>current,()=>{providerCalls++;return {type:'FeatureCollection',features:[]};},async()=>{entered.release();await finish.promise;});
  const pending=h.module.loadGeocode(h.db,id(30),original.tracking.intervention_id,'Lieu public QA');await entered.promise;
  current=change==='revoked'?'revoked':change==='permission'?{...original,permissions:{...original.permissions,can_confirm_destination:false}}:{...original,tracking:{...original.tracking,control_version:3}};
  finish.release();await assert.rejects(pending,e=>(e as any).status===(change==='revoked'?404:change==='permission'?403:409));assert.equal(providerCalls,0,change+' must not emit the search');
 }
});
