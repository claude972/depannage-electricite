import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationActions,artisanApplication,calendarDate,contractPage,approvalDetail } from '../apps/mobile/src/lib/management-contracts';
const id='10000000-0000-4000-8000-000000000001';
test('native artisan decision availability follows current state, never absent/draft dossier',()=>{
 assert.deepEqual(applicationActions('draft'),[]);assert.deepEqual(applicationActions('changes_requested'),[]);
 assert.deepEqual(applicationActions('submitted'),['approve','request_changes']);assert.deepEqual(applicationActions('approved'),['suspend']);assert.deepEqual(applicationActions('suspended'),['reinstate']);
 assert.equal(artisanApplication.parse({artisan_profile:null,credentials:[]}).artisan_profile,null);
 assert.equal(artisanApplication.safeParse({artisan_profile:{user_id:id,application_status:'submitted'},credentials:[]}).success,false);
});
test('calendar dates do not shift backwards with local timezone',()=>{
 assert.equal(calendarDate('2026-11-14'),'14/11/2026');
 const item={id,organization_id:id,title:'Contrat QA',reference:'QA',starts_on:'2026-11-14',ends_on:null,status:'active',created_at:'2026-11-14T00:00:00Z'};
 assert.equal(contractPage.parse({items:[item],page:{limit:50,has_more:false,next_cursor:null}}).items[0].starts_on,'2026-11-14');
 assert.equal(contractPage.safeParse({items:[{...item,starts_on:'2026-02-31'}],page:{limit:50,has_more:false,next_cursor:null}}).success,false);
});
test('approval preserves source quote amount and optional rule, without inventing payment proof',()=>{
 const item={id,quote_id:id,site_id:id,status:'pending',note:'',created_at:'2026-11-14T00:00:00Z',decided_at:null,site:{id,name:'Site QA',organization_id:id},quote:{id,intervention_id:id,total_cents:15000,status:'sent'},intervention:{id,category:'outage',status:'quoted'}};
 const result=approvalDetail.parse({approval:item,rule:null});assert.equal(result.approval.quote.total_cents,15000);assert.equal(result.rule,null);assert.equal('paid' in result.approval,false);
});
