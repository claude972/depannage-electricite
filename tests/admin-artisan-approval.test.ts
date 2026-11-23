import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`,stamp="2026-11-01T12:00:00Z";
const artisan=(n:number)=>({id:id(n),full_name:`QA ${n}`,artisan_approved:false,created_at:stamp});
function fixture(options:{auth?:boolean;role?:string;count?:number;rows?:unknown[];applications?:unknown;appCount?:number;appError?:boolean;error?:{code:string;message:string};transport?:boolean}={}){
 const calls:{table:string;url:URL;body:unknown}[]=[];
 const db=createClient("https://example.supabase.co","fake-publishable-key",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),table=url.pathname.split('/').at(-1)!;let body:unknown=null;try{body=JSON.parse(String(init?.body))}catch{}calls.push({table,url,body});
  if(options.transport)throw Error("PRIVATE");
  // This harness models a database without the one-transaction command (migration 20261123090000): PostgREST answers PGRST202 and the route uses the two-step path asserted below.
  if(table==="record_artisan_application_decision")return Response.json({code:"PGRST202",message:"Could not find the function"},{status:404});
  if(table==="decide_artisan_application")return options.error?Response.json(options.error,{status:400}):Response.json(null);
  if(table==="profiles"&&url.searchParams.get("select")==="role")return Response.json({role:options.role??"admin"});
  const rows=options.rows??[artisan(1)],apps=options.applications??[{user_id:id(1),application_status:"submitted",application_version:1}];
  if(table==="artisan_profiles"){if(options.appError)return Response.json({code:"PRIVATE",message:"PRIVATE"},{status:503});return Response.json(apps,{headers:{"Content-Range":`*/${options.appCount??(Array.isArray(apps)?apps.length:0)}`}})}
  return Response.json(rows,{headers:{"Content-Range":`*/${options.count??rows.length}`}});
 }}});
 const helpers=fakeServerHelpers({authenticated:options.auth,db});const mod=loadModule("app/api/admin/artisans/route.ts",{"@/lib/supabase/server":helpers});
 return{calls,get:()=> (mod.GET as()=>Promise<Response>)(),post:(body:unknown={user_id:id(1),command_id:id(99),action:"approve",expected_version:1},origin="https://app.example.test")=>(mod.POST as(r:Request)=>Promise<Response>)(new Request("https://app.example.test/api/admin/artisans",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)}))};
}
async function result(r:Response,status:number){assert.equal(r.status,status);assert.equal(r.headers.get("cache-control"),"private, no-store");const text=await r.text();assert.doesNotMatch(text,/PRIVATE|A complete submitted/);return JSON.parse(text)}
test("real GET uses same admin SDK/RLS session, returns actual status or null, and L101 truncation",async()=>{
 for(const n of[0,1,100,101]){const rows=Array.from({length:n},(_,i)=>artisan(i+1));const f=fixture({rows,applications:n?[{user_id:id(1),application_status:"suspended",application_version:2}]:[]});const b=await result(await f.get(),200);assert.equal(b.limit,100);assert.equal(b.truncated,n>100);assert.equal(b.artisans.length,Math.min(n,100));if(n){assert.equal(b.artisans[0].application_status,"suspended");if(n>1)assert.equal(b.artisans[1].application_status,null)}assert.equal(f.calls.find(c=>c.table==="profiles"&&c.url.searchParams.get("select")!=="role")?.url.searchParams.get("limit"),"101");if(n)assert.ok(!f.calls.find(c=>c.table==="artisan_profiles")!.url.searchParams.get("user_id")!.includes(id(101)));}
});
test("missing/foreign/duplicate/malformed/capped application evidence is503, never pending",async()=>{
 for(const options of [{appError:true},{applications:{}},{applications:[{user_id:id(1),application_status:"unknown"}]},{applications:[{user_id:id(2),application_status:"submitted",application_version:1}]},{applications:[{user_id:id(1),application_status:"submitted",application_version:1},{user_id:id(1),application_status:"submitted",application_version:1}],rows:[artisan(1),artisan(2)]},{applications:[],appCount:1},{rows:[artisan(1)],count:102},{rows:[{...artisan(1),private:"no"}]},{transport:true}])await result(await fixture(options).get(),503);
});
test("exact incomplete-dossier P0001 becomes422 French, other conflicts stay409; no-store on all paths",async()=>{
 const exact="A complete submitted application is required for approval or reinstatement";const f=fixture({error:{code:"P0001",message:exact}});const b=await result(await f.post(),422);assert.match(b.error,/dossier complet et soumis/);assert.deepEqual(f.calls.find(c=>c.table==="decide_artisan_application")!.body,{p_user_id:id(1),p_action:"approve",p_expected_version:1,p_command_id:id(99)});assert.deepEqual(f.calls[0].body,{p_user_id:id(1),p_action:"approve",p_expected_version:1,p_command_id:id(99),p_reason:null,p_definitive:false});
 await result(await fixture({error:{code:"P0001",message:exact+" extra"}}).post(),409);await result(await fixture().post(),200);await result(await fixture().post({user_id:"bad",action:"approve",expected_version:1}),422);await result(await fixture().post(undefined,"https://foreign.test"),403);
});
test("anonymous and non-admin GET are refused before collection reads",async()=>{for(const [options,status]of[[{auth:false},401],[{role:"client"},403],[{role:"manager"},403]]as const){const f=fixture(options);await result(await f.get(),status);assert.equal(f.calls.some(c=>c.table==="artisan_profiles"),false)}await result(await fixture({auth:false}).post(),401)});
