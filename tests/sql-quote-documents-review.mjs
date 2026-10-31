process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'',(error.stack||'').split('\n')[1]||'');process.exit(1)});
// ADV-DOCUMENTS-001: isolated PostgreSQL review of migration 015 (quote validity, amendments, documents).
// Auth/Storage are explicit stubs; this is not a live Supabase test. Time passing is simulated by a
// service-role update of the stored validity date, never by a change of the server clock.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
const target='202610310015_quote_documents.sql';
assert.ok(files.includes(target));
// 015 must run on 001-013 alone: 014/016/017 (other lots) are deliberately excluded here.
const base=files.filter(n=>n<'202610310014');
for(const name of base)await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists pgcrypto;','-- extension omitted only in this isolated harness'));
const helpers=['is_admin()','owns_intervention(uuid)','can_access_intervention(uuid)','can_access_site(uuid)','can_manage_site(uuid)','is_org_member(uuid,boolean)','lock_intervention_organization(uuid)','intervention_action(uuid,text,jsonb,numeric,uuid)','decide_approval(uuid,text,text)'];
async function snapshot(){
 const defs={};
 for(const h of helpers)defs[h]=(await db.query(`select pg_get_functiondef('public.${h}'::regprocedure) v`)).rows[0].v;
 const policies=(await db.query("select schemaname,tablename,policyname,cmd,roles::text,qual,with_check from pg_policies where schemaname in ('public','storage') and tablename in ('quotes','documents','objects','approvals','interventions') order by 1,2,3")).rows;
 const columns=(await db.query("select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='quotes' order by ordinal_position")).rows;
 const grants=(await db.query("select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('quotes','documents','approvals') order by 1,2")).rows;
 return JSON.stringify({defs,policies,columns,grants});
}
const before=await snapshot();
const source=await readFile(new URL(target,dir),'utf8');
await db.exec(source.replace('create extension if not exists pgcrypto;','-- extension omitted only in this isolated harness'));
console.log(`PASS: ${base.length+1} migrations (001-013 then 015) execute under isolated PostgreSQL with Auth/Storage stubs`);
assert.equal(await snapshot(),before);
assert.doesNotMatch(source,/create\s+or\s+replace\s+function/i);
assert.doesNotMatch(source,/alter\s+table\s+public\.(quotes|interventions|documents|profiles|artisan_profiles)/i);
assert.doesNotMatch(source,/drop\s+policy|alter\s+policy|storage\.buckets|update\s+public\.quotes\s+set/i);
assert.ok(source.includes("set search_path=''"));
console.log('PASS: 015 is additive; quote columns, prior helpers, policies and grants are byte-identical before and after');
for(const fn of ['set_quote_terms(uuid,date)','propose_quote_amendment(uuid,jsonb,numeric,text,date)','withdraw_quote_amendment(uuid)','decide_quote_amendment(uuid,text,text)','generate_quote_document(uuid,uuid)','record_quote_document_download(uuid)','quote_documents_overview(uuid)'])
 for(const role of ['anon','authenticated','public'])assert.equal((await db.query(`select has_function_privilege($1,'public.${fn}','execute') v`,[role])).rows[0].v,role==='authenticated',`${fn} ${role}`);
for(const fn of ['quote_document_snapshot(uuid,uuid)','quote_document_issuer(uuid)','guard_quote_validity()'])
 for(const role of ['anon','authenticated','public'])assert.equal((await db.query(`select has_function_privilege($1,'public.${fn}','execute') v`,[role])).rows[0].v,false,`${fn} ${role}`);
console.log('PASS: only the seven commands are callable by authenticated; snapshot/issuer/guard stay private');

