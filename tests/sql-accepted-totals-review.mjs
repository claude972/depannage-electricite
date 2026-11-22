// Actual migrations001–027, isolated PGlite0.5.4. Auth/Storage/cron stubs; no provider proof.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const denied=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),target='202611010022_guest_booking.sql';const files=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&n<target).sort();eq(files.length,21);
 for(const f of files)await db.exec((await isolatedMigrationSql(db,f,await readFile(new URL(f,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- TEST ONLY extension omitted'));
 const defs=async()=>Promise.all(['create_intervention(text,text,text,text,text,text,uuid)','create_intervention_once(uuid,text,text,text,text,text,text,uuid)','can_access_intervention(uuid)'].map(async f=>(await db.query('select pg_get_functiondef($1::regprocedure) v',['public.'+f])).rows[0].v));
 const before=await defs();await db.exec(await readFile(new URL(target,dir),'utf8'));eq(await defs(),before);
 await db.exec(await readFile(new URL('202611010023_pending_booking.sql',dir),'utf8'));await db.exec(await readFile(new URL('202611010024_guest_settlement.sql',dir),'utf8'));
 const attemptFunctionBefore=(await db.query("select pg_get_functiondef('public.record_payment_attempt()'::regprocedure) v")).rows[0].v;await db.exec(await readFile(new URL('202611010025_onsite_receipt.sql',dir),'utf8'));eq((await db.query("select pg_get_functiondef('public.record_payment_attempt()'::regprocedure) v")).rows[0].v,attemptFunctionBefore);
 const ids={a:randomUUID(),b:randomUUID(),artisan:randomUUID(),other:randomUUID(),admin:randomUUID()};for(const label of Object.keys(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[ids[label],JSON.stringify({role:['artisan','other'].includes(label)?'artisan':label==='admin'?'admin':'client',full_name:'QA '+label}),label+'@example.invalid']);
 // Isolated database only: explicit synthetic admin for aggregate ACL checks; never a cloud account.
 await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
 for(const id of[ids.artisan,ids.other]){await db.query('update public.profiles set artisan_approved=true where id=$1',[id]);await db.query("insert into public.artisan_profiles(user_id,application_status)values($1,'approved')on conflict(user_id)do update set application_status='approved'",[id]);}
 const as=async(label,sql,args=[])=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[label]||'']);try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 const payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'Panne synthétique QA reçu déclaré',address:'Adresse technique QA sans déplacement',postal_code:'97200',city:'Commune synthétique QA',urgency:'scheduled'},contact={first_name:'QA',last_name:'Essai',email:'',phone:'+596696000000'};
 const job=(await as('a','select public.create_on_site_booking($1,$2,$3) v',[randomUUID(),JSON.stringify(payload),JSON.stringify(contact)])).rows[0].v.intervention.id;
 await db.query("update public.interventions set artisan_id=$2,status='in_progress' where id=$1",[job,ids.artisan]);const q=randomUUID();
 await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[q,job,ids.artisan]);const am=randomUUID();
 await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,1,'QA synthétique','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":2500}]',2500,20,500,3000,'accepted')",[am,job,q,ids.artisan]);

 await db.exec(await readFile(new URL('202611010026_invoice_settlement_total.sql',dir),'utf8'));
 const org=(await db.query("insert into public.organizations(name,owner_id)values('QA totals',$1)returning id",[ids.a])).rows[0].id;
 await db.query("insert into public.organization_members(organization_id,user_id,role)values($1,$2,'owner'),($1,$3,'manager')",[org,ids.a,ids.b]);await db.query("update public.profiles set role='manager' where id=$1",[ids.b]);
 const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA totals','office','Adresse synthétique QA',100000)returning id",[org])).rows[0].id;
 await as('a','select public.set_organization_member_site_access($1,$2,$3,$4)',[org,ids.b,'selected',JSON.stringify([{site_id:site,can_write:false}])]);
 const fy=(await db.query("insert into public.organization_fiscal_years(organization_id,label,starts_on,ends_on,status,created_by)values($1,'QA2026','2026-01-01','2026-12-31','open',$2)returning id",[org,ids.a])).rows[0].id;
 await db.query("update public.interventions set site_id=$2,status='completed' where id=$1",[job,site]);await db.query("update public.quotes set accepted_at='2026-03-01T10:00:00Z' where id=$1",[q]);
 for(const [version,status]of[[2,'proposed'],[3,'rejected']])await db.query("insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,'QA excluded','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":1000}]',1000,20,200,1200,$5)",[job,q,ids.artisan,version,status]);
 await as('artisan','select public.declare_onsite_receipt($1)',[job]);
 const snapshot=async(actor='b')=>(await as(actor,'select public.site_operations_snapshot($1) v',[site])).rows[0].v;
 const oldSnapshot=await snapshot();eq(oldSnapshot.budget_consumption[0].accepted_cents,12000);eq(oldSnapshot.budget_consumption[0].paid_cents,12000);
 const acl=await scalar("select proacl::text v from pg_proc where oid='public.site_operations_snapshot(uuid)'::regprocedure");
 await db.exec(await readFile(new URL('202611010027_accepted_quote_totals.sql',dir),'utf8'));
 eq(await scalar("select proacl::text v from pg_proc where oid='public.site_operations_snapshot(uuid)'::regprocedure"),acl);
 const totals=async(actor,ids)=>(await as(actor,'select * from public.accepted_quote_totals($1) order by quote_id',[ids])).rows;
 eq(await totals('a',[q]),[{quote_id:q,accepted_total_cents:15000}]);eq(await totals('b',[q]),[{quote_id:q,accepted_total_cents:15000}]);eq(await totals('other',[q]),[]);eq(await totals('a',[]),[]);
 for(const ids of [null,[q,q],[null],[[q]],Array.from({length:201},()=>randomUUID())])await denied(totals('a',ids),'22023');await denied(totals('',[q]),'42501');
 for(const role of ['public','anon'])eq(await scalar("select has_function_privilege($1,'public.accepted_quote_totals(uuid[])','EXECUTE') v",[role]),false);
 const after=await snapshot();eq(after.budget_consumption[0].accepted_cents,15000);eq(after.budget_consumption[0].paid_cents,15000);eq(after.limits.can_write_site,false);
 const aCopy=structuredClone(after),bCopy=structuredClone(oldSnapshot);delete aCopy.budget_consumption;delete bCopy.budget_consumption;eq(aCopy,bCopy);
 await denied(as('other','select public.site_operations_snapshot($1)',[site]),'42501');
 const cn=randomUUID();await as('a','select public.prepare_phone_booking($1,$2,$3,$4)',[cn,JSON.stringify(payload),JSON.stringify(contact),'card_hold']);
 await db.query("select public.record_phone_booking_provider($1,$2,'cs_test_QAcompat','pi_QAcompat','session')",[ids.a,cn]);await db.query("select public.record_phone_booking_provider($1,$2,'cs_test_QAcompat','pi_QAcompat','authorize',18000,'eur','requires_capture')",[ids.a,cn]);
 const card=(await as('a','select public.submit_phone_booking($1) v',[cn])).rows[0].v.intervention.id;await db.query("update public.interventions set artisan_id=$2,status='completed' where id=$1",[card,ids.artisan]);
 const cq=randomUUID();await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[cq,card,ids.artisan]);await db.query("update public.profiles set stripe_account_id='acct_QAcompat' where id=$1",[ids.artisan]);
 await denied(as('a','select public.guard_phone_booking_checkout($1)',[cq]),'P0001');
 const cardAm=randomUUID();await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,1,'QA synthétique','[{\"label\":\"Avenant bancaire QA\",\"quantity\":1,\"unit_price_cents\":2500}]',2500,20,500,3000,'accepted')",[cardAm,card,cq,ids.artisan]);
 await db.query("update public.interventions set site_id=$2 where id=$1",[card,site]);await db.query("update public.quotes set accepted_at='2026-04-01T10:00:00Z' where id=$1",[cq]);
 const cl=(await as('a','select public.begin_guest_settlement($1) v',[card])).rows[0].v;await db.query("select public.qualify_guest_settlement($1,$2,'acct_QAcompat',2000)",[cl,ids.a]);await db.query("select public.record_guest_settlement($1,$2,'ch_QAcompat',15000)",[cl,ids.a]);await db.query("select public.record_guest_settlement($1,$2,'ch_QAcompat',15000,'tr_QAcompat',12000,'acct_QAcompat')",[cl,ids.a]);eq(await scalar('select method v from public.payments where quote_id=$1',[cq]),'stripe');eq(await scalar('select method v from public.payment_attempts where quote_id=$1',[cq]),'stripe');

 eq(await totals('a',[cq,q]),[{quote_id:q,accepted_total_cents:15000},{quote_id:cq,accepted_total_cents:15000}].sort((a,b)=>a.quote_id.localeCompare(b.quote_id)));
 const both=await snapshot();eq(both.budget_consumption[0].accepted_cents,30000);eq(both.budget_consumption[0].paid_cents,30000);eq(both.budget_consumption[0].interventions,2);
 // Actual paid payment totals, independent of workflow's status label (no clamping).
 const legacy=(await as('a','select to_jsonb(public.create_intervention($1,$2,$3,$4,$5,$6,$7)) v',['socket','QA legacy total','Adresse QA synthétique','97200','Commune QA','scheduled',site])).rows[0].v.id;
 await db.query("update public.interventions set artisan_id=$2,status='completed' where id=$1",[legacy,ids.artisan]);const lq=randomUUID();await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at)values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted','2027-01-01T00:00:00Z')",[lq,legacy,ids.artisan]);
 await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status)values($1,'cs_test_QAfiscal',12000,'eur','paid')",[lq]);eq((await snapshot()).budget_consumption[0].paid_cents,30000);
 await db.query("update public.quotes set accepted_at='2026-12-31T23:59:59Z' where id=$1",[lq]);eq((await snapshot()).budget_consumption[0].paid_cents,42000);eq((await snapshot()).budget_consumption[0].accepted_cents,42000);
 // Even locally corrupted cross-job/other-artisan amendments cannot enter the amount.
 const mismatchJob=(await db.query("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)select client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents from public.interventions where id=$1 returning id",[legacy])).rows[0].id;
 for(const [version,wrongJob,wrongArtisan]of[[1,legacy,ids.other],[2,mismatchJob,ids.artisan]])await db.query("insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,'QA scope mismatch','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":1000}]',1000,20,200,1200,'accepted')",[wrongJob,lq,wrongArtisan,version]);
 eq(await totals('a',[lq]),[{quote_id:lq,accepted_total_cents:12000}]);eq((await snapshot()).budget_consumption[0].accepted_cents,42000);
 await db.query("update public.quotes set status='rejected' where id=$1",[lq]);eq(await totals('a',[lq]),[]);eq((await snapshot()).budget_consumption[0].accepted_cents,30000);
 console.log(JSON.stringify({sql:'PASS',checks,migrations:27,runtime:'PGlite0.5.4',bank_provider_proof:false}));
}finally{await db.close()}
