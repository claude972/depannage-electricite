import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule,ApiError} from './documents/harness';
const site='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000001',command_id='10000000-0000-4000-8000-000000000003';
const values={first_name:'Léa',last_name:'Martin',role_label:'Responsable du site',phone:'+596 696 00 00 00',email:null,note:'Donnée synthétique QA',is_primary:true};
const row=(n=1)=>({...values,id:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,site_id:site,version:1,created_by:id,updated_by:id,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',archived_at:null});
function harness(options:{records?:unknown;count?:number|null;rights?:unknown;siteVisible?:boolean;unauth?:boolean;rpcResult?:unknown;rpcError?:unknown;queryError?:unknown}={}){
 const calls:any[]=[];const db={from(table:string){calls.push(['from',table]);const q:any={};for(const name of ['select','eq','is','order','limit','gt'])q[name]=(...args:any[])=>{calls.push([name,...args]);return q;};q.maybeSingle=async()=>({data:options.siteVisible===false?null:{id:site},error:null});q.then=(resolve:any)=>resolve({data:options.records??[row()],count:options.count===undefined?1:options.count,error:options.queryError??null});return q;},async rpc(name:string,args:unknown){calls.push(['rpc',name,args]);return name==='can_manage_site'?{data:options.rights===undefined?true:options.rights,error:null}:{data:options.rpcResult===undefined?row():options.rpcResult,error:options.rpcError??null};}};
 const server={ApiError,authenticatedClient:async()=>{if(options.unauth)throw new ApiError(401,'Connectez-vous.');return{db,user:{id}};},assertOrigin:(r:Request)=>{if(r.headers.get('origin')&&r.headers.get('origin')!==new URL(r.url).origin)throw new ApiError(403,'Origine refusée.');},dbError:(e:any)=>{if(e)throw new ApiError(e.code==='42501'?403:e.code==='P0001'||e.code==='23505'?409:503,'Action refusée.');}};
 return{...loadModule('app/api/sites/[id]/contacts/route.ts',{'@/lib/supabase/server':server}) as any,calls};
}
const context={params:Promise.resolve({id:site})};const get=(s='')=>new Request(`https://app.example/api/sites/${site}/contacts${s}`);
const body={action:'save',id,command_id,expected_version:null,values};
const post=(value:unknown,origin='https://app.example')=>new Request(`https://app.example/api/sites/${site}/contacts`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
test('site contacts GET reads private scoped active rows with strict count and readonly permissions',async()=>{
 const h=harness({rights:false});const r=await h.GET(get(),context),b=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(b.permissions.can_write,false);assert.equal(b.page.remaining_count,1);assert.equal(b.page.complete,true);assert.ok(h.calls.some((c:any)=>c[0]==='select'&&c[2]?.count==='exact'));assert.ok(h.calls.some((c:any)=>c[0]==='eq'&&c[1]==='site_id'&&c[2]===site));
 const empty=await harness({records:[],count:0}).GET(get(),context);assert.deepEqual((await empty.json()).records,[]);
});
test('GET refuses anonymous/invisible and malformed or truncated data without pretending empty',async()=>{
 for(const[options,status]of [[{unauth:true},401],[{siteVisible:false},404],[{rights:null},503],[{count:null},503],[{count:101},503],[{records:[{...row(),site_id:id}]},503],[{records:[{...row(),phone:null}]},503],[{records:[row(),row()],count:2},503],[{records:[row(),row(2)],count:2},503],[{records:[row(2),row()],count:2},503],[{queryError:{code:'x'}},503]]as const){const r=await harness(options).GET(get(),context);assert.equal(r.status,status,JSON.stringify(options));assert.equal(r.headers.get('cache-control'),'private, no-store');if(status===503)assert.equal(r.headers.get('retry-after'),'2');}
});
test('cursor pagination preserves remaining count and never calls final page exhaustive',async()=>{
 const records=Array.from({length:100},(_,i)=>({...row(i+1),is_primary:false}));const r=await harness({records,count:101}).GET(get(),context);const b=await r.json();assert.equal(r.status,200);assert.equal(b.page.has_more,true);assert.equal(b.page.complete,false);
 const end=await harness({records:[row(101)],count:1}).GET(get('?cursor='+b.page.next_cursor),context);assert.equal(end.status,200);assert.equal((await end.json()).page.complete,false);
 const foreign={params:Promise.resolve({id:command_id})};assert.equal((await harness().GET(get('?cursor='+b.page.next_cursor),foreign)).status,422);
 assert.equal((await harness().GET(get('?cursor='+b.page.next_cursor),context)).status,503);
 for(const suffix of ['?cursor=a&cursor=a','?cursor=bad%2Fvalue','?archived=true','?site_id='+id])assert.equal((await harness().GET(get(suffix),context)).status,422);
});
test('POST binds URL site and stable command/record identity; no profile or invitation writes',async()=>{
 const h=harness();const r=await h.POST(post(body),context);assert.equal(r.status,200);const rpc=h.calls.find((c:any)=>c[0]==='rpc');assert.equal(rpc[1],'write_site_contact');assert.deepEqual(JSON.parse(JSON.stringify(rpc[2])),{p_site_id:site,p_id:id,p_command_id:command_id,p_expected_version:null,p_action:'save',p_values:values});
 assert.ok(!h.calls.some((c:any)=>c[0]==='from'&&c[1]!=='sites'));
 const updated={...row(),version:2};assert.equal((await harness({rpcResult:updated}).POST(post({...body,expected_version:1}),context)).status,200);
 const archived={...updated,is_primary:false,archived_at:'2026-02-01T00:00:00Z'};assert.equal((await harness({rpcResult:archived}).POST(post({action:'archive',id,command_id,expected_version:1}),context)).status,200);
});
test('POST input errors preserve boundary before RPC: contact information required, no extra fields',async()=>{
 for(const value of [{...body,command_id:'bad'},{...body,expected_version:0},{...body,site_id:id},{...body,values:{...values,phone:null}},{...body,values:{...values,email:'not email'}},{...body,values:{...values,first_name:'\n'}},{...body,values:{...values,note:'a'.repeat(2001)}},{...body,values:{...values,is_primary:'true'}},{action:'archive',id,command_id,expected_version:null}]){const h=harness();assert.equal((await h.POST(post(value),context)).status,422);assert.equal(h.calls.filter((c:any)=>c[0]==='rpc').length,0);}
});
test('POST refuses foreign origin/anonymous/RLS/conflicts and never confirms wrong persistence',async()=>{
 const h=harness();assert.equal((await h.POST(post(body,'https://evil.example'),context)).status,403);assert.equal(h.calls.length,0);
 for(const[opts,status]of [[{unauth:true},401],[{siteVisible:false},404],[{rpcError:{code:'42501'}},403],[{rpcError:{code:'23505'}},409],[{rpcResult:null},503],[{rpcResult:{...row(),version:2}},503],[{rpcResult:{...row(),first_name:'Other'}},503],[{rpcResult:{...row(),id:command_id}},503]]as const)assert.equal((await harness(opts).POST(post(body),context)).status,status,JSON.stringify(opts));
 const malformed=new Request('https://app.example/api/sites/'+site+'/contacts',{method:'POST',body:'{'});assert.equal((await harness().POST(malformed,context)).status,400);
});
