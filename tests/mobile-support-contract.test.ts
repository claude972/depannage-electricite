import test from 'node:test';
import assert from 'node:assert/strict';
import { supportCommand, supportReceipt, supportRetry } from '../apps/mobile/src/lib/support-contract';
const actor='10000000-0000-4000-8000-000000000001', dossier='10000000-0000-4000-8000-000000000002', other='10000000-0000-4000-8000-000000000003';
const command={request_id:other,subject:'Question sur le dossier',body:'Comment compléter mon adresse ?',intervention_id:dossier};
const date='2026-11-14T12:00:00Z';
const response=()=>({ticket:{id:other,creator_id:actor,intervention_id:dossier,subject:command.subject,status:'open',version:1,created_at:date,updated_at:date,last_message_at:date},initial_message:{id:dossier,ticket_id:other,author_id:actor,author_kind:'user',version:1,body:command.body,created_at:date},replayed:false});
test('support accepts both initial and replayed receipts for the exact command',()=>{
 const schema=supportReceipt(command,actor);assert.equal(schema.safeParse(response()).success,true);
 assert.equal(schema.safeParse({...response(),replayed:true}).success,true);
});
test('support refuses receipts from another account, dossier, message or ticket',()=>{
 const schema=supportReceipt(command,actor);
 for(const patch of [{creator_id:other},{intervention_id:other},{subject:'Une autre question'}])assert.equal(schema.safeParse({...response(),ticket:{...response().ticket,...patch}}).success,false);
 for(const patch of [{author_id:other},{ticket_id:actor},{body:'Autre contenu'},{version:2}])assert.equal(schema.safeParse({...response(),initial_message:{...response().initial_message,...patch}}).success,false);
 assert.equal(schema.safeParse({ticket:{id:other},replayed:false}).success,false);
});
test('retry preserves the exact command and refuses a different scope',()=>{
 const intent={actor_id:actor,command};assert.deepEqual(supportRetry(intent,actor,dossier),command);
 assert.throws(()=>supportRetry(intent,other,dossier));assert.throws(()=>supportRetry(intent,actor,other));assert.throws(()=>supportRetry(intent,actor,null));
});
test('support validates server text limits and null dossier without fabricating one',()=>{
 assert.equal(supportCommand.safeParse({...command,intervention_id:null}).success,true);
 for(const patch of [{subject:'abc'},{subject:'a'.repeat(161)},{body:'court'},{body:'a'.repeat(4001)},{body:'message avec\u0000nul'},{intervention_id:'demo-002'}])assert.equal(supportCommand.safeParse({...command,...patch}).success,false);
});

test('confirmed support clears only the submitted draft, preserving later edits',async()=>{
 const {confirmSupportDraft,supportDraftKey}=await import('../apps/mobile/src/lib/support-contract');
 const draft={subject:command.subject,body:command.body,pending:{actor_id:actor,command},confirmedTicketId:null};
 assert.deepEqual(confirmSupportDraft(draft,actor,dossier,response()),{subject:'',body:'',pending:null,confirmedTicketId:other});
 const edited={...draft,body:'Une précision ajoutée pendant la requête'};
 assert.equal(confirmSupportDraft(edited,actor,dossier,response()).body,edited.body);
 assert.throws(()=>confirmSupportDraft(draft,other,dossier,response()));
 assert.throws(()=>confirmSupportDraft(draft,actor,dossier,{...response(),ticket:{...response().ticket,creator_id:other}}));
 assert.notEqual(supportDraftKey(actor,dossier),supportDraftKey(other,dossier));
 assert.notEqual(supportDraftKey(actor,dossier),supportDraftKey(actor,null));
 assert.throws(()=>supportDraftKey(actor,'../autre'));
});

test('ticket history rejects another ticket and non-advancing pagination',async()=>{
 const {supportDetailFor}=await import('../apps/mobile/src/lib/support-contract');
 const detail={ticket:response().ticket,messages:[response().initial_message],events:[],permissions:{can_reply:false,can_set_status:false},page:{limit:50,after_version:0,next_after_version:null,has_more:false,total_events:1,total_messages:1}};
 const schema=supportDetailFor(other);
 assert.equal(schema.safeParse(detail).success,true);
 assert.equal(supportDetailFor(actor).safeParse(detail).success,false);
 assert.equal(schema.safeParse({...detail,messages:[{...detail.messages[0],ticket_id:actor}]}).success,false);
 assert.equal(schema.safeParse({...detail,page:{...detail.page,has_more:true}}).success,false);
 assert.equal(schema.safeParse({...detail,page:{...detail.page,after_version:2,next_after_version:2,has_more:true}}).success,false);
 assert.equal(schema.safeParse({...detail,page:{...detail.page,after_version:2,next_after_version:3,has_more:true}}).success,true);
});

test('reply receipt and recovery require the exact author, content and next revision',async()=>{
 const {supportReplyReceipt,pendingReplyRecorded}=await import('../apps/mobile/src/lib/support-contract');
 const value={ticket:{...response().ticket,version:3},message:{...response().initial_message,version:3}};
 const schema=supportReplyReceipt(other,actor,2,command.body);
 assert.equal(schema.safeParse(value).success,true);
 assert.equal(schema.safeParse({...value,message:{...value.message,author_id:other}}).success,false);
 assert.equal(schema.safeParse({...value,ticket:{...value.ticket,version:4}}).success,false);
 const detail={ticket:value.ticket,messages:[value.message],events:[],permissions:{can_reply:true,can_set_status:false},page:{limit:50,after_version:2,next_after_version:null,has_more:false,total_events:3,total_messages:2}};
 assert.equal(pendingReplyRecorded(detail as Parameters<typeof pendingReplyRecorded>[0],actor,{body:command.body,version:2}),true);
 assert.equal(pendingReplyRecorded(detail as Parameters<typeof pendingReplyRecorded>[0],actor,{body:'Un autre message',version:2}),false);
});
