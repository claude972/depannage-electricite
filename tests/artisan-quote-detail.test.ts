import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=(n:number)=>({id:id(n),intervention_id:id(200),artisan_id:actor,lines:[{label:'Main d’œuvre',quantity:'2.0',unit_price_cents:'5000',private:'stripped'}],subtotal_cents:10000,tax_rate:20,tax_cents:2000,total_cents:12000,status:'rejected',created_at:'2026-11-01T12:00:00Z',accepted_at:null,intervention:{id:id(200),artisan_id:actor,category:'socket',status:'quoted',address:'PRIVATE'},author:{role:'artisan'}});
function setup(options:{rows?:unknown[];role?:string;error?:boolean;anonymous?:boolean}={}){
 const calls:Array<[string,...unknown[]]>=[];let exact:string|null=null;
 const db={from:(table:string)=>{calls.push(['from',table]);const chain:any={};for(const method of ['select','eq'])chain[method]=(...a:unknown[])=>{calls.push([method,...a]);if(table==='quotes'&&method==='eq'&&a[0]==='id')exact=String(a[1]);return chain};chain.maybeSingle=async()=>({data:{role:options.role??'artisan'},error:null});chain.limit=async(n:number)=>{calls.push(['limit',n]);return{data:options.rows??Array.from({length:35},(_,i)=>quote(i+1)).filter(q=>q.id===exact),error:options.error?{code:'XX000'}:null}};return chain}};
 const route=loadModule('app/api/artisan/quotes/[id]/route.ts',{'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(options.anonymous)throw new ApiError(401,'Session requise');return{db,user:{id:actor}}},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible')}}}) as {GET:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>};
 return{calls,get:(value=id(1),query='')=>route.GET(new Request('https://example.test/api/artisan/quotes/'+value+query),{params:Promise.resolve({id:value})})};
}
test('exact old UUID among 35 revisions: no window20; normalized lines and strict private projection',async()=>{
 const h=setup();const r=await h.get(id(1));assert.equal(r.status,200);const b=await r.json();assert.equal(b.quote.id,id(1));assert.equal(b.quote.status,'rejected');assert.deepEqual(b.quote.lines,[{label:'Main d’œuvre',quantity:2,unit_price_cents:5000}]);assert.deepEqual(Object.keys(b.intervention).sort(),['category','id','status']);assert.equal(b.quote.accepted_total_cents,undefined);assert.ok(!JSON.stringify(b).includes('PRIVATE'));assert.equal(r.headers.get('cache-control'),'private, no-store');assert.ok(h.calls.some(c=>c[0]==='limit'&&c[1]===2));
 for(const field of ['artisan_id','intervention.artisan_id'])assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]===field&&c[2]===actor));
 assert.equal((await setup().get(id(999))).status,404);
});
test('non-disclosure, auth, bad inputs and unavailable states',async()=>{
 assert.equal((await setup({anonymous:true}).get()).status,401);
 for(const role of ['client','manager','admin'])assert.equal((await setup({role}).get()).status,403);
 assert.equal((await setup().get('bad')).status,422);assert.equal((await setup().get(id(1),'?x=1')).status,422);
 for(const rows of [[],[{...quote(1),artisan_id:other}],[{...quote(1),intervention:{...quote(1).intervention,artisan_id:other}}]])assert.equal((await setup({rows}).get()).status,404);
 for(const rows of [[quote(1),quote(1)],[{...quote(1),total_cents:13000}],[{...quote(1),lines:[{label:'x',quantity:'1.1',unit_price_cents:10000}]}]]){const r=await setup({rows}).get();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');}
 assert.equal((await setup({error:true}).get()).status,503);
});
