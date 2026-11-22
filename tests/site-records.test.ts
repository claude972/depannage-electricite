import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule,ApiError} from './documents/harness';
const actor='10000000-0000-4000-8000-000000000001',site='20000000-0000-4000-8000-000000000001';
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const job=(n:number)=>({id:id(n),site_id:site,category:'socket',urgency:'scheduled',status:'requested',created_at:'2026-11-07T12:00:00.123456Z',client_id:'PRIVATE'});
const compliance=(n:number)=>({id:id(n),site_id:site,title:'QA',kind:'audit',due_on:'2026-01-01',status:'pending',notes:'QA',created_by:'PRIVATE'});
function setup(options:{rows?:unknown[];role?:string;hidden?:boolean;revoke?:boolean;error?:boolean;anonymous?:boolean}={}){
 const calls:Array<[string,...unknown[]]>=[];let reads=0;
 const db={from:(table:string)=>{calls.push(['from',table]);const c:any={};for(const m of ['select','eq','in','order','or'])c[m]=(...args:unknown[])=>{calls.push([m,...args]);return c};c.maybeSingle=async()=>({error:null,data:table==='profiles'?{role:options.role??'manager'}:options.hidden||(options.revoke&&reads>0)?null:{id:site}});c.limit=async(n:number)=>{reads++;calls.push(['limit',n]);return{data:options.rows??[],error:options.error?{code:'XX000'}:null}};return c}};
 const route=loadModule('app/api/sites/[id]/records/route.ts',{'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(options.anonymous)throw new ApiError(401,'Session');return{db,user:{id:actor}}},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible')}}}) as {GET:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>};
 return{calls,get:(q='kind=open',target=site)=>route.GET(new Request('https://example.test/api/sites/'+target+'/records?'+q),{params:Promise.resolve({id:target})})};
}
test('jobs exact projection and stable next cursor; oldest page beyond100',async()=>{
 const h=setup({rows:Array.from({length:51},(_,n)=>job(151-n))});const r=await h.get();assert.equal(r.status,200);const b=await r.json();assert.equal(b.items.length,50);assert.equal(b.page.has_more,true);assert.ok(!JSON.stringify(b).includes('PRIVATE'));assert.deepEqual(Object.keys(b.items[0]).sort(),['category','created_at','id','site_id','status','urgency']);
 const n=setup({rows:[job(101)]});assert.equal((await n.get('kind=open&cursor='+b.page.next_cursor)).status,200);assert.ok(n.calls.some(c=>c[0]==='or'&&String(c[1]).includes('id.lt.')));assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='site_id'&&c[2]===site));
 assert.equal((await setup().get('kind=past&cursor='+b.page.next_cursor)).status,422);
});
test('compliance pagination includes past due, audit/all statuses, completed and minimal fields',async()=>{
 const h=setup({rows:Array.from({length:51},(_,n)=>compliance(251+n))});const r=await h.get('kind=upcoming');assert.equal(r.status,200);const b=await r.json();assert.equal(b.page.has_more,true);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 const n=setup({rows:[compliance(301)]});assert.equal((await n.get('kind=upcoming&cursor='+b.page.next_cursor)).status,200);assert.ok(n.calls.some(c=>c[0]==='or'&&String(c[1]).includes('id.gt.')));
 for(const kind of ['audits','completed']){const h=setup({rows:[{...compliance(1),status:'completed'}]});assert.equal((await h.get('kind='+kind)).status,200)}
 assert.equal((await setup({rows:[{...compliance(1),kind:'maintenance'}]}).get('kind=audits')).status,503);
});
test('role/site access including post-read revocation, empty, validation and fail closed',async()=>{
 assert.equal((await setup({anonymous:true}).get()).status,401);
 for(const role of ['admin','artisan','client'])assert.equal((await setup({role}).get()).status,403);
 for(const opts of [{hidden:true},{revoke:true}])assert.equal((await setup(opts).get()).status,404);
 const empty=await setup().get();assert.equal(empty.headers.get('cache-control'),'private, no-store');assert.deepEqual((await empty.json()).page,{limit:50,has_more:false,next_cursor:null});
 for(const q of ['', 'kind=x','kind=open&kind=past','kind=open&limit=50','kind=open&cursor=%%%'])assert.equal((await setup().get(q)).status,422);
 for(const rows of [[job(1),job(2)],[job(1),job(1)],[{...job(1),site_id:id(7)}],[{...job(1),status:'paid'}],[{...job(1),urgency:'unknown'}]]){const r=await setup({rows}).get();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2')}
 assert.equal((await setup({error:true}).get()).status,503);
});

test('timestamp ordering preserves PostgreSQL microseconds and cursor identity',async()=>{
 const h=setup({rows:[{...job(1),created_at:'2026-11-07T12:00:00.123457Z'},{...job(2),created_at:'2026-11-07T12:00:00.123456Z'}]});
 assert.equal((await h.get()).status,200);
 for(const patch of [{actor:id(99)},{site:id(99)},{at:'2026-01-01)'}]){
  const cursor=Buffer.from(JSON.stringify({v:1,actor,site,kind:'open',at:'2026-11-07T12:00:00.123456Z',id:id(1),...patch})).toString('base64url');
  assert.equal((await setup().get('kind=open&cursor='+cursor)).status,422);
 }
 assert.equal((await setup({rows:[{...job(1),status:'paid'}]}).get('kind=past')).status,200);
});
