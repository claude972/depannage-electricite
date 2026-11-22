import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError,fakeServerHelpers,loadModule } from './documents/harness';
import { organizationOverview,siteSettings,sitePage,siteEditValues,adminInterventions,directoryPage } from '../apps/mobile/src/lib/management-contracts';
const id='10000000-0000-4000-8000-000000000001', actor='20000000-0000-4000-8000-000000000001';
const entries=[
 ['app/api/quotes/[id]/approval/route.ts','GET',`/api/quotes/${id}/approval`],
 ['app/api/quotes/[id]/approval/route.ts','POST',`/api/quotes/${id}/approval`],
 ['app/api/sites/[id]/approval-policy/route.ts','GET',`/api/sites/${id}/approval-policy`],
 ['app/api/sites/[id]/approval-policy/route.ts','POST',`/api/sites/${id}/approval-policy`],
 ['app/api/enterprise/contracts/route.ts','GET','/api/enterprise/contracts?organization_id='+id],
 ['app/api/enterprise/contracts/[id]/route.ts','GET','/api/enterprise/contracts/'+id+'?organization_id='+id],
 ['app/api/enterprise/approvals/route.ts','GET','/api/enterprise/approvals?organization_id='+id],
 ['app/api/enterprise/approvals/[id]/route.ts','GET','/api/enterprise/approvals/'+id+'?organization_id='+id],
 ['app/api/admin/artisans/route.ts','POST','/api/admin/artisans'],
 ['app/api/organizations/route.ts','GET','/api/organizations?organization_id='+id],
 ['app/api/organizations/[id]/sites/route.ts','GET',`/api/organizations/${id}/sites`],
 ['app/api/sites/[id]/settings/route.ts','GET',`/api/sites/${id}/settings`],
 ['app/api/sites/[id]/settings/route.ts','POST',`/api/sites/${id}/settings`],
 ['app/api/admin/interventions/route.ts','GET','/api/admin/interventions'],
 ['app/api/admin/directory/route.ts','GET','/api/admin/directory?kind=clients'],
] as const;
for(const [file,verb,path] of entries)test(`${verb} ${path} forwards native and browser requests to verified authentication`,async()=>{
 for(const header of [undefined,'Bearer head.payload.signature']){
  let received:Request|undefined;
  const helpers={...fakeServerHelpers({db:{}}),authenticatedClient:async(req:Request)=>{received=req;throw new ApiError(401,'Session requise');}};
  const module=loadModule(file,{'@/lib/supabase/server':helpers});
  const req=new Request('https://app.test'+path,{method:verb,headers:header?{Authorization:header}:undefined});
  const response=await (module[verb] as Function)(req,{params:Promise.resolve({id})});
  assert.equal(received,req);assert.equal(response.status,401);
 }
});
test('native request does not bypass admin role checks',async()=>{
 for(const file of ['app/api/admin/interventions/route.ts','app/api/admin/directory/route.ts']){
  let tables=0;const query={select:()=>query,eq:()=>query,single:async()=>({data:{role:'manager'},error:null})};
  const module=loadModule(file,{'@/lib/supabase/server':fakeServerHelpers({db:{from:()=>{tables++;return query;}}})});
  const response=await (module.GET as Function)(new Request('https://app.test/api/admin/directory?kind=clients',{headers:{Authorization:'Bearer head.payload.signature'}}));
  assert.equal(response.status,403);assert.equal(tables,1);
 }
});
test('organization RPC rejection remains forbidden rather than empty successful data',async()=>{
 const module=loadModule('app/api/organizations/route.ts',{'@/lib/supabase/server':fakeServerHelpers({db:{rpc:async()=>({data:null,error:{code:'42501'}})}})});
 const response=await (module.GET as Function)(new Request('https://app.test/api/organizations?organization_id='+id,{headers:{Authorization:'Bearer head.payload.signature'}}));
 assert.equal(response.status,403);
});
test('mobile contracts require explicit site write permission and preserve selected site scope',()=>{
 const site={id,organization_id:id,name:'Bureaux QA',address:'Adresse QA',access_notes:'',type:'office',budget_cents:12000,settings_version:3,archived_at:null,created_at:'2026-11-14T08:00:00Z',opening_hours:[]};
 assert.equal(siteSettings.safeParse({site}).success,false);assert.equal(siteSettings.parse({site,can_write:false}).can_write,false);
 assert.equal(sitePage.parse({sites:[site],next_after:null}).sites[0].settings_version,3);
 const result=organizationOverview.parse({organization:{id,name:'QA',owner_id:actor},current_role:'viewer',members:[{user_id:actor,role:'viewer',full_name:'QA'}],permissions:{can_manage:false},limits:{members_limited:false},site_access:{organization_id:id,can_manage:false,members:[{user_id:actor,role:'viewer',scope:'selected',grants:[{site_id:id,can_write:false}]}]}});
 assert.equal(result.site_access.members[0].scope,'selected');assert.equal(result.site_access.members[0].grants[0].can_write,false);
 assert.equal(siteEditValues({name:'',address:'abc',access_notes:''}).success,false);
});
test('management list schemas accept authorized empty pages and reject missing totals',()=>{
 const page={limit:25,has_more:false,next_cursor:null,total:0};
 assert.equal(adminInterventions.parse({interventions:[],page}).page.total,0);
 assert.equal(directoryPage.parse({kind:'clients',items:[],page}).items.length,0);
 assert.equal(directoryPage.safeParse({kind:'clients',items:[],page:{limit:25,has_more:false,next_cursor:null}}).success,false);
});
