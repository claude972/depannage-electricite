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
