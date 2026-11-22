import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,fakeServerHelpers,loadModule} from './documents/harness';
for(const file of ['app/api/enterprise/interventions/search/route.ts','app/api/enterprise/overview/route.ts'])test(`${file}: verified native bearer and unchanged browser origin boundary`,async()=>{
 for(const entry of [{origin:undefined,authorization:'Bearer head.payload.signature',expected:401,auth:true},{origin:'https://app.test',authorization:undefined,expected:401,auth:true},{origin:'https://evil.test',authorization:'Bearer head.payload.signature',expected:403,auth:false},{origin:undefined,authorization:undefined,expected:403,auth:false},{origin:undefined,authorization:'Bearer invalid',expected:403,auth:false}]){
 let received:Request|undefined;const module=loadModule(file,{'@/lib/supabase/server':{...fakeServerHelpers({db:{}}),authenticatedClient:async(request:Request)=>{received=request;throw new ApiError(401,'Session requise')}}});const headers=new Headers();if(entry.origin)headers.set('origin',entry.origin);if(entry.authorization)headers.set('authorization',entry.authorization);const request=new Request('https://app.test/api/read',{method:'POST',headers,body:'{}'});const response=await (module.POST as Function)(request);assert.equal(response.status,entry.expected);assert.equal(received,entry.auth?request:undefined);
 }
});
