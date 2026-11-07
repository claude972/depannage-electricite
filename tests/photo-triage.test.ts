import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoReviewHandlers,type Session} from '../lib/features/photo-triage/handlers';
import {PROVIDER_URL} from '../lib/features/photo-triage/provider';
const U='11111111-1111-4111-8111-111111111111',J='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444',C='55555555-5555-4555-8555-555555555555';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
function fixture(o:{enabled?:boolean;badImage?:boolean;large?:boolean;lost?:boolean;invalidOutput?:boolean;refused?:boolean;changedDocument?:boolean;changedSession?:boolean;denied?:boolean;auth?:boolean}={}){
 let status='requested',version=0,sha:string|null=null,classified=false,fetches=0,reads=0,sessions=0;
 const calls:any[]=[];const db:any={async rpc(name:string,args:any){calls.push({name,args});if(o.denied)return {data:null,error:{code:'42501'}};
  if(name==='photo_review_command'){if(version===0)version=1;return {data:R,error:null}}
  if(name==='photo_review_source')return {data:{id:R,document_id:D,path:'private/photo.png',mime:'image/png',version,status,request_command_id:C,sha256:sha},error:null};
  if(name==='photo_review_list')return {data:{can_request:true,items:version?[{id:R,document_id:D,version,status,can_withdraw:status==='requested',can_review:false,result:null}]:[]},error:null};
  if(name==='photo_review_provider'){
   if(args.p_action==='reserve'){if(status!=='requested')return {data:false,error:null};status='uncertain';version++;sha=args.p_sha256;return {data:true,error:null}}
   classified=true;status='awaiting_review';version++;return {data:true,error:null};
  }
  throw Error(name);
 }};
 const h=createPhotoReviewHandlers({authenticate:async()=>{if(o.auth===false)throw {status:401};sessions++;const s:Session={db,userId:U,sessionKey:o.changedSession&&fetches>0?'different':'same',download:async()=>{reads++;return new Blob([o.large?Buffer.alloc(4194305):o.badImage?Buffer.from('%PDF forged'):o.changedDocument&&reads>1?Buffer.concat([PNG,Buffer.from('changed')]):PNG])}};return s},admin:()=>db,env:()=>o.enabled===false?{}:{PHOTOTRIAGE_ENABLED:'true',PHOTOTRIAGE_MODEL:'configured-vision-model',OPENAI_API_KEY:'injected-test-only'},fetcher:async(url,init)=>{
  fetches++;calls.push({name:'fetch',url,init});assert.equal(status,'uncertain','SQL reservation precedes provider');if(o.lost)throw Error('response lost');
  const result=o.invalidOutput?{category:'socket',readability:'readable',advice:'unsafe extra text'}:{category:'socket',readability:'limited'};
  return Response.json({status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',content:o.refused?[{type:'refusal',refusal:'no'}]:[{type:'output_text',text:JSON.stringify(result)}]}]});
 }});
 const request=(body:any={action:'request',document_id:D,command_id:C,expected_version:0,consent:true})=>h.POST(new Request(`https://app.test/api/interventions/${J}/photo-review`,{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify(body)}),J);
 return {h,request,calls,get fetches(){return fetches},get classified(){return classified},get status(){return status}};
}
test('actual handler+fetch reserves before dispatch, sends only photo/generic schema, hides result',async()=>{
 const f=fixture();const r=await f.request();assert.equal(r.status,200);const body=await r.json();assert.equal(body.items[0].status,'awaiting_review');assert.equal(body.items[0].result,null);assert.equal(f.classified,true);
 const call=f.calls.find(c=>c.name==='fetch');assert.equal(call.url,PROVIDER_URL);assert.equal(call.init.redirect,'error');const sent=JSON.parse(call.init.body);assert.equal(sent.store,false);assert.equal(sent.model,'configured-vision-model');assert.equal(sent.text.format.strict,true);assert.equal(sent.input[0].content[1].image_url,`data:image/png;base64,${PNG.toString('base64')}`);
 for(const secret of [U,J,D,R,C,'private/photo.png'])assert.equal(call.init.body.includes(secret),false);
 assert.equal(sent.metadata,undefined);assert.equal(sent.tools,undefined);
 assert.equal((await f.request()).status,200);assert.equal(f.fetches,1,'replay does not send again');
});
test('inactive provider persists request, no external fetch and consent remains withdrawable',async()=>{
 const f=fixture({enabled:false});const r=await f.request();assert.equal(r.status,200);const data=await r.json();assert.equal(data.provider_available,false);assert.equal(data.items[0].status,'requested');assert.equal(data.items[0].can_withdraw,true);assert.equal(f.fetches,0);
});
test('lost provider reply stays uncertain and replay never resends',async()=>{
 const f=fixture({lost:true});assert.equal((await f.request()).status,503);assert.equal(f.status,'uncertain');assert.equal((await f.request()).status,200);assert.equal(f.fetches,1);assert.equal(f.classified,false);
});
test('unvalidated text/refusal never reaches SQL result or client',async()=>{
 for(const o of [{invalidOutput:true},{refused:true}]){const f=fixture(o);const r=await f.request();assert.equal(r.status,503);assert.equal(f.classified,false);assert.equal(f.status,'uncertain');assert.equal((await r.text()).includes('unsafe'),false)}
});
test('document content or session changes after provider discard the result',async()=>{
 for(const o of [{changedDocument:true},{changedSession:true}]){const f=fixture(o);assert.ok([403,409].includes((await f.request()).status));assert.equal(f.classified,false);assert.equal(f.status,'uncertain')}
});
test('real magic, cap, consent, authorization checked before provider',async()=>{
 for(const o of [{badImage:true},{large:true}]){const f=fixture(o);assert.equal((await f.request()).status,422);assert.equal(f.fetches,0)}
 assert.equal((await fixture({denied:true}).request()).status,403);assert.equal((await fixture({auth:false}).request()).status,401);
 const f=fixture();assert.equal((await f.request({action:'request',document_id:D,command_id:C,expected_version:0,consent:false})).status,422);assert.equal(f.fetches,0);
});
test('GET errors are caught and never expose a source path',async()=>{
 const f=fixture({denied:true});const r=await f.h.GET(new Request(`https://app.test/api/interventions/${J}/photo-review`),J);assert.equal(r.status,403);assert.equal((await r.text()).includes('private/'),false);
});
