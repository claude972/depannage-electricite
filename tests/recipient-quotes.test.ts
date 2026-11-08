import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),org=id(2),site=id(3),job=id(4);
const intervention={id:job,client_id:actor,site_id:site,category:'panel',status:'quoted'};
const quote=(n:number)=>({id:id(n),intervention_id:job,artisan_id:id(5),lines:[{label:'QA',quantity:1,unit_price_cents:10000}],subtotal_cents:10000,tax_rate:0,tax_cents:0,total_cents:10000,status:'rejected',created_at:'2026-11-07T12:00:00.123456Z',accepted_at:null,intervention:{...intervention,address:'PRIVATE'}});
type Options={rows?:unknown[];active?:unknown[];role?:string;noMember?:boolean;hidden?:boolean;revoked?:boolean;changedRole?:boolean;activeError?:boolean;anonymous?:boolean};
function setup(o:Options={}){
 let rowRead=false;const calls:unknown[][]=[];
 const db={from(table:string){const c:any={};let projection='';calls.push(['from',table]);
 for(const method of ['select','eq','in','order','or'])c[method]=(...args:unknown[])=>{calls.push([method,...args]);if(method==='select')projection=String(args[0]);return c};
 c.maybeSingle=async()=>({error:null,data:table==='profiles'?{role:o.changedRole&&rowRead?'artisan':o.role??'client'}:o.noMember?null:{organization_id:org,user_id:actor}});
 c.limit=async(n:number)=>{calls.push(['limit',n]);
 if(table==='sites')return{error:null,data:o.hidden||(o.revoked&&rowRead)?[]:[{id:site,organization_id:org}]};
 if(table==='interventions')return{error:null,data:o.revoked?[]:[intervention]};
 if(projection==='id,intervention_id,status')return{error:o.activeError?{code:'XX000'}:null,data:o.active??[{id:id(99),intervention_id:job,status:'sent'}]};
 rowRead=true;return{error:null,data:o.rows??[]};};return c;}};
 const stubs={'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(o.anonymous)throw new ApiError(401,'Session');return{db,user:{id:actor}}},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible')}}};
 const list=loadModule('app/api/quotes/route.ts',stubs) as any,detail=loadModule('app/api/quotes/[id]/route.ts',stubs) as any;
 return{calls,list:(q='')=>list.GET(new Request('https://example.test/api/quotes'+q)),detail:(q='',target=id(9))=>detail.GET(new Request('https://example.test/api/quotes/'+target+q),{params:Promise.resolve({id:target})})};
}
test('client list pages and exact minimal projection, microseconds and cursor scope',async()=>{
 const h=setup({rows:Array.from({length:51},(_,n)=>quote(300-n))});const r=await h.list();assert.equal(r.status,200);const b=await r.json();assert.equal(b.items.length,50);assert.equal(b.page.has_more,true);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 assert.deepEqual(Object.keys(b.items[0]).sort(),['id','intervention_id','total_cents','status','created_at','intervention'].sort());
 assert.equal((await setup({rows:[quote(250)]}).list('?cursor='+b.page.next_cursor)).status,200);
 assert.equal((await setup().list('?status=sent&cursor='+b.page.next_cursor)).status,422);
 const raw=JSON.parse(Buffer.from(b.page.next_cursor,'base64url').toString());raw.actor=id(88);assert.equal((await setup().list('?cursor='+Buffer.from(JSON.stringify(raw)).toString('base64url'))).status,422);
 assert.ok(h.calls.some(c=>c[0]==='eq'&&c[1]==='intervention.client_id'&&c[2]===actor));
 for(const rows of [[quote(8),quote(9)],[quote(9),quote(9)]])assert.equal((await setup({rows}).list()).status,503);
});
test('old exact quote retains lines/TTC and is not activated; current and no-active proof',async()=>{
 const r=await setup({rows:[quote(9)]}).detail();assert.equal(r.status,200);const b=await r.json();assert.deepEqual(b.version,{current_quote_id:id(99),is_current:false});assert.equal(b.quote.total_cents,10000);assert.deepEqual(b.quote.lines,quote(9).lines);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 assert.deepEqual((await(await setup({rows:[quote(9)],active:[]}).detail()).json()).version,{current_quote_id:null,is_current:false});
 const current={...quote(9),status:'sent'};assert.equal((await(await setup({rows:[current],active:[{id:id(9),intervention_id:job,status:'sent'}]}).detail()).json()).version.is_current,true);
 for(const options of [{rows:[current],active:[]},{rows:[quote(9)],activeError:true},{rows:[{...quote(9),total_cents:10001}]},{rows:[quote(10)]}]){const r=await setup(options).detail();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');}
});
test('manager exact current org/site, reader permitted, foreign and revoked refused',async()=>{
 const q='?organization_id='+org+'&site_id='+site;
 assert.equal((await setup({role:'manager',rows:[quote(9)]}).detail(q)).status,200);
 assert.equal((await setup({role:'manager',rows:[quote(9)]}).detail('?organization_id='+org)).status,200);
 for(const opts of [{noMember:true},{hidden:true},{revoked:true}])assert.equal((await setup({role:'manager',rows:[quote(9)],...opts}).detail(q)).status,404);
 assert.equal((await setup({role:'manager'}).detail()).status,422);
 assert.equal((await setup({role:'manager'}).list()).status,403);
});
test('session, role, ownership, parameters, empty and current access',async()=>{
 assert.equal((await setup({anonymous:true}).list()).status,401);
 for(const role of ['admin','artisan'])assert.equal((await setup({role}).detail()).status,403);
 assert.equal((await setup().detail()).status,404);
 assert.equal((await setup({rows:[{...quote(9),intervention:{...intervention,client_id:id(77)}}]}).detail()).status,404);
 assert.equal((await setup({rows:[quote(9)],changedRole:true}).detail()).status,403);
 assert.equal((await setup({rows:[quote(9)],revoked:true}).detail()).status,404);
 for(const q of ['?status=x','?limit=50','?cursor=bad','?status=all&status=sent','?organization_id='+org])assert.equal((await setup().list(q)).status,422);
 const empty=await setup().list();assert.equal(empty.headers.get('cache-control'),'private, no-store');assert.deepEqual(await empty.json(),{items:[],page:{limit:50,has_more:false,next_cursor:null}});
});
