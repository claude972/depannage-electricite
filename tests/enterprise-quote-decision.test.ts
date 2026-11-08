import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, ApiError } from './documents/harness';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),org=id(2),site=id(3),job=id(4);
const intervention={id:job,client_id:actor,site_id:site,category:'panel',status:'quoted'};
const quote=(n:number)=>({id:id(n),intervention_id:job,artisan_id:id(5),lines:[{label:'QA',quantity:1,unit_price_cents:10000}],subtotal_cents:10000,tax_rate:0,tax_cents:0,total_cents:10000,status:'rejected',created_at:'2026-11-07T12:00:00.123456Z',accepted_at:null,intervention:{...intervention,address:'PRIVATE'}});
type Options={rows?:unknown[];active?:unknown[];role?:string;noMember?:boolean;hidden?:boolean;revoked?:boolean;changedRole?:boolean;activeError?:boolean;anonymous?:boolean;rules?:unknown[];approvals?:unknown[];terms?:unknown[];canWrite?:unknown;archived?:boolean;readError?:boolean;lateRevoked?:boolean;decisionChanged?:boolean};
function setup(o:Options={}){
 let rowRead=false;let decisionReads=0;const calls:unknown[][]=[];
 const db={rpc:async()=>({error:null,data:o.canWrite??true}),from(table:string){const c:any={};let projection='';calls.push(['from',table]);
 for(const method of ['select','eq','in','order','or'])c[method]=(...args:unknown[])=>{calls.push([method,...args]);if(method==='select')projection=String(args[0]);return c};
 c.maybeSingle=async()=>({error:null,data:table==='sites'?{id:site,archived_at:o.archived?'2026-01-01T00:00:00Z':null}:table==='profiles'?{role:o.changedRole&&rowRead?'artisan':o.role??'client'}:o.noMember?null:{organization_id:org,user_id:actor}});
 c.limit=async(n:number)=>{calls.push(['limit',n]);
 if(table==='approval_rules'){decisionReads++;return{error:o.readError?{}:null,data:o.rules??[]};}
 if(table==='approvals')return{error:null,data:o.decisionChanged&&decisionReads>1?[]:o.approvals??[]};
 if(table==='quote_terms')return{error:null,data:o.terms??[]};
 if(table==='sites')return{error:null,data:o.hidden||(o.revoked&&rowRead)||(o.lateRevoked&&decisionReads>0)?[]:[{id:site,organization_id:org}]};
 if(table==='interventions')return{error:null,data:o.revoked?[]:[intervention]};
 if(projection==='id,intervention_id,status')return{error:o.activeError?{code:'XX000'}:null,data:o.active??[{id:id(99),intervention_id:job,status:'sent'}]};
 rowRead=true;return{error:null,data:o.rows??[]};};return c;}};
 const stubs={'@/lib/supabase/server':{ApiError,authenticatedClient:async()=>{if(o.anonymous)throw new ApiError(401,'Session');return{db,user:{id:actor}}},dbError:(e:unknown)=>{if(e)throw new ApiError(503,'Indisponible')}}};
 const decision=loadModule('app/api/quotes/[id]/decision-context/route.ts',stubs) as any;
 const list=loadModule('app/api/quotes/route.ts',stubs) as any,detail=loadModule('app/api/quotes/[id]/route.ts',stubs) as any;
 return{calls,decision:(q='?organization_id='+org)=>decision.GET(new Request('https://example.test/api/quotes/'+id(9)+'/decision-context'+q),{params:Promise.resolve({id:id(9)})}),list:(q='')=>list.GET(new Request('https://example.test/api/quotes'+q)),detail:(q='',target=id(9))=>detail.GET(new Request('https://example.test/api/quotes/'+target+q),{params:Promise.resolve({id:target})})};
}

const options = {role:'manager',rows:[quote(9)]};
test('exact decision HTTP: absence, minimal projection, current and historical statuses',async()=>{
 for(const state of ['sent','accepted','rejected']){
  const rows=[{...quote(9),status:state}];
  const active=state==='rejected'?[]:[{id:id(9),intervention_id:job,status:state}];
  const response=await setup({...options,rows,active}).decision();assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{quote_id:id(9),intervention_id:job,site_id:site,can_write:true,simple_rule:null,simple_approval:null,validity:{valid_until:null,state:'unspecified'}});
 }
});
test('simple threshold and decisions retained exactly; UTC validity',async()=>{
 for(const threshold of [9999,10000,10001])for(const status of ['pending','approved','rejected']){
  const r=await setup({...options,rules:[{site_id:site,enabled:true,required_role:'owner',threshold_cents:threshold}],approvals:[{id:id(77),quote_id:id(9),site_id:site,status,note:'PRIVATE'}],terms:[{quote_id:id(9),valid_until:'2000-01-01'}]}).decision();
  assert.equal(r.status,200);const b=await r.json();assert.equal(b.simple_rule.threshold_cents,threshold);assert.equal(b.simple_approval.status,status);assert.equal(b.validity.state,'expired');assert.ok(!JSON.stringify(b).includes('PRIVATE'));
  assert.equal(10000>b.simple_rule.threshold_cents,threshold===9999);
 }
 const b=await(await setup({...options,terms:[{quote_id:id(9),valid_until:'2999-01-01'}]}).decision()).json();assert.equal(b.validity.state,'valid');
});
test('reader and archived site never receive write capability; current scopes denied',async()=>{
 for(const extra of [{canWrite:false},{archived:true}]){const r=await setup({...options,...extra}).decision();assert.equal(r.status,200);assert.equal((await r.json()).can_write,false);}
 for(const extra of [{noMember:true},{hidden:true},{revoked:true},{lateRevoked:true}])assert.equal((await setup({...options,...extra}).decision()).status,404);
 assert.equal((await setup({...options,changedRole:true}).decision()).status,403);
 for(const role of ['client','artisan','admin'])assert.equal((await setup({...options,role}).decision()).status,403);
 assert.equal((await setup({...options,anonymous:true}).decision()).status,401);
 assert.equal((await setup(options).decision()).status,200);
 for(const query of ['', '?organization_id=bad','?organization_id='+org+'&extra=x'])assert.equal((await setup(options).decision(query)).status,422);
});
test('malformed, error and changed reads fail closed with retry, not absence',async()=>{
 for(const extra of [{readError:true},{canWrite:'true'},{rules:[{}]},{terms:[{quote_id:id(9),valid_until:'2026-02-30'}]},{approvals:[{id:id(77),quote_id:id(88),site_id:site,status:'approved'}]},{decisionChanged:true,approvals:[{id:id(77),quote_id:id(9),site_id:site,status:'approved'}]}]){
  const r=await setup({...options,...extra}).decision();assert.equal(r.status,503);assert.equal(r.headers.get('retry-after'),'2');assert.deepEqual(Object.keys(await r.json()),['error']);
 }
});
