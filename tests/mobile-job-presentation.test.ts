import test from 'node:test';
import assert from 'node:assert/strict';
import { job, quoteSummary, payment, workspace, euros } from '../apps/mobile/src/lib/contracts';
import { dossierAmount, dossierStep, jobStatus, paymentLabel } from '../apps/mobile/src/lib/job-presentation';
import { spaceTabs } from '../apps/mobile/src/lib/mobile-navigation';
const id='74da2e56-ff80-463b-bbc5-26c6de826b0e', qid='84da2e56-ff80-463b-bbc5-26c6de826b0e';
const base=job.parse({id,category:'outage',status:'requested',city:'Fort-de-France',urgency:'urgent',estimate_min_cents:9000,estimate_max_cents:18000,created_at:'2026-11-14T10:00:00Z'});
const quote=quoteSummary.parse({id:qid,intervention_id:id,status:'accepted',total_cents:10000,accepted_total_cents:14000});
const paid=payment.parse({id,quote_id:qid,total_cents:14000,status:'paid',method:'stripe',paid_at:'2026-11-14T10:00:00Z'});
test('workspace keeps accepted totals and payment provenance',()=>{
 const result=workspace.parse({profile:{id,role:'client',full_name:'Démo',artisan_approved:false},interventions:[base],quotes:[quote],payments:[paid]});
 assert.deepEqual(result.quotes,[quote]);assert.deepEqual(result.payments,[paid]);
});
test('estimate is qualified and never substituted for missing accepted data',()=>{
 assert.equal(dossierAmount(base).label,'Estimation indicative');
 for(const status of ['quoted','accepted','in_progress','completed','paid'] as const) assert.equal(dossierAmount({...base,status}).label,'Montant du devis indisponible');
 const {accepted_total_cents,...incomplete}=quote;
 assert.equal(dossierAmount({...base,status:'accepted'},[incomplete]).label,'Montant accepté à vérifier');
});
test('accepted total includes amendments, and unrelated payments cannot settle a dossier',()=>{
 assert.deepEqual(dossierAmount({...base,status:'completed'},[quote]),{label:'À régler',value:euros(14000)});
 assert.equal(dossierAmount({...base,status:'completed'},[quote],[{...paid,quote_id:id}]).label,'À régler');
 assert.equal(dossierAmount({...base,status:'paid'},[quote],[paid]).label,'Règlement confirmé par la plateforme');
});
test('historical declarations and pending/failed attempts remain distinct from bank confirmation',()=>{
 assert.match(paymentLabel({...paid,method:'on_site_declared'}),/sans confirmation bancaire/);
 assert.match(paymentLabel({...paid,method:undefined}),/preuve bancaire non précisée/);
 assert.match(dossierAmount({...base,status:'completed'},[quote],[{...paid,status:'pending'}]).label,/attente de confirmation/);
 assert.equal(dossierAmount({...base,status:'completed'},[quote],[{...paid,status:'failed'}]).label,'Paiement non abouti');
});
test('role labels and chronology do not imply artisan payout',()=>{
 assert.equal(jobStatus('completed','client'),'À régler');assert.equal(jobStatus('completed','artisan'),'Règlement attendu');
 assert.equal(jobStatus('paid','artisan'),'Dossier réglé');assert.equal(dossierStep('cancelled'),-1);
 assert.deepEqual(['requested','assigned','quoted','accepted','in_progress','completed','paid'].map(s=>dossierStep(s as typeof base.status)),[0,1,2,3,3,4,4]);
});
test('client and artisan tabs follow their own journeys',()=>{
 assert.deepEqual(spaceTabs('client'),['profil','interventions','messages','aide']);
 assert.deepEqual(spaceTabs('artisan'),['accueil','interventions','devis','messages','profil']);
 assert.equal(spaceTabs('admin').includes('devis' as never),false);
});
