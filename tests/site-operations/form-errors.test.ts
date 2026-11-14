import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldErrors } from '../../lib/features/site-operations/forms';
import { contractGridPayload, fiscalYearPayload, erpChecklistPayload } from '../../lib/features/site-operations/schemas';
test('budget dates and required label use French field messages', () => {
 const errors = fieldErrors(fiscalYearPayload, {label:'',starts_on:'',ends_on:'',status:'open'});
 assert.equal(errors.label,'Indiquez le libellé.');
 assert.equal(errors.starts_on,'Indiquez la date de début.');
 assert.equal(errors.ends_on,'Indiquez la date de fin.');
});
test('each repeated grid error keeps its full path and aggregate', () => {
 const errors=fieldErrors(contractGridPayload,{label:'Grille',contract_id:null,effective_from:null,lines:[{label:'',unit:'hour',amount_cents:NaN,note:''},{label:'',unit:'hour',amount_cents:0,note:''}]});
 assert.equal(errors['lines.0.label'],'Indiquez le libellé de la ligne.');
 assert.equal(errors['lines.1.label'],'Indiquez le libellé de la ligne.');
 assert.equal(errors['lines.0.amount_cents'],'Indiquez un montant valide en euros.');
 assert.ok(errors.lines);
});
test('ERP point error attaches to the correct repeated point',()=>{
 const errors=fieldErrors(erpChecklistPayload,{title:'Contrôle',description:'',performed_on:null,performed_by_label:'',status:'draft',items:[{key:'p1',label:'',state:'not_checked',note:'',reserve_resolved_on:null}]});
 assert.equal(errors['items.0.label'],'Indiquez l’intitulé du point.');
});
