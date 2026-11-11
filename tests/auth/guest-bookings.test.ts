import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers, ApiError } from "../documents/harness";
const ID="10000000-0000-4000-8000-000000000001", JOB="20000000-0000-4000-8000-000000000002", ORIGIN="https://preview.example.test";
const payload={request_id:ID,service_slug:"plusieurs-prises-sans-courant",category:"socket",description:"Plusieurs prises sans alimentation",address:"Adresse synthétique QA",postal_code:"97200",city:"Commune synthétique QA",urgency:"scheduled",contact:{first_name:"QA",last_name:"Essai",email:"QA.Essai@Example.test",phone:"0696123456"},payment_choice:"on_site"};
const prepared={request_id:ID,status:"prepared",expected_max_cents:18000,payment:{method:"on_site",status:"pending"}};
const confirmed={status:"confirmed",intervention:{id:JOB,status:"requested",estimate_min_cents:8000,estimate_max_cents:18000},payment:{method:"on_site",status:"due_on_site"}};
// Website = cookie session (no Authorization header) on an account whose e-mail is confirmed.
// `native` adds the bearer header of the native builds already delivered (their older contract).
const WEB_PHONE="Indiquez un numéro de téléphone en +596, +590 ou +33 (ex. 0696 12 34 56 ou +590 690 12 34 56).", WEB_EMAIL="Indiquez l’adresse e-mail de contact de cette demande.";
function fixture(operation="create",options:{auth?:boolean;role?:string;verified?:boolean;email?:boolean;native?:boolean;error?:string;malformed?:boolean;card?:boolean}={}){
 const calls:any[]=[];
 const db={from:(table:string)=>({select:(columns:string)=>({eq:(key:string,id:string)=>({maybeSingle:async()=>({data:{id,role:options.role??"client"},error:null})})})}),rpc:async(name:string,args:any)=>{calls.push({name,args});if(options.error)return{data:null,error:{code:options.error,message:"PRIVATE_PROVIDER_DETAILS"}};return{error:null,data:options.malformed?{token:"PRIVATE_PROVIDER_DETAILS"}:["submit_phone_booking","create_on_site_booking_reviewed","create_on_site_booking_located"].includes(name)?confirmed:name==="phone_booking_status"?{...prepared,payment:{...prepared.payment,method:options.card?"card_hold":"on_site"}}:name.includes("cancel")?{...prepared,status:"cancelled",payment:{method:"on_site",status:"cancelled"}}:prepared}}};
 const helpers=fakeServerHelpers({authenticated:options.auth,db});
 const route=loadModule(`app/api/bookings/${operation==="create"?"":operation+"/"}route.ts`,{"node:process":{env:{}},"@/lib/supabase/server":{...helpers,authenticatedClient:async()=>{if(options.auth===false)throw new ApiError(401,"Session requise");return{db,user:{id:ID,phone:"596696123456",phone_confirmed_at:options.verified===false?null:"2026-11-01T00:00:00Z",email_confirmed_at:options.email===false?null:"2026-11-01T00:00:00Z"}}}}});
 const raw=(r:Request)=>(route[operation==="status"?"GET":"POST"] as (r:Request)=>Promise<Response>)(r);
 const request=(body:unknown=payload,suffix="",origin=ORIGIN)=>raw(new Request(ORIGIN+"/api/bookings"+suffix,{method:operation==="status"?"GET":"POST",headers:{Origin:origin,"Content-Type":"application/json",...(options.native?{Authorization:"Bearer QA"}:{})},...(operation==="status"?{}:{body:JSON.stringify(body)})}));
 return{calls,request,raw};
}
async function check(response:Response,status:number){assert.equal(response.status,status);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(response.headers.get("referrer-policy"),"no-referrer");if(status===503)assert.equal(response.headers.get("retry-after"),"2");const text=await response.text();/* The two public contact messages are the only place those words may appear. */assert.doesNotMatch(status===422?text.replaceAll(WEB_PHONE,"").replaceAll(WEB_EMAIL,""):text,/PRIVATE_PROVIDER|token|contact|first_name|phone/);return JSON.parse(text)}
test("on-site real route: normalized private contact, immutable payload, one atomic RPC, server estimates",async()=>{const f=fixture();assert.deepEqual(await check(await f.request(),201),confirmed);assert.deepEqual(f.calls.map(c=>c.name),["create_on_site_booking_reviewed"]);assert.equal(f.calls[0].args.p_contact.phone,"+596696123456");assert.equal(f.calls[0].args.p_contact.email,"qa.essai@example.test");assert.equal(f.calls[0].args.p_payload.description,payload.description);assert.equal(Object.hasOwn(f.calls[0].args.p_payload,"contact"),false);assert.equal(f.calls[0].args.p_request_id,ID)});
test("website identity: confirmed e-mail account only (a verified phone is not enough), auth/role/origin, no prepare on refusals",async()=>{for(const [opts,status]of [[{auth:false},401],[{role:"artisan"},409],[{role:"admin"},409],[{email:false},403],[{email:false,verified:false},403]] as const){const f=fixture("create",opts);const body=await check(await f.request(),status);if(status===403)assert.match(body.error,/adresse e-mail est confirmée/);assert.equal(f.calls.length,0)}const email=fixture("create",{verified:false});await check(await email.request(),201);for(const operation of ["status","cancel","finalize"]){const f=fixture(operation,{email:false});await check(await f.request({request_id:ID},operation==="status"?`?request_id=${ID}`:""),403);assert.equal(f.calls.length,0)}const foreign=fixture();await check(await foreign.request(payload,"","https://foreign.test"),403);assert.equal(foreign.calls.length,0)});
test("website contact: e-mail and a +596, +590 or +33 phone are required by the server, with a clear message",async()=>{
 for(const [contact,message]of [[{email:""},WEB_EMAIL],[{email:"   "},WEB_EMAIL],[{phone:"+447700900123"},WEB_PHONE],[{phone:"+15145550123"},WEB_PHONE],[{phone:"0596123456"},WEB_PHONE]] as const){const f=fixture();assert.deepEqual(await check(await f.request({...payload,contact:{...payload.contact,...contact}}),422),{error:message});assert.equal(f.calls.length,0)}
 for(const [phone,stored]of [["0696 12 34 56","+596696123456"],["0690123456","+590690123456"],["+590 690 12 34 56","+590690123456"],["0612345678","+33612345678"],["+33 6 12 34 56 78","+33612345678"],["+596 596 12 34 56","+596596123456"]] as const){const f=fixture();await check(await f.request({...payload,contact:{...payload.contact,phone}}),201);assert.equal(f.calls[0].args.p_contact.phone,stored)}
});
test("native builds already delivered (bearer): verified phone or confirmed e-mail, empty e-mail and any E.164 number still accepted",async()=>{
 const legacy={...payload,contact:{...payload.contact,email:"",phone:"+447700900123"}};
 const phone=fixture("create",{native:true,email:false});await check(await phone.request(legacy),201);assert.equal(phone.calls[0].args.p_contact.email,"");assert.equal(phone.calls[0].args.p_contact.phone,"+447700900123");
 await check(await fixture("create",{native:true,verified:false}).request(legacy),201);
 const none=fixture("create",{native:true,email:false,verified:false});await check(await none.request(legacy),403);assert.equal(none.calls.length,0);
 const role=fixture("create",{native:true,role:"artisan"});await check(await role.request(legacy),409);assert.equal(role.calls.length,0);
});
test("strict body/no frontend money or identity, bounded streamed body, no mutation",async()=>{for(const body of [{...payload,amount:1},{...payload,client_id:ID},{...payload,contact:{...payload.contact,unknown:"x"}},{...payload,contact:{...payload.contact,phone:"invalid"}},{...payload,request_id:"invalid"}]){const f=fixture();await check(await f.request(body),422);assert.equal(f.calls.length,0)}const f=fixture();let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(20000))},cancel(){cancelled=true}});await check(await f.raw(new Request(ORIGIN,{method:"POST",body:stream,duplex:"half"} as RequestInit)),413);assert.equal(cancelled,true);assert.equal(f.calls.length,0)});
test("card absent and finalize are honest 503 before any RPC",async()=>{for(const op of ["create","finalize"]){const f=fixture(op);await check(await f.request(op==="create"?{...payload,payment_choice:"card_hold"}:{request_id:ID}),503);assert.equal(f.calls.length,0)}});
test("DB conflict/foreign/not verified/quota and malformed provider fail closed",async()=>{for(const [error,status]of [["P0001",409],["P0002",404],["42501",403],["53300",429],["upstream",503]] as const){const f=fixture("create",{error});await check(await f.request(),status);assert.equal(f.calls.length,1)}const f=fixture("create",{malformed:true});await check(await f.request(),503);assert.equal(f.calls.length,1)});
test("status: exactly one owner-scoped UUID selector, output projection, no contact",async()=>{for(const key of ["request_id","intervention_id"]){const f=fixture("status");await check(await f.request(undefined,`?${key}=${ID}`),200);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_request_id:key==="request_id"?ID:null,p_intervention_id:key==="intervention_id"?ID:null})}for(const suffix of ["",`?request_id=${ID}&intervention_id=${JOB}`,`?request_id=${ID}&request_id=${ID}`,"?request_id=bad",`?name=QA`]){const f=fixture("status");await check(await f.request(undefined,suffix),422);assert.equal(f.calls.length,0)}await check(await fixture("status",{error:"P0002"}).request(undefined,`?intervention_id=${JOB}`),404)});
test("cancel only unfinished on-site, card fails before cancellation intent until provider helper",async()=>{const f=fixture("cancel");assert.equal((await check(await f.request({request_id:ID}),200)).status,"cancelled");assert.deepEqual(f.calls.map(c=>c.name),["phone_booking_status","begin_phone_booking_cancel","cancel_phone_booking"]);const card=fixture("cancel",{card:true});await check(await card.request({request_id:ID}),503);assert.equal(card.calls.length,1)});
test("legacy Checkout guard blocks held dossier before Stripe construction; regular path proceeds",async()=>{for(const blocked of [true,false]){let constructed=0;const db={rpc:async(name:string)=>{assert.equal(name,"guard_phone_booking_checkout");return{error:blocked?{code:"P0001"}:null}}};const route=loadModule("app/api/payments/checkout/route.ts",{"@/lib/supabase/server":fakeServerHelpers({db}),"@/lib/supabase/stripe":{stripeClient:()=>{constructed++;throw new ApiError(503,"Not configured")}}});const r=await(route.POST as(r:Request)=>Promise<Response>)(new Request(ORIGIN,{method:"POST",body:JSON.stringify({quote_id:ID})}));assert.equal(r.status,blocked?409:503);assert.equal(constructed,blocked?0:1)}});
test("configured card HTTP branches: prepare before Checkout, fresh finalize before submit, durable cancel before release",async()=>{
 for(const operation of ["create","finalize","cancel"]){
  const calls:string[]=[];const cardPending={...prepared,payment:{method:"card_hold",status:"pending"}},cardConfirmed={...confirmed,payment:{method:"card_hold",status:"authorization_recorded",checked_at:new Date().toISOString()}};
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:ID,role:"client"},error:null})})})}),rpc:async(name:string)=>{calls.push(name);return{error:null,data:name==="submit_phone_booking"?cardConfirmed:name==="cancel_phone_booking"?{...cardPending,status:"cancelled",payment:{method:"card_hold",status:"cancelled"}}:name==="begin_phone_booking_cancel"?{...cardPending,status:"cancelling"}:cardPending}}};
  const helper=fakeServerHelpers({db});const m=loadModule(`app/api/bookings/${operation==="create"?"":operation+"/"}route.ts`,{"@/lib/supabase/server":{...helper,authenticatedClient:async()=>({db,user:{id:ID,email_confirmed_at:"2026-11-01T00:00:00Z"}})},"@/lib/features/guest/card-hold":{cardHoldContext:()=>{calls.push("configured");return{}},openCardHold:async(actor:string,key:string)=>{assert.equal(actor,ID);assert.equal(key,ID);calls.push("checkout");return{status:"authorization_required",url:"https://checkout.stripe.com/c/pay/QA"}},authorizeCardHold:async()=>{calls.push("authorizeFresh")},releaseCardHold:async()=>{calls.push("release")}}});
  const response=await(m.POST as(r:Request)=>Promise<Response>)(new Request(ORIGIN,{method:"POST",body:JSON.stringify(operation==="create"?{...payload,payment_choice:"card_hold"}:{request_id:ID})}));const result=await check(response,operation==="finalize"?201:200);
  assert.deepEqual(calls,operation==="create"?["configured","prepare_phone_booking_reviewed","checkout"]:operation==="finalize"?["configured","phone_booking_status","authorizeFresh","submit_phone_booking"]:["phone_booking_status","configured","begin_phone_booking_cancel","release","cancel_phone_booking"]);
  if(operation==="finalize")assert.equal(result.payment.status,"authorized");
 }
});

