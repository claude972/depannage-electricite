// Actual migrations001–026 in isolated PGlite0.5.4. Auth/Storage/cron stubs only; no bank/provider proof.
import {readFile,readdir,writeFile,lstat} from 'node:fs/promises';
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

 await db.query("update public.artisan_profiles set company_name='Artisan synthétique QA',siret='12345678901234',legal_status='QA',address='Adresse synthétique QA' where user_id=$1",[ids.artisan]);
 await as('admin',"select public.platform_set_billing_contact('profile',$1,'Client QA','Adresse synthétique QA',null,null,null)",[ids.a]);
 await db.query("update public.interventions set status='completed' where id=$1",[job]);await as('artisan','select public.declare_onsite_receipt($1)',[job]);
 const cashPay=await scalar('select id v from public.payments where quote_id=$1',[q]);
 const ready=async(payment=cashPay,basis='service',actor='admin')=>(await as(actor,'select public.platform_invoice_readiness($1,$2) v',[basis,payment])).rows[0].v;
 eq((await ready()).preview.total_cents,12000);eq(await scalar('select total_cents v from public.payments where id=$1',[cashPay]),15000);
 const protectedDefs=async()=>Promise.all(['platform_issue_invoice(uuid,text,uuid)','platform_next_invoice_number(text,text)','platform_issue_credit_note(uuid,uuid,integer,text)'].map(f=>scalar('select pg_get_functiondef($1::regprocedure) v',['public.'+f])));
 const original=await protectedDefs();const acl=await scalar("select proacl::text v from pg_proc where oid='public.platform_invoice_readiness(text,uuid)'::regprocedure");
 await db.exec(await readFile(new URL('202611010026_invoice_settlement_total.sql',dir),'utf8'));
 eq(await protectedDefs(),original);eq(await scalar("select proacl::text v from pg_proc where oid='public.platform_invoice_readiness(text,uuid)'::regprocedure"),acl);
 let r=await ready();eq(r.ready,true);eq(r.missing,[]);eq(r.preview.total_cents,15000);eq(r.preview.subtotal_cents,12500);eq(r.preview.tax_cents,2500);eq(r.preview.lines.length,2);eq(r.preview.tax_rate,20);
 await denied(as('a','select public.platform_invoice_readiness($1,$2)',['service',cashPay]),'42501');await denied(as('','select public.platform_invoice_readiness($1,$2)',['service',cashPay]),'42501');
 const request=randomUUID();const issue=async(req=request,payment=cashPay)=>(await as('admin',"select public.platform_issue_invoice($1,'service',$2) v",[req,payment])).rows[0].v;
 const inv=await issue();eq(inv.invoice.total_cents,15000);eq(inv.invoice.tax_cents,2500);eq(inv.invoice.lines,r.preview.lines);eq(inv.invoice.number,`F${new Date().getFullYear()}-000001`);eq((await issue()).replayed,true);eq((await ready()).missing,['already_issued']);
 // New fixtures are local database records, not fabricated provider confirmations.
 const fixture=async({rate=20,sub=2500,tax=500,amount=15000,status='accepted',lineCount=1,baseSub=10000,baseTax=2000,baseTotal=12000,method='stripe'}={})=>{
  const j=randomUUID(),quote=randomUUID(),amend=randomUUID();await db.query("insert into public.interventions(id,client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents) values($1,$2,$3,'socket','QA facture synthétique','Adresse QA synthétique','97200','Commune QA','scheduled','completed',100,200)",[j,ids.a,ids.artisan]);
  const lines=[{label:'Base QA',quantity:1,unit_price_cents:baseSub}];await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,$5,20,$6,$7,'accepted')",[quote,j,ids.artisan,JSON.stringify(lines),baseSub,baseTax,baseTotal]);
  const extra=Array.from({length:lineCount},(_,i)=>({label:'Avenant QA '+i,quantity:1,unit_price_cents:i===0?sub:0}));
  await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,1,'QA synthétique',$5,$6,$7,$8,$9,$10)",[amend,j,quote,ids.artisan,JSON.stringify(extra),sub,rate,tax,sub+tax,status]);
  if(method==='on_site_declared')await db.query("insert into public.on_site_receipts(intervention_id,quote_id,actor_id,amount_cents,amendments)values($1,$2,$3,$4,'[]')",[j,quote,ids.artisan,amount]);
  const pay=(await db.query("insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,$3,'eur','paid',$4)returning id",[quote,method==='on_site_declared'?'onsite:'+j:'cs_test_QA'+j,amount,method])).rows[0].id;return{j,quote,amend,pay};
 };
 const mixed=await fixture({rate:10,sub:2727,tax:273});r=await ready(mixed.pay);eq(r.ready,false);eq(r.missing,['invoice_mixed_tax_rates']);eq(r.preview.tax_rate,null);eq(r.preview.total_cents,15000);await denied(issue(randomUUID(),mixed.pay),'P0001');
 const mismatch=await fixture({amount:12000});eq((await ready(mismatch.pay)).missing,['payment_total_mismatch']);await denied(issue(randomUUID(),mismatch.pay),'P0001');
 for(const status of ['proposed','rejected','withdrawn']){const x=await fixture({status,amount:12000});r=await ready(x.pay);eq(r.ready,true);eq(r.preview.lines.length,1);eq(r.preview.total_cents,12000);}
 const cap=await fixture({lineCount:30});r=await ready(cap.pay);eq(r.ready,false);eq(r.missing,['invoice_lines_limit']);eq(r.preview.lines.length,31);await denied(issue(randomUUID(),cap.pay),'P0001');
 const rounding=await fixture({baseSub:3,baseTax:1,baseTotal:4,sub:3,tax:1,amount:8});eq((await ready(rounding.pay)).missing,['invoice_tax_rounding_mismatch']);await denied(issue(randomUUID(),rounding.pay),'P0001');
 const invalid=await fixture({sub:2500,tax:499,amount:14999});eq((await ready(invalid.pay)).missing,['invoice_tax_rounding_mismatch']);
 const missingCash=await fixture({method:'on_site_declared'});eq((await ready(missingCash.pay)).missing,['amendment_snapshot_mismatch']);
 // Exact private snapshot comparison, including amendment version and paid amount.
 const bank=await fixture();const snapshot=[{id:bank.amend,version:1,total_cents:3000}];
 await db.query("insert into public.guest_settlements(intervention_id,actor_id,quote_id,artisan_id,request_id,session_id,intent_id,authorized_max,amount_cents,amendments,status)values($1,$2,$3,$4,$5,$6,$7,18000,15000,$8,'paid')",[bank.j,ids.a,bank.quote,ids.artisan,randomUUID(),'cs_test_QA'+bank.j,'pi_QA'+bank.j,JSON.stringify(snapshot)]);
 r=await ready(bank.pay);eq(r.ready,true);eq(r.preview.total_cents,15000);eq((await issue(randomUUID(),bank.pay)).invoice.number,`F${new Date().getFullYear()}-000002`);
 const wrong=await fixture();await db.query("insert into public.guest_settlements(intervention_id,actor_id,quote_id,artisan_id,request_id,session_id,intent_id,authorized_max,amount_cents,amendments,status)values($1,$2,$3,$4,$5,$6,$7,18000,15000,'[]','paid')",[wrong.j,ids.a,wrong.quote,ids.artisan,randomUUID(),'cs_test_QA'+wrong.j,'pi_QA'+wrong.j]);eq((await ready(wrong.pay)).missing,['amendment_snapshot_mismatch']);await denied(issue(randomUUID(),wrong.pay),'P0001');
 const cn=randomUUID();await as('a','select public.prepare_phone_booking($1,$2,$3,$4)',[cn,JSON.stringify(payload),JSON.stringify(contact),'card_hold']);
 await db.query("select public.record_phone_booking_provider($1,$2,'cs_test_QAcompat','pi_QAcompat','session')",[ids.a,cn]);await db.query("select public.record_phone_booking_provider($1,$2,'cs_test_QAcompat','pi_QAcompat','authorize',18000,'eur','requires_capture')",[ids.a,cn]);
 const card=(await as('a','select public.submit_phone_booking($1) v',[cn])).rows[0].v.intervention.id;await db.query("update public.interventions set artisan_id=$2,status='completed' where id=$1",[card,ids.artisan]);
 const cq=randomUUID();await db.query("insert into public.quotes(id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')",[cq,card,ids.artisan]);await db.query("update public.profiles set stripe_account_id='acct_QAcompat' where id=$1",[ids.artisan]);
 await denied(as('a','select public.guard_phone_booking_checkout($1)',[cq]),'P0001');
 const cardAm=randomUUID();await db.query("insert into public.quote_amendments(id,intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,$4,1,'QA synthétique','[{\"label\":\"Avenant bancaire QA\",\"quantity\":1,\"unit_price_cents\":2500}]',2500,20,500,3000,'accepted')",[cardAm,card,cq,ids.artisan]);
 const cl=(await as('a','select public.begin_guest_settlement($1) v',[card])).rows[0].v;await db.query("select public.qualify_guest_settlement($1,$2,'acct_QAcompat',2000)",[cl,ids.a]);await db.query("select public.record_guest_settlement($1,$2,'ch_QAcompat',15000)",[cl,ids.a]);await db.query("select public.record_guest_settlement($1,$2,'ch_QAcompat',15000,'tr_QAcompat',12000,'acct_QAcompat')",[cl,ids.a]);eq(await scalar('select method v from public.payments where quote_id=$1',[cq]),'stripe');eq(await scalar('select method v from public.payment_attempts where quote_id=$1',[cq]),'stripe');
 const actualCardPay=await scalar('select id v from public.payments where quote_id=$1',[cq]);r=await ready(actualCardPay);eq(r.ready,true);eq(r.preview.total_cents,15000);eq(r.preview.lines.length,2);const cardInvoice=(await issue(randomUUID(),actualCardPay)).invoice;eq(cardInvoice.total_cents,15000);
 const badLine=await fixture();await db.query("update public.quote_amendments set lines='[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":2400}]' where id=$1",[badLine.amend]);eq((await ready(badLine.pay)).missing,['amendment_invalid']);
 await db.query("update public.artisan_profiles set siret='' where user_id=$1",[ids.artisan]);eq((await ready(mixed.pay)).missing,['artisan_siret','invoice_mixed_tax_rates']);
 r=await ready(bank.pay,'platform_commission');eq(r.missing,['platform_issuer','platform_commission_vat_rate','commission_not_confirmed','artisan_identity']);
 eq(await scalar('select count(*)::int v from public.platform_invoices'),3);
 // Optional private bridge: export actual RPC-issued rows only, never an imitated Invoice fixture.
 if(process.env.INVOICE_RPC_ROWS_PATH){
  const {dirname,isAbsolute}=await import('node:path');const output=process.env.INVOICE_RPC_ROWS_PATH;
  assert.ok(isAbsolute(output));const parent=await lstat(dirname(output));assert.ok(parent.isDirectory()&&!parent.isSymbolicLink());assert.equal(parent.mode&0o077,0);
  eq(await scalar('select count(*)::int v from public.platform_invoices where payment_id=$1',[mixed.pay]),0);
  await writeFile(output,JSON.stringify({cash:inv.invoice,card:cardInvoice,mixed_tax:{ready:false,issued_count:0}},null,2),{mode:0o600,flag:'wx'});
 }
 console.log(JSON.stringify({sql:'PASS' ,checks,migrations:26,runtime:'PGlite0.5.4',bank_provider_proof:false}));
}finally{await db.close()}