const ids={};let index=1;
for(const actor of ['client','otherClient','artisan','otherArtisan','manager','viewer','admin']){
 ids[actor]=`70000000-0000-4000-8000-${String(index++).padStart(12,'0')}`;
 const role=actor==='artisan'||actor==='otherArtisan'?'artisan':actor==='manager'||actor==='viewer'?'manager':'client';
 await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[ids[actor],JSON.stringify({role,full_name:actor==='artisan'?'Jean QA':actor}),`${actor.toLowerCase()}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
async function as(actor,sql,params=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);try{return await db.query(sql,params)}finally{await db.exec('reset role')}}
async function value(actor,sql,params=[]){return(await as(actor,sql,params)).rows[0].v}
async function rejectsCode(promise,code){await assert.rejects(promise,error=>error.code===code||(console.error('unexpected code',error.code,error.message),false))}
async function count(sql,params=[]){return(await db.query(`select count(*)::int n from ${sql}`,params)).rows[0].n}
const lines=[{label:'Déplacement',quantity:1,unit_price_cents:8000},{label:'Main-d’œuvre',quantity:2,unit_price_cents:6000}];
const overview=(actor,job)=>value(actor,'select public.quote_documents_overview($1) v',[job]);
const terms=(actor,quote,date)=>value(actor,'select public.set_quote_terms($1,$2) v',[quote,date]);
const generate=(actor,quote,amendment=null)=>value(actor,'select public.generate_quote_document($1,$2) v',[quote,amendment]);
const download=(actor,doc)=>value(actor,'select public.record_quote_document_download($1) v',[doc]);
const propose=(actor,quote,l=lines,tax=20,reason='Travaux supplémentaires constatés sur place',valid=null)=>value(actor,'select public.propose_quote_amendment($1,$2,$3,$4,$5) v',[quote,JSON.stringify(l),tax,reason,valid]);
const decide=(actor,id,decision,note='')=>value(actor,'select public.decide_quote_amendment($1,$2,$3) v',[id,decision,note]);
const withdraw=(actor,id)=>value(actor,'select public.withdraw_quote_amendment($1) v',[id]);
for(const actor of ['artisan','otherArtisan']){
 await as(actor,"select public.save_artisan_profile('Entreprise QA','12345678901234','EI',0,'12 rue du Test',array['97200'],array['panel'])");
 await as(actor,'select public.submit_artisan_application()');
 await as('admin','select public.approve_artisan($1,true)',[ids[actor]]);
 await as(actor,'select public.set_artisan_availability(true)');
}
async function newJob(actor='client',site=null,artisan='artisan'){
 const row=(await as(actor,"select * from public.create_intervention('panel','Le tableau présente des déclenchements.','12 rue du Test','97200','Fort-de-France','urgent',$1)",[site])).rows[0];
 await as(artisan,"select public.intervention_action($1,'accept_mission')",[row.id]);return row.id;
}
async function sendQuote(job,l=lines,artisan='artisan'){
 await as(artisan,"select public.intervention_action($1,'send_quote',$2,20)",[job,JSON.stringify(l)]);
 return(await db.query("select id from public.quotes where intervention_id=$1 and status='sent'",[job])).rows[0].id;
}
const today=(await db.query("select (now() at time zone 'UTC')::date::text v")).rows[0].v;
async function plusDays(n){return(await db.query("select ((now() at time zone 'UTC')::date+$1::int)::text v",[n])).rows[0].v}

// --- Validity on a sent quote ---------------------------------------------------------------
const job=await newJob();const quote=await sendQuote(job);
for(const actor of ['otherArtisan','client','manager','admin'])await rejectsCode(terms(actor,quote,null),'42501');
await db.exec('set role anon');await assert.rejects(db.query('select public.set_quote_terms($1,null)',[quote]));await db.exec('reset role');
await rejectsCode(terms('artisan',quote,await plusDays(-1)),'22023');
assert.equal((await terms('artisan',quote,null)).validity,'unspecified');
const future=await plusDays(10);
const set=await terms('artisan',quote,future);assert.equal(set.validity,'valid');assert.equal(set.valid_until,future);
let view=await overview('client',job);
assert.equal(view.quotes.length,1);assert.equal(view.quotes[0].terms.validity,'valid');assert.equal(view.quotes[0].reference.length,10);
assert.deepEqual(view.quotes[0].permissions,{can_set_terms:false,can_generate:true,can_propose:false});
assert.equal(view.viewer.can_manage,true);assert.equal(view.settlement,'not_connected');assert.deepEqual(view.issuer,{ready:true,missing:[]});
view=await overview('artisan',job);assert.equal(view.quotes[0].permissions.can_set_terms,true);assert.equal(view.quotes[0].permissions.can_propose,false);
await rejectsCode(overview('otherClient',job),'42501');await rejectsCode(overview('otherArtisan',job),'42501');
assert.equal((await as('otherClient','select * from public.quote_terms where quote_id=$1',[quote])).rows.length,0);
assert.equal((await as('client','select * from public.quote_terms where quote_id=$1',[quote])).rows.length,1);
await assert.rejects(as('client','update public.quote_terms set valid_until=null where quote_id=$1',[quote]));
console.log('PASS: validity is set only by the attributed approved artisan on a sent quote; past dates refused; unset stays explicit; reads follow dossier access');

// --- Documents: generation, idempotence, issuer configuration, download audit ----------------
await db.query("update public.artisan_profiles set company_name='' where user_id=$1",[ids.artisan]);
await rejectsCode(generate('client',quote),'QD001');
await assert.rejects(generate('client',quote),e=>/issuer_incomplete:company_name/.test(e.message));
assert.equal(await count('public.quote_documents'),0);
await db.query("update public.artisan_profiles set company_name='Entreprise QA' where user_id=$1",[ids.artisan]);
const first=await generate('client',quote);assert.equal(first.created,true);assert.equal(first.document.revision,1);assert.equal(first.document.kind,'quote');
const again=await generate('artisan',quote);assert.equal(again.created,false);assert.equal(again.document.id,first.document.id);
await rejectsCode(generate('otherClient',quote),'42501');await rejectsCode(generate('otherArtisan',quote),'42501');
assert.equal(await count('public.quote_documents'),1);
const stored=(await db.query('select * from public.quote_documents where id=$1',[first.document.id])).rows[0];
assert.equal(stored.snapshot.quote.status,'sent');assert.equal(stored.snapshot.quote.total_cents,24000);assert.equal(stored.snapshot.quote.tax_rate,20);
assert.equal(stored.snapshot.quote.terms.validity,'valid');assert.equal(stored.snapshot.issuer.siret,'12345678901234');assert.equal(stored.snapshot.issuer.contact_name,'Jean QA');
assert.ok(stored.snapshot.issuer.missing_optional.includes('vat_number'));assert.equal(stored.snapshot.issuer.missing,undefined);
assert.equal(stored.snapshot.amendment,null);assert.equal(stored.snapshot.settlement,'not_connected');assert.equal(stored.snapshot.recipient.organization,null);
assert.match(stored.snapshot_sha256,/^[a-f0-9]{64}$/);
const dl=await download('client',first.document.id);assert.equal(dl.document.id,first.document.id);assert.equal(dl.snapshot.reference,stored.reference);
await rejectsCode(download('otherClient',first.document.id),'P0002');
assert.equal((await as('otherClient','select * from public.quote_documents where id=$1',[first.document.id])).rows.length,0);
await as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[job,quote]);
const accepted=await generate('client',quote);assert.equal(accepted.created,true);assert.equal(accepted.document.revision,2);
assert.equal((await db.query('select snapshot->$2 v from public.quote_documents where id=$1',[accepted.document.id,'quote'])).rows[0].v.status,'accepted');
const history=(await overview('client',job)).history.map(e=>e.action);
assert.deepEqual(history,['document_generated','document_downloaded','document_generated','terms_set','terms_set']);
console.log('PASS: generation needs a complete issuer (QD001 lists the fields), is idempotent per snapshot, re-issues a revision after acceptance; downloads are private and audited');

// --- Validity guard on acceptance (no retro-expiration) -------------------------------------
const guarded=await newJob();const guardedQuote=await sendQuote(guarded);
await terms('artisan',guardedQuote,today);
await db.query("update public.quote_terms set valid_until=(now() at time zone 'UTC')::date-1 where quote_id=$1",[guardedQuote]);
assert.equal((await overview('client',guarded)).quotes[0].terms.validity,'expired');
await rejectsCode(as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[guarded,guardedQuote]),'P0001');
assert.equal((await db.query('select status from public.quotes where id=$1',[guardedQuote])).rows[0].status,'sent');
await db.query('update public.quote_terms set valid_until=null where quote_id=$1',[guardedQuote]);
await as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[guarded,guardedQuote]);
assert.equal((await db.query('select status from public.quotes where id=$1',[guardedQuote])).rows[0].status,'accepted');
await rejectsCode(terms('artisan',guardedQuote,future),'P0001');
const unset=await newJob();const unsetQuote=await sendQuote(unset);
await as('client',"select public.intervention_action($1,'accept_quote',null,20,$2)",[unset,unsetQuote]);
console.log('PASS: an explicitly expired quote cannot be accepted; a quote without validity never expires; terms freeze after decision');

// --- Amendments on the accepted quote --------------------------------------------------------
for(const actor of ['otherArtisan','client','manager','admin'])await rejectsCode(propose(actor,quote),'42501');
const pendingJob=await newJob();const pendingQuote=await sendQuote(pendingJob);
await rejectsCode(propose('artisan',pendingQuote),'P0001');
await rejectsCode(propose('otherArtisan',pendingQuote),'42501');
await rejectsCode(propose('artisan',quote,[]),'22023');
await rejectsCode(propose('artisan',quote,[{label:'',quantity:1,unit_price_cents:100}]),'22023');
await rejectsCode(propose('artisan',quote,[{label:'Pièce',quantity:1,unit_price_cents:100,total_cents:1}]),'22023');
await rejectsCode(propose('artisan',quote,lines,7),'22023');
await rejectsCode(propose('artisan',quote,lines,20,''),'22023');
await rejectsCode(propose('artisan',quote,lines,20,'Motif',await plusDays(-1)),'22023');
assert.equal(await count('public.quote_amendments'),0);
const v1=await propose('artisan',quote,[{label:'Disjoncteur supplémentaire',quantity:2,unit_price_cents:6000}]);
assert.equal(v1.version,1);assert.equal(v1.status,'proposed');assert.equal(v1.subtotal_cents,12000);assert.equal(v1.tax_cents,2400);assert.equal(v1.total_cents,14400);
assert.equal(v1.reference,`AV-1-${stored.reference}`);assert.equal(v1.terms.validity,'unspecified');
await rejectsCode(propose('artisan',quote),'P0001');
assert.equal((await overview('artisan',job)).quotes[0].permissions.can_propose,false);
for(const actor of ['artisan','otherClient','otherArtisan','admin'])await rejectsCode(decide(actor,v1.id,'accepted'),'42501');
await rejectsCode(decide('client',v1.id,'maybe'),'22023');
const rejected=await decide('client',v1.id,'rejected','Trop cher pour ce poste');
assert.equal(rejected.status,'rejected');assert.equal(rejected.decision_note,'Trop cher pour ce poste');
await rejectsCode(decide('client',v1.id,'accepted'),'P0001');
const v2=await propose('artisan',quote);assert.equal(v2.version,2);
await rejectsCode(withdraw('client',v2.id),'42501');
assert.equal((await withdraw('artisan',v2.id)).status,'withdrawn');
await rejectsCode(withdraw('artisan',v2.id),'P0001');
const v3=await propose('artisan',quote,lines,20,'Reprise du tableau',future);
view=await overview('client',job);
assert.deepEqual(view.quotes[0].amendments.map(a=>a.version),[3,2,1]);
assert.deepEqual(view.quotes[0].amendments[0].permissions,{can_decide:true,can_withdraw:false,can_generate:true});
assert.deepEqual((await overview('artisan',job)).quotes[0].amendments[0].permissions,{can_decide:false,can_withdraw:true,can_generate:true});
const acceptedAmendment=await decide('client',v3.id,'accepted');
assert.equal(acceptedAmendment.status,'accepted');assert.ok(acceptedAmendment.decided_at);
await rejectsCode(decide('client',v3.id,'accepted'),'P0001');
await rejectsCode(decide('client',v3.id,'rejected'),'P0001');
assert.equal((await db.query('select total_cents,status from public.quotes where id=$1',[quote])).rows[0].total_cents,24000);
const amendmentDoc=await generate('artisan',quote,v3.id);
assert.equal(amendmentDoc.document.kind,'amendment');assert.equal(amendmentDoc.document.reference,`AV-3-${stored.reference}`);
const amendmentSnapshot=(await db.query('select snapshot v from public.quote_documents where id=$1',[amendmentDoc.document.id])).rows[0].v;
assert.equal(amendmentSnapshot.amendment.total_cents,24000);assert.equal(amendmentSnapshot.amendment.cumulative_total_cents,48000);assert.equal(amendmentSnapshot.amendment.status,'accepted');
await rejectsCode(generate('artisan',guardedQuote,v3.id),'P0002');
const v4=await propose('artisan',quote,lines,20,'Validité courte',today);
await db.query("update public.quote_amendments set valid_until=(now() at time zone 'UTC')::date-1 where id=$1",[v4.id]);
await rejectsCode(decide('client',v4.id,'accepted'),'P0001');
assert.equal((await decide('client',v4.id,'rejected','Expiré')).status,'rejected');
assert.deepEqual((await db.query("select action from public.audit_log where intervention_id=$1 and action like 'amendment_%' order by id",[job])).rows.map(r=>r.action),['amendment_proposed','amendment_rejected','amendment_proposed','amendment_withdrawn','amendment_proposed','amendment_accepted','amendment_proposed','amendment_rejected']);
await as('artisan',"select public.intervention_action($1,'start')",[job]);
const v5=await propose('artisan',quote,lines,20,'Pendant les travaux');
await as('artisan',"select public.intervention_action($1,'complete')",[job]);
await rejectsCode(decide('client',v5.id,'accepted'),'P0001');
await rejectsCode(propose('artisan',quote),'P0001');
console.log('PASS: amendments are versioned on the accepted quote, computed server-side, single proposal at a time, decided by exact id once; accepted quote untouched; expiry and completion block acceptance');

// --- B2B: approval threshold, viewer, removed member, reassignment ---------------------------
const site=(await as('manager',"select * from public.create_site('Siège QA','office','1 avenue du Test',100000)")).rows[0];
await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')",[site.organization_id,ids.viewer]);
await as('manager',"select public.set_approval_rule($1,20000,'owner',true)",[site.id]);
const b2b=await newJob('manager',site.id);
const b2bQuote=await sendQuote(b2b,[{label:'Diagnostic',quantity:1,unit_price_cents:10000}]);
await as('manager',"select public.intervention_action($1,'accept_quote',null,20,$2)",[b2b,b2bQuote]);
const b2bDoc=await generate('manager',b2bQuote);
assert.equal((await db.query('select snapshot v from public.quote_documents where id=$1',[b2bDoc.document.id])).rows[0].v.recipient.site.name,'Siège QA');
const viewerView=await overview('viewer',b2b);assert.equal(viewerView.viewer.can_manage,false);assert.equal(viewerView.quotes[0].permissions.can_generate,false);
await rejectsCode(generate('viewer',b2bQuote),'42501');
assert.equal((await download('viewer',b2bDoc.document.id)).document.id,b2bDoc.document.id);
const over=await propose('artisan',b2bQuote,[{label:'Câblage',quantity:1,unit_price_cents:7000}]);
await rejectsCode(decide('viewer',over.id,'accepted'),'42501');
await rejectsCode(decide('manager',over.id,'accepted'),'P0001');
assert.equal((await db.query('select status from public.quote_amendments where id=$1',[over.id])).rows[0].status,'proposed');
assert.equal((await decide('manager',over.id,'rejected','Au-delà du seuil')).status,'rejected');
const under=await propose('artisan',b2bQuote,[{label:'Câblage',quantity:1,unit_price_cents:5000}]);
assert.equal((await decide('manager',under.id,'accepted')).status,'accepted');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[site.organization_id,ids.viewer]);
await rejectsCode(overview('viewer',b2b),'42501');
assert.equal((await as('viewer','select * from public.quote_documents where quote_id=$1',[b2bQuote])).rows.length,0);
await rejectsCode(download('viewer',b2bDoc.document.id),'P0002');
const moved=await newJob();const movedQuote=await sendQuote(moved);
await as('admin',"select public.reassign_intervention($1,$2,'Réaffectation QA')",[moved,ids.otherArtisan]);
await rejectsCode(terms('artisan',movedQuote,future),'42501');
await rejectsCode(overview('artisan',moved),'42501');
console.log('PASS: site approval thresholds block amendment acceptance explicitly; viewers read but never decide/generate; removed members and reassigned artisans lose every access');
console.log('PASS: sql-quote-documents-review complete');
