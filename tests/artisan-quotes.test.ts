import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule,ApiError} from './documents/harness';
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const item=(n:number)=>({id:id(n),intervention_id:id(n+1000),artisan_id:actor,status:'sent',total_cents:12000,created_at:'2026-11-01T12:00:00.000001Z',accepted_at:null,intervention:{id:id(n+1000),artisan_id:actor,category:'socket',status:'quoted',address:'PRIVATE'},author:{role:'artisan'},lines:['PRIVATE']});
function harness(opts:{role?:string;rows?:unknown[];error?:boolean;anonymous?:boolean}={}){
 const calls:Array<[string,...unknown[]]>=[];
 const db={from:(table:string)=>{calls.push(['from',table]);const chain:any={};for(const method of ['select','eq','or','order'])chain[method]=(...args:unknown[])=>{calls.push([method,...args]);return chain};chain.maybeSingle=async()=>({data:{role:opts.role??'artisan'},error:null});chain.limit=async(n:number)=>{calls.push(['limit',n]);return{data:opts.rows??[],error:opts.error?{code:'XX000'}:null}};return chain}};
 const mod=loadModule('app/api/artisan/quotes/route.ts',{'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(opts.anonymous)throw new ApiError(401,'Session requise');return{db,user:{id:actor}}},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible')}}}) as {GET:(r:Request)=>Promise<Response>};
 return{get:(query='')=>mod.GET(new Request('https://example.test/api/artisan/quotes'+query)),calls};
}
test('real GET: exact minimal projection, stable cursor beyond bootstrap and constrained query',async()=>{
 const h=harness({rows:Array.from({length:51},(_,i)=>item(150-i))});const r=await h.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');const b=await r.json();assert.equal(b.items.length,50);assert.equal(b.items[0].id,id(150));assert.equal(b.page.has_more,true);assert.deepEqual(Object.keys(b.items[0]).sort(),['accepted_at','created_at','id','intervention','intervention_id','status','total_cents']);assert.deepEqual(Object.keys(b.items[0].intervention).sort(),['category','id','status']);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 for(const pair of [['artisan_id',actor],['intervention.artisan_id',actor],['author.role','artisan']])assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]===pair[0]&&c[2]===pair[1]));
 const next=harness({rows:[item(100)]});const second=await next.get('?cursor='+b.page.next_cursor);assert.equal(second.status,200);assert.ok(next.calls.some(c=>c[0]==='or'&&String(c[1]).includes(id(101))));assert.equal((await second.json()).page.next_cursor,null);
});
test('empty, limits and status filter; actor/filter-bound cursor and strict query',async()=>{
 const h=harness();assert.deepEqual((await (await h.get('?limit=1&status=accepted')).json()).items,[]);assert.ok(h.calls.some(c=>c[0]==='limit'&&c[1]===2));assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='accepted'));
 for(const query of ['?limit=0','?limit=51','?limit=01','?status=draft','?status=all&status=sent','?q=x','?cursor=%%%'])assert.equal((await harness().get(query)).status,422);
 for(const value of [{v:1,actor:other,status:'all',at:item(1).created_at,id:id(1)},{v:1,actor,status:'accepted',at:item(1).created_at,id:id(1)}])assert.equal((await harness().get('?cursor='+Buffer.from(JSON.stringify(value)).toString('base64url'))).status,422);
});
test('current role denied; malformed/foreign/reassigned rows fail closed; unavailable bounded',async()=>{
 assert.equal((await harness({anonymous:true}).get()).status,401);
 for(const role of ['client','manager','admin','suspended']){const h=harness({role});assert.equal((await h.get()).status,403);assert.ok(!h.calls.some(c=>c[0]==='from'&&c[1]==='quotes'));}
 for(const rows of [[{...item(1),artisan_id:other}],[{...item(1),intervention:{...item(1).intervention,artisan_id:other}}],[{...item(1),author:{role:'client'}}],[item(1),item(1)],[item(1),item(2)],[{...item(1),total_cents:0}]]){const r=await harness({rows}).get();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');assert.ok(!(await r.text()).includes('PRIVATE'));}
 assert.equal((await harness({error:true}).get()).status,503);
});
