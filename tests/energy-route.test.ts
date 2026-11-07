import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, ApiError } from "./documents/harness";
const site="10000000-0000-4000-8000-000000000002",id="10000000-0000-4000-8000-000000000001";
const values={meter_label:"Compteur A",period_start:"2026-01-01",period_end:"2026-01-31",consumption_wh:1250500,cost_cents:40000,source_kind:"invoice",source_reference:"Facture QA exemple",note:""};
const row=(n=1)=>({...values,id:`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`,site_id:site,version:1,created_by:id,updated_by:id,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",archived_at:null});
function harness(options:{records?:unknown;count?:number|null;rights?:unknown;siteVisible?:boolean;unauth?:boolean;rpcResult?:unknown;rpcError?:unknown}={}){
 const calls:any[]=[];
 const db={from(table:string){calls.push(["from",table]);const q:any={};for(const name of ["select","eq","is","order","limit","gte","lte","or"])q[name]=(...args:any[])=>{calls.push([name,...args]);return q;};q.maybeSingle=async()=>({data:options.siteVisible===false?null:{id:site},error:null});q.then=(resolve:any)=>resolve({data:options.records??[row()],count:options.count===undefined?1:options.count,error:null});return q;},async rpc(name:string,args:unknown){calls.push(["rpc",name,args]);return name==="can_manage_site"?{data:options.rights===undefined?true:options.rights,error:null}:{data:options.rpcResult===undefined?row():options.rpcResult,error:options.rpcError??null};}};
 const server={ApiError,authenticatedClient:async()=>{if(options.unauth)throw new ApiError(401,"Connectez-vous.");return{db,user:{id}};},assertOrigin:(r:Request)=>{if(r.headers.get("origin")&&r.headers.get("origin")!==new URL(r.url).origin)throw new ApiError(403,"Origine refusée.");},dbError:(e:any)=>{if(e)throw new ApiError(e.code==="42501"?403:e.code==="P0001"?409:503,"Action refusée.");}};
 const exports=loadModule("app/api/sites/[id]/energy/route.ts", {"@/lib/supabase/server":server}) as any;
 return{...exports,calls};
}
const context={params:Promise.resolve({id:site})};
const get=(suffix="")=>new Request(`https://app.example/api/sites/${site}/energy${suffix}`);
const post=(body:unknown,origin="https://app.example")=>new Request(`https://app.example/api/sites/${site}/energy`,{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
test("actual energy GET uses caller-scoped site and exact count; returns private validated totals",async()=>{
 const h=harness();const r=await h.GET(get(),context);assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"private, no-store");const b=await r.json();assert.equal(b.totals.consumption_wh,1250500);assert.equal(b.permissions.can_write,true);
 assert.ok(h.calls.some((c:any)=>c[0]==="select"&&c[2]?.count==="exact"));assert.ok(h.calls.some((c:any)=>c[0]==="eq"&&c[1]==="site_id"&&c[2]===site));
});
test("actual energy GET fails closed on anonymous, invisible site, malformed rows/count/rights and provider caps",async()=>{
 for(const[opts,status]of [[{unauth:true},401],[{siteVisible:false},404],[{rights:null},503],[{count:null},503],[{count:101,records:[row()]},503],[{records:[{...row(),site_id:id}]},503],[{records:[row(),row()],count:2},503]]as const){const r=await harness(opts).GET(get(),context);assert.equal(r.status,status,JSON.stringify(opts));assert.equal(r.headers.get("cache-control"),"private, no-store");}
});
test("cursor pages cannot pretend to be complete totals, including the final page",async()=>{
 const records=Array.from({length:100},(_,i)=>row(i+1));const first=await harness({records,count:101}).GET(get(),context);assert.equal(first.status,200);const b=await first.json();assert.equal(b.page.has_more,true);assert.equal(b.totals.complete,false);assert.equal(b.totals.consumption_wh,null);
 assert.equal((await harness().GET(get('?cursor='+b.page.next_cursor+'&from=2026-01-01'),context)).status,422);
 const foreign={params:Promise.resolve({id:'10000000-0000-4000-8000-000000000003'})};
 assert.equal((await harness().GET(get('?cursor='+b.page.next_cursor),foreign)).status,422);
 const last=await harness({records:[row(101)],count:1}).GET(get('?cursor='+b.page.next_cursor),context);const end=await last.json();assert.equal(last.status,200);assert.equal(end.page.has_more,false);assert.equal(end.page.next_cursor,null);assert.equal(end.totals.complete,false);assert.equal(end.totals.cost_cents,null);
});
test("filters and cursor reject malformed or duplicate input before querying periods",async()=>{
 for(const s of ['?from=2026-02-30','?from=2026-02-01&to=2026-01-01','?cursor=bad%2Fvalue','?from=2026-01-01&from=2026-01-01','?site_id='+id]){const h=harness();const r=await h.GET(get(s),context);assert.equal(r.status,422,s);assert.ok(!h.calls.some((c:any)=>c[0]==="from"&&c[1]==="site_energy_periods"));}
});
test("actual POST validates and binds save to URL site, stable ID and expected version",async()=>{
 const h=harness();const r=await h.POST(post({action:"save",id,expected_version:null,values}),context);assert.equal(r.status,200);const call=h.calls.find((c:any)=>c[0]==="rpc"&&c[1]==="save_site_energy_period");assert.equal(call[2].p_site_id,site);assert.equal(call[2].p_id,id);assert.equal(call[2].p_expected_version,null);assert.equal(r.headers.get('cache-control'),'private, no-store');
 for(const body of [{action:"save",id,expected_version:null,values:{...values,consumption_wh:-1}},{action:"save",id,expected_version:null,values,site_id:id}]){const bad=harness();assert.equal((await bad.POST(post(body),context)).status,422);assert.equal(bad.calls.filter((c:any)=>c[0]==="rpc").length,0);}
});
test("POST origin/auth/RLS failures or mismatching success never become confirmed persistence",async()=>{
 const body={action:"save",id,expected_version:null,values};
 for(const[opts,status]of [[{unauth:true},401],[{siteVisible:false},404],[{rpcError:{code:'42501'}},403],[{rpcError:{code:'P0001'}},409],[{rpcResult:null},503],[{rpcResult:{...row(),consumption_wh:3}},503],[{rpcResult:{...row(),version:3}},503]]as const)assert.equal((await harness(opts).POST(post(body),context)).status,status);
 const h=harness();assert.equal((await h.POST(post(body,'https://evil.example'),context)).status,403);assert.equal(h.calls.length,0);
 const archived={...row(),version:2,archived_at:'2026-02-01T00:00:00Z'};assert.equal((await harness({rpcResult:archived}).POST(post({action:'archive',id,expected_version:1}),context)).status,200);
 assert.equal((await harness().POST(post({action:'archive',id,expected_version:1}),context)).status,503);
});
