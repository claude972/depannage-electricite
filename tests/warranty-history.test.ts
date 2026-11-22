import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const id = (n:number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), job=id(2);
const row=(n:number)=>({id:id(n),intervention_id:job,client_id:actor,description:'QA problème déclaré',status:'resolved',resolution:'',created_at:'2026-11-07T12:00:00.123456Z',updated_at:'2026-11-07T12:00:00.123456Z',terms_version:null});
type Options={rows?:unknown[];active?:unknown[];hidden?:boolean;revoke?:boolean;error?:boolean;gate?:unknown;anonymous?:boolean};
function setup(o:Options={}){
 let access=0;const calls:unknown[][]=[];
 const db={rpc:async()=>({error:null,data:o.gate??false}),from(table:string){let fields='';const q:any={};
 for(const method of ['select','eq','in','or','order'])q[method]=(...args:unknown[])=>{calls.push([table,method,...args]);if(method==='select')fields=String(args[0]);return q;};
 q.limit=async(n:number)=>{calls.push([table,'limit',n]);if(table==='interventions'){access++;return{error:null,data:o.hidden||(o.revoke&&access>1)?[]:[{id:job}]};}return{error:o.error?{}:null,data:fields==='id,intervention_id,status'?o.active??[]:o.rows??[]};};return q;}};
 const route=loadModule('app/api/warranty/route.ts',{'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(o.anonymous)throw new ApiError(401,'Session');return{db,user:{id:actor}};},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible');}}}) as any;
 return {calls,get:(query='')=>route.GET(new Request('https://example.test/api/warranty'+query))};
}
test('100+1 stable page, cursor scope and microseconds, minimal projection',async()=>{
 const h=setup({rows:Array.from({length:101},(_,n)=>({...row(200-n),secret:'PRIVATE'}))});const r=await h.get();assert.equal(r.status,200);const b=await r.json();assert.equal(b.cases.length,100);assert.equal(b.has_active,null);assert.equal(b.enabled,false);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 const cursor=JSON.parse(Buffer.from(b.next_cursor,'base64url').toString());assert.equal(cursor.at,'2026-11-07T12:00:00.123456Z');
 const next=setup({rows:[row(100)]});assert.equal((await next.get('?cursor='+b.next_cursor)).status,200);assert.ok(next.calls.some(c=>c[1]==='or'&&String(c[2]).includes('.123456Z')));
 assert.equal((await setup().get('?intervention_id='+job+'&cursor='+b.next_cursor)).status,422);
 cursor.actor=id(7);assert.equal((await setup().get('?cursor='+Buffer.from(JSON.stringify(cursor)).toString('base64url'))).status,422);
});
test('filtered active proof independent of visible page; no active case is proven',async()=>{
 const h=setup({rows:[row(20)],active:[{id:id(3),intervention_id:job,status:'reviewing'}]});const r=await h.get('?intervention_id='+job);assert.equal(r.status,200);assert.equal((await r.json()).has_active,true);assert.ok(h.calls.some(c=>c[0]==='warranty_cases'&&c[1]==='in'&&c[2]==='status'));
 const empty=await setup().get('?intervention_id='+job);assert.deepEqual(await empty.json(),{cases:[],enabled:false,next_cursor:null,has_active:false});assert.equal(empty.headers.get('cache-control'),'private, no-store');
});
test('scope refusals, revoke, malformed data and errors fail closed',async()=>{
 for(const o of [{hidden:true},{revoke:true}])assert.equal((await setup(o).get('?intervention_id='+job)).status,404);
 assert.equal((await setup({anonymous:true}).get()).status,401);
 for(const q of ['?unknown=x','?intervention_id=bad','?cursor=bad','?cursor=a&cursor=b'])assert.equal((await setup().get(q)).status,422);
 for(const o of [{error:true},{gate:'true'},{rows:[{}]},{rows:[row(3),row(4)]},{rows:[{...row(3),intervention_id:id(5)}]},{active:[{id:id(3),intervention_id:id(5),status:'reviewing'}]}]){
 const r=await setup(o).get('?intervention_id='+job);assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');assert.equal(r.headers.get('cache-control'),'private, no-store');}
});
