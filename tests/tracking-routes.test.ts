// Real handler/validation modules, mocked session/RPC/provider; no network or credential access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const require=createRequire(import.meta.url),job='91000000-0000-4000-8000-000000000001',user='91000000-0000-4000-8000-000000000002';
function compile(file:string,imports:Record<string,unknown>){const module={exports:{} as Record<string,any>};vm.runInNewContext(transformSync(readFileSync(new URL(file,import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,{module,exports:module.exports,require:(name:string)=>imports[name]??require(name),Request,Response,URL,Buffer});return module.exports;}
function value(){return {server_time:new Date().toISOString(),permissions:{can_share:false,can_confirm_destination:false},tracking:{intervention_id:job,artisan_id:null,travel_stage:'planned',session_id:null,control_version:0,shared:false,consent_at:null,last_seq:0,destination_version:0,position_state:'stopped',position:null,destination:null}};}
function harness(options:{anonymous?:boolean;code?:string;data?:unknown}={}){
 const calls:{name:string;args:unknown}[]=[];class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
 const db={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:'data'in options?options.data:value(),error:options.code?{code:options.code}:null};}};
 const server={ApiError,authenticatedClient:async()=>{if(options.anonymous)throw new ApiError(401,'Session required');return {db,user:{id:user}};},adminClient:()=>{throw Error('not used');},dbError:(e:any)=>{if(e)throw new ApiError(({42501:403,P0001:409,22023:422,53300:429} as Record<string,number>)[e.code]||503,'DB refusal');},assertOrigin:(r:Request)=>{if(r.headers.get('Origin')!=='https://app.example.test')throw new ApiError(403,'Origin refused');},apiError:(e:any)=>Response.json({error:e.message||'Error'},{status:e.status||500})};
 const state=compile('../lib/features/tracking/state.ts',{}),provider=compile('../lib/features/tracking/provider.ts',{});
 const http=compile('../lib/features/tracking/http.ts',{'@/lib/supabase/server':server,'./state':state,'./provider':provider});
 const validation=compile('../lib/supabase/validation.ts',{'./server':server});
 const imports={'@/lib/supabase/server':server,'@/lib/supabase/validation':validation,'@/lib/features/tracking/state':state,'@/lib/features/tracking/http':{...http,loadRoute:async(_db:unknown,uid:string,id:string)=>{calls.push({name:'route',args:{uid,id}});return {state:'available'};},loadGeocode:async(_db:unknown,uid:string,id:string,query:string)=>{calls.push({name:'geocode',args:{uid,id,query}});return {candidates:[]};}}};
 const route=compile('../app/api/interventions/[id]/tracking/route.ts',imports),routing=compile('../app/api/interventions/[id]/tracking/route/route.ts',imports),geocode=compile('../app/api/interventions/[id]/tracking/geocode/route.ts',imports);
 const ctx=(id=job)=>({params:Promise.resolve({id})});const req=(body?:unknown,origin='https://app.example.test',suffix='')=>new Request('https://app.example.test/api/interventions/'+job+'/tracking'+suffix,body===undefined?undefined:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {calls,get:(suffix='',id=job)=>route.GET(req(undefined,undefined,suffix),ctx(id)),post:(body:unknown,origin?:string)=>route.POST(req(body,origin),ctx()),route:(body:unknown)=>routing.POST(req(body),ctx()),geocode:(body:unknown)=>geocode.POST(req(body),ctx())};
}
test('tracking GET enforces auth, no query extras, exact job and no-store; malformed snapshots fail closed',async()=>{
 assert.equal((await harness({anonymous:true}).get()).status,401);
 const h=harness();const response=await h.get();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(h.calls[0].name,'tracking_snapshot');
 assert.equal((await h.get('?latitude=1')).status,422);assert.equal((await h.get('','bad')).status,422);
 assert.equal((await harness({code:'42501'}).get()).status,404);
 for(const data of [null,{},[],{...value(),tracking:{...value().tracking,intervention_id:user}}])assert.equal((await harness({data}).get()).status,503);
});
test('command POST rejects origin/identity/extra or malformed payload before RPC, and retains explicit SQL statuses',async()=>{
 const command={action:'destination',expected_version:0,payload:{clear:true}};
 const h=harness();assert.equal((await h.post(command,'https://foreign.example.test')).status,403);assert.equal(h.calls.length,0);
 for(const body of [{...command,user_id:user},{...command,expected_version:-1},{...command,payload:{clear:true,latitude:14}},{action:'start',expected_version:0,payload:{session_id:user,consent:false,consent_policy:'tracking-v1'}}])assert.equal((await h.post(body)).status,422);
 assert.equal(h.calls.length,0);assert.equal((await h.post(command)).status,200);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)),{p_id:job,p_action:'destination',p_expected_version:0,p_payload:{clear:true}});
 for(const [code,status] of [['42501',403],['P0001',409],['22023',422],['53300',429]] as const)assert.equal((await harness({code}).post(command)).status,status);
 assert.equal((await harness({data:null}).post(command)).status,503);
});
test('routing accepts no client coordinates or URL; geocode only explicit bounded query and real session identity',async()=>{
 const h=harness();assert.equal((await h.route({url:'http://localhost/',latitude:14})).status,422);assert.equal(h.calls.length,0);
 assert.equal((await h.route({})).status,200);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{name:'route',args:{uid:user,id:job}});
 assert.equal((await h.geocode({query:'Place de la Savane 97200'})).status,200);assert.equal(h.calls[1].name,'geocode');
 assert.equal((await h.geocode({query:'x'})).status,422);assert.equal((await h.geocode({query:'Lieu\u0000secret'})).status,422);assert.equal((await h.geocode({query:'Lieu public',auto_confirm:true})).status,422);
});