test('reserved estimate DTO is additive, strict and matches the durable booking ceiling',async()=>{
 const estimate={version:1,min_cents:8000,max_cents:18000,currency:'eur'};
 for(const supplied of [estimate,{...estimate,max_cents:19000},{...estimate,version:0},{...estimate,currency:'usd'},{...estimate,private_field:'no'}]){
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:ID,role:'client'},error:null})})})}),rpc:async()=>({data:{...prepared,estimate:supplied},error:null})};
  const helpers=fakeServerHelpers({db});const m=loadModule('app/api/bookings/status/route.ts',{'@/lib/supabase/server':{...helpers,authenticatedClient:async()=>({db,user:{id:ID,email_confirmed_at:'2026-11-01T00:00:00Z'}})}});
  const r=await(m.GET as(r:Request)=>Promise<Response>)(new Request(ORIGIN+'/api/bookings/status?request_id='+ID));
  if(supplied===estimate)assert.deepEqual((await check(r,200)).estimate,estimate);else await check(r,503);
 }
});

test('snapshot consumer never forwards extra top-level, payment or intervention fields',async()=>{
 for(const response of [prepared,confirmed]){
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:ID,role:'client'},error:null})})})}),rpc:async()=>({data:{...response,private_field:'PRIVATE_PROVIDER_DETAILS',payment:{...response.payment,secret:'PRIVATE_PROVIDER_DETAILS'},...('intervention'in response?{intervention:{...response.intervention,secret:'PRIVATE_PROVIDER_DETAILS'}}:{}),estimate:{version:1,min_cents:8000,max_cents:18000,currency:'eur'}},error:null})};
  const helpers=fakeServerHelpers({db});const m=loadModule('app/api/bookings/status/route.ts',{'@/lib/supabase/server':{...helpers,authenticatedClient:async()=>({db,user:{id:ID,email_confirmed_at:'2026-11-01T00:00:00Z'}})}});
  const r=await(m.GET as(r:Request)=>Promise<Response>)(new Request(ORIGIN+'/api/bookings/status?request_id='+ID));const body=await check(r,200);assert.deepEqual(body,{...response,estimate:{version:1,min_cents:8000,max_cents:18000,currency:'eur'}});
 }
});

