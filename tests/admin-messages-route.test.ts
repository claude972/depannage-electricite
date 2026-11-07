import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const id='10000000-0000-4000-8000-000000000001',job='10000000-0000-4000-8000-000000000002',actor='10000000-0000-4000-8000-000000000003';
const command={id,intervention_id:job,body:'Support reply'};
const message={...command,author_id:actor,created_at:'2026-11-01T00:00:00Z'};
function harness(options:{result?:unknown;error?:any;unauth?:boolean}={}){
 const calls:unknown[]=[];
 const server={ApiError,authenticatedClient:async()=>{if(options.unauth)throw new ApiError(401,'Connectez-vous.');return{user:{id:actor},db:{rpc:async(...args:unknown[])=>{calls.push(args);return{data:options.result===undefined?message:options.result,error:options.error??null};}}};},assertOrigin:(r:Request)=>{if(r.headers.get('origin')!==new URL(r.url).origin)throw new ApiError(403,'Origine refusée.');},dbError:(e:any)=>{if(e)throw new ApiError(e.code==='42501'?403:e.code==='P0001'?409:e.code==='P0002'?404:503,'Refusé.');}};
 const mod=loadModule('app/api/admin/messages/route.ts',{'@/lib/supabase/server':server}) as {POST:(r:Request)=>Promise<Response>};return{...mod,calls};
}
const post=(body:unknown=command,origin='https://app.example')=>new Request('https://app.example/api/admin/messages',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('actual admin reply route binds stable ID, actor, dossier and content; no-store',async()=>{const h=harness(),r=await h.POST(post({...command,body:'  Support reply  '}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{message});assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[['admin_send_message',{p_id:id,p_intervention_id:job,p_body:'Support reply'}]]);assert.match(r.headers.get('cache-control'),/private.*no-store/);});
test('malformed commands and wrong origin do not emit RPC',async()=>{for(const body of [{...command,body:''},{...command,author_id:actor},{...command,id:'bad'}]){const h=harness();assert.equal((await h.POST(post(body))).status,422);assert.equal(h.calls.length,0);}const h=harness();assert.equal((await h.POST(post(command,'https://evil.example'))).status,403);assert.equal(h.calls.length,0);});
test('denied access, stale command and lost/malformed replies are not successful sends',async()=>{for(const[options,status]of [[{unauth:true},401],[{error:{code:'42501'}},403],[{error:{code:'P0001'}},409],[{error:{code:'P0002'}},404],[{result:null},503],[{result:{...message,author_id:id}},503],[{result:{...message,body:'other'}},503],[{result:{...message,intervention_id:id}},503]]as const){const r=await harness(options).POST(post());assert.equal(r.status,status);assert.match(r.headers.get('cache-control'),/no-store/);if(status===503)assert.equal(r.headers.get('retry-after'),'2');}});
