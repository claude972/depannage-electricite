import test from 'node:test';
import assert from 'node:assert/strict';
import {createMissionRadiusHandlers} from '../lib/features/mission-radius/handlers';
const base={preference:{version:0,reference_code:null as string|null,radius_km:null as number|null},options:[{code:'97209',name:'Fort-de-France'},{code:'97213',name:'Le Lamentin'}],source:{url:'https://geo.api.gouv.fr/departements/972/communes?fields=nom,code,codesPostaux,centre',retrieved_at:'2026-11-07T21:13:50Z'},basis:'commune_centres',unknown_postal_policy:'postal_only'};
function fixture(error:string|null=null,bad=false){
 let view=structuredClone(base);const calls:{name:string;args?:Record<string,unknown>}[]=[];
 const h=createMissionRadiusHandlers(async()=>({db:{async rpc(name,args){calls.push({name,args});if(error)return {data:null,error:{code:error}};if(args)view={...view,preference:{version:Number(args.p_expected_version)+1,reference_code:args.p_reference_code as string|null,radius_km:args.p_radius_km as number|null}};return {data:bad?{...view,latitude:14.6}:view,error:null}}}}));
 const post=(body:unknown,origin='https://app.test')=>h.POST(new Request('https://app.test/api/artisan/mission-radius',{method:'POST',headers:{origin},body:JSON.stringify(body)}));
 return {h,calls,post};
}
test('no preference has no default radius; option response contains code/name only',async()=>{
 const f=fixture(),r=await f.h.GET(new Request('https://app.test/api/artisan/mission-radius'));assert.equal(r.status,200);assert.deepEqual(await r.json(),base);assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('explicit radius and clear use current version and contain no positional data',async()=>{
 const f=fixture();let r=await f.post({expected_version:0,reference_code:'97209',radius_km:5});assert.equal(r.status,200);assert.equal((await r.json()).preference.version,1);
 assert.deepEqual(f.calls[0],{name:'save_artisan_mission_radius',args:{p_expected_version:0,p_reference_code:'97209',p_radius_km:5}});
 r=await f.post({expected_version:1,reference_code:null,radius_km:null});assert.deepEqual((await r.json()).preference,{version:2,reference_code:null,radius_km:null});
});
test('bounds, precision and injected actor/coordinates are refused',async()=>{
 const f=fixture(),valid={expected_version:0,reference_code:'97209',radius_km:5};
 for(const body of [{...valid,radius_km:0},{...valid,radius_km:201},{...valid,radius_km:1.5},{...valid,radius_km:null},{...valid,reference_code:null},{...valid,latitude:14.6},{...valid,user_id:'other'},{...valid,expected_version:-1}]){
  assert.equal((await f.post(body)).status,422);
 }
 assert.equal(f.calls.length,0);
 assert.equal((await f.post({...valid,radius_km:200})).status,200);
});
test('scope refusal, stale version and absent source map to usable HTTP errors',async()=>{
 for(const [code,status]of [['42501',403],['P0001',409],['22023',422],['XX000',503]]as const){const f=fixture(code);assert.equal((await f.post({expected_version:0,reference_code:'97209',radius_km:5})).status,status)}
});
test('unauthenticated, cross-origin and unknown query parameters cannot save',async()=>{
 const h=createMissionRadiusHandlers(async()=>{throw {status:401}});assert.equal((await h.GET(new Request('https://app.test/api/artisan/mission-radius'))).status,401);
 const f=fixture();assert.equal((await f.post({expected_version:0,reference_code:null,radius_km:null},'https://evil.test')).status,403);
 assert.equal((await f.h.GET(new Request('https://app.test/api/artisan/mission-radius?actor=other'))).status,422);assert.equal(f.calls.length,0);
});
test('unexpected server coordinates fail closed instead of being serialized',async()=>{const f=fixture(null,true);assert.equal((await f.h.GET(new Request('https://app.test/api/artisan/mission-radius'))).status,503)});