test('reviewed version is outside booking payload; stale SQL refusal prevents provider call',async()=>{
 const f=fixture();await check(await f.request({...payload,reviewed_estimate_version:1}),201);assert.equal(f.calls[0].args.p_reviewed_estimate_version,1);assert.equal(Object.hasOwn(f.calls[0].args.p_payload,'reviewed_estimate_version'),false);
 for(const version of [null,0,1.5,2147483648,'1']){const h=fixture();await check(await h.request({...payload,reviewed_estimate_version:version}),422);assert.equal(h.calls.length,0)}
 let opened=0;let message='Estimate review required';const calls:any[]=[];const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:ID,role:'client'},error:null})})})}),rpc:async(name:string,args:unknown)=>{calls.push({name,args});return{data:null,error:{code:'P0001',message}}}};
 const helper=fakeServerHelpers({db});const m=loadModule('app/api/bookings/route.ts',{'@/lib/supabase/server':{...helper,authenticatedClient:async()=>({db,user:{id:ID,email_confirmed_at:'2026-11-01T00:00:00Z'}})},'@/lib/features/guest/card-hold':{cardHoldContext:()=>({}),openCardHold:async()=>{opened++;throw Error('Must not call provider')}}});
 const post = (payment_choice: string) => (m.POST as (r: Request) => Promise<Response>)(new Request(ORIGIN+'/api/bookings', {
  method: 'POST',
  body: JSON.stringify({ ...payload, payment_choice, reviewed_estimate_version: 1 }),
 }));
 assert.equal((await check(await post('card_hold'),409)).code,'estimate_review_required');
 assert.equal((await check(await post('on_site'),409)).code,'estimate_review_required');
 message = 'Reserved estimate conflict';
 assert.equal((await check(await post('card_hold'),409)).code,undefined);
 assert.equal(opened,0);
 assert.deepEqual(calls.map(call => call.name), ['prepare_phone_booking_reviewed', 'create_on_site_booking_reviewed', 'prepare_phone_booking_reviewed']);
 assert.equal(calls[0].args.p_reviewed_estimate_version,1);
});


test("optional location uses atomic RPC, remains private and validates before mutation", async () => {
 const location = {latitude:14.61,longitude:-61.07,access_details:"Entrée cour QA"};
 const f=fixture(); await check(await f.request({...payload,location}),201);
 assert.equal(f.calls[0].name,"create_on_site_booking_located");
 assert.deepEqual(f.calls[0].args.p_location,location);
 assert.equal(Object.hasOwn(f.calls[0].args.p_payload,"location"),false);
 for(const invalid of [{...location,latitude:91},{...location,longitude:null},{...location,access_details:"a".repeat(1001)},{...location,actor_id:ID}]) {
  const h=fixture(); await check(await h.request({...payload,location:invalid}),422); assert.equal(h.calls.length,0);
 }
});
