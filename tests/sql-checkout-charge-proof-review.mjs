import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(
      id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      is_anonymous boolean not null default false, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  let previousJobs;
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (name.endsWith("_operational_reminders_schedule.sql"))
      previousJobs = (
        await db.query("select to_jsonb(j)v from cron.job j order by jobname")
      ).rows;
    const migration = await isolatedMigrationSql(
      db,
      name,
      await readFile(new URL(name, dir), "utf8"),
    );
    await db.exec(
      migration.replace(
        "create extension if not exists pgcrypto;",
        "-- stub for isolated test",
      ),
    );
  }
 let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
 const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
 const one=async(sql,args=[])=> (await q(sql,args))[0].v;
 const ids=Object.fromEntries(['operator','reader','client','artisan'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids))await q('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:n==='artisan'?'artisan':'client',full_name:'QA'}),n+'@example.invalid']);
 for(const[who,scopes]of [['operator',['finance_read','finance_write']],['reader',['finance_read']]])for(const scope of scopes)await q('insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,$2,$1)',[ids[who],scope]);
 async function as(actor='operator',role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const job=await one("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','completed',10000,20000)returning id v",[ids.client,ids.artisan]);
 const quote=await one("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA prestation\",\"quantity\":1,\"unit_price_cents\":10000}]',10000,20,2000,12000,'accepted')returning id v",[job,ids.artisan]);
 const checkout=crypto.randomUUID(),session='cs_test_QA';await q("insert into public.platform_checkouts(id,quote_id,intervention_id,actor_id,artisan_id,amount_cents,amendments,account_id,return_origin,fee_bps,fee_cents,status,session_id,expires_at)values($1,$2,$3,$4,$5,12000,'[]','acct_QA','https://app.test',2000,2400,'open',$6,clock_timestamp()+interval'1hour')",[checkout,quote,job,ids.client,ids.artisan,session]);
 const payment=await one("insert into public.payments(quote_id,session_id,total_cents,currency,status,method)values($1,$2,12000,'eur','pending','stripe')returning id v",[quote,session]);
 const command=crypto.randomUUID(),provider={payment_intent_id:'pi_QA',charge_id:'ch_QA',charge_created:1700000200,session_created:1700000000,intent_created:1700000100};
 const begin=(actor=ids.operator,cmd=command,live=false)=>one('select public.begin_checkout_charge_proof($1,$2,$3,$4)v',[actor,payment,cmd,live]);
 const read=()=>one('select public.read_checkout_charge_proof($1,null)v',[payment]);
 await as('operator');eq((await read()).proof,null);await deny(begin());await deny(q('select *from charge_proof_private.proofs'));
 await as('', 'service_role');await deny(begin(),'P0001');await as('', 'postgres');await db.exec('update charge_proof_private.control set enabled=true');await as('', 'service_role');await deny(begin(),'P0001');
 await q('select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)',['evt_QApaid','checkout.session.completed',session,quote,12000,'eur']);
 const started=await begin();eq(started.source.payment_id,payment);eq(started.source.destination_account,'acct_QA');eq((await begin()).source,started.source);await deny(begin(ids.reader));
 const store=(source=started.source,proof=provider,live=false,cmd=command)=>q('select public.store_checkout_charge_proof($1,$2,$3,$4,$5,$6)',[ids.operator,payment,cmd,live,source,proof]);
 await deny(store({...started.source,amount_cents:1}),'P0001');await deny(store(started.source,{...provider,charge_created:1}),'22023');await as('', 'postgres');await deny(q('update public.platform_checkouts set fee_cents=2401 where id=$1',[checkout]),'P0001');await as('', 'service_role');await store();await store();await deny(store(started.source,{...provider,charge_id:'ch_foreign'}),'P0001');
 const liveCmd=crypto.randomUUID();await begin(ids.operator,liveCmd,true);await deny(store(started.source,provider,true,liveCmd),'P0001');
 const event=(id,patch={})=>({id,type:'charge.dispute.created',family:'dispute',livemode:false,source_account:null,created:'2026-11-07T00:00:00Z',object:{id:'du_QA',amount:3000,currency:'eur',source_charge:'ch_QA',destination:null,amount_reversed:null,reversed:null,status:'needs_response'},...patch});
 async function ingest(e){await q('select public.ingest_stripe_financial_observation($1,$2)',[e,'a'.repeat(64)])}
 await ingest(event('evt_dispute'));await ingest(event('evt_wrongmode',{livemode:true}));await ingest(event('evt_connected',{source_account:'acct_QA'}));await ingest(event('evt_excess',{object:{...event('x').object,amount:12001}}));await ingest(event('evt_foreign',{object:{...event('x').object,source_charge:'ch_other'}}));await ingest(event('evt_currency',{object:{...event('x').object,currency:'usd'}}));
 await ingest(event('evt_fee',{type:'application_fee.created',family:'fee',object:{...event('x').object,id:'fee_QA',amount:2400,source_charge:'ch_connected',status:null}}));
 await as('reader');const found=await read();eq(found.proof.charge_id,'ch_QA');eq(found.dispute_observations.map(x=>x.event_id),['evt_dispute']);eq(found.dispute_observations[0].disputed_amount_cents,3000);eq(found.proof.source.amount_cents,12000);
 const historic=await one("select public.stripe_financial_observation_detail('evt_dispute')v");eq(historic.record.result.reason,'dispute_reference_not_bound');eq(historic.record.version,1);
 await as('client');await deny(read());await as('', 'anon');await deny(read());
 await as('', 'postgres');eq(await one('select status v from public.payments where id=$1',[payment]),'paid');eq(await one('select status v from public.interventions where id=$1',[job]),'paid');eq(await one('select count(*)::integer v from charge_proof_private.proofs'),1);
 // Fee requires an existing signed observation and all provider references, never fee_refund alone.
 await as('', 'service_role');const feeCommand=crypto.randomUUID();
 const beginFee=(eventId='evt_fee',cmd=feeCommand,live=false)=>one('select public.begin_checkout_fee_proof($1,$2,$3,$4,$5)v',[ids.operator,payment,eventId,cmd,live]);
 const fs=(await beginFee()).source;eq(fs.connected_charge_id,'ch_connected');eq((await beginFee()).completed,false);await deny(beginFee('evt_dispute'),'P0001');await deny(beginFee('evt_missing'), 'P0002');await deny(beginFee('evt_fee',crypto.randomUUID(),true),'P0001');
 const fee={id:'fee_QA',object:'application_fee',livemode:false,currency:'eur',account:'acct_QA',amount:2400,charge:'ch_connected',originating_transaction:'ch_QA',amount_refunded:600,refunded:false,created:1700000300,observed_at:new Date().toISOString()};
 const storeFee=(value=fee,src=fs,cmd=feeCommand)=>q('select public.store_checkout_fee_proof($1,$2,$3,$4)',[ids.operator,cmd,src,value]);
 for(const patch of [{account:'acct_foreign'},{originating_transaction:'ch_foreign'},{charge:'ch_QA'},{amount:1},{livemode:true},{currency:'usd'}])await deny(storeFee({...fee,...patch}),'P0001');
 await deny(storeFee({...fee,amount_refunded:2401}),'22023');await storeFee();eq((await beginFee()).completed,true);await storeFee({...fee,amount_refunded:2400,refunded:true});
 await as('reader');const readFee=(eventId='evt_fee')=>one('select public.read_checkout_fee_proof($1,$2)v',[payment,eventId]);const qualified=await readFee();eq(qualified.qualification.provider_amount_refunded_cents,600);eq(qualified.qualification.provider_refunded,false);
 await as('', 'service_role');await ingest(event('evt_fee_refunded',{type:'application_fee.refunded',family:'fee',object:{...event('x').object,id:'fee_QA',amount:2400,source_charge:'ch_connected',status:null}}));
 const second=crypto.randomUUID(),secondSource=(await beginFee('evt_fee_refunded',second)).source;await storeFee({...fee,amount_refunded:2400,refunded:true,observed_at:new Date().toISOString()},secondSource,second);
 await ingest(event('evt_fee_child',{type:'application_fee.refund.updated',family:'fee',object:{...event('x').object,id:'fr_QA',amount:2400,source_charge:'ch_connected',status:null}}));await deny(beginFee('evt_fee_child',crypto.randomUUID()),'P0001');
 await as('reader');eq((await readFee()).qualification.provider_amount_refunded_cents,600);eq((await readFee('evt_fee_refunded')).qualification.provider_amount_refunded_cents,2400);
 await as('client');await deny(readFee());await as('', 'anon');await deny(readFee());
 await as('', 'postgres');eq(await one('select status v from public.payments where id=$1',[payment]),'paid');
 // Automatic Connect payout proof: known account only, signed event, complete signed-net sum.
 await q("update public.profiles set stripe_account_id='acct_QA'where id=$1",[ids.artisan]);await as('', 'service_role');
 const payoutEvent=(id,account='acct_QA')=>event(id,{family:'payout',type:'payout.reconciliation_completed',source_account:account,object:{...event('x').object,id:'po_QA',amount:8000,source_charge:null,status:'paid'}});
 await ingest(payoutEvent('evt_payout'));await ingest(payoutEvent('evt_payout_unknown','acct_unknown'));await ingest(payoutEvent('evt_payout_platform',null));
 const payoutCommand=crypto.randomUUID(),beginPayout=(eventId='evt_payout',cmd=payoutCommand,live=false)=>one('select public.begin_automatic_payout_proof($1,$2,$3,$4)v',[ids.operator,eventId,cmd,live]);
 await deny(beginPayout('evt_payout_unknown'),'P0001');await deny(beginPayout('evt_payout_platform'),'P0001');await deny(beginPayout('evt_payout',crypto.randomUUID(),true),'P0001');
 const payoutSource=(await beginPayout()).source;eq(payoutSource.account_id,'acct_QA');eq(payoutSource.artisan_id,ids.artisan);
 const component=(id,amount,fee,type,source)=>({id,amount_cents:amount,fee_cents:fee,net_cents:amount-fee,currency:'eur',type,source_id:source,created:1700000000,available_on:1700000000,status:'available',allocation:'unallocated'});
 const payoutProof={payout_id:'po_QA',live:false,currency:'eur',amount_cents:8000,status:'paid',automatic:true,reconciliation_status:'completed',payout_created:1700000000,debit:component('txn_debit',-8000,0,'payout','po_QA'),components:[component('txn_charge',10000,1000,'charge','ch_connected'),component('txn_refund',-1000,0,'refund','re_QA')],own_debit_included:true,page_count:1,listed_count:3,net_components_cents:8000,provider_observed_at:new Date().toISOString(),bank_receipt_confirmed:false};
 const storePayout=(p=payoutProof,src=payoutSource)=>q('select public.store_automatic_payout_proof($1,$2,$3,$4)',[ids.operator,payoutCommand,src,p]);
 await deny(storePayout({...payoutProof,net_components_cents:1}),'P0001');await deny(storePayout({...payoutProof,page_count:'1'}),'22023');await deny(storePayout({...payoutProof,debit:component('txn_debit',8000,0,'payout','po_QA')}),'P0001');await deny(storePayout({...payoutProof,components:[payoutProof.components[0],payoutProof.components[0]]}),'22023');await deny(storePayout({...payoutProof,automatic:false}),'P0001');await deny(storePayout({...payoutProof,reconciliation_status:'in_progress'}),'P0001');await deny(storePayout({...payoutProof,bank_receipt_confirmed:true}),'P0001');await storePayout();eq((await beginPayout()).completed,true);
 await as('reader');const readPayout=()=>one("select public.read_automatic_payout_proof('evt_payout')v");eq((await readPayout()).qualification.proof.net_components_cents,8000);eq((await readPayout()).qualification.proof.bank_receipt_confirmed,false);eq((await readPayout()).qualification.proof.components.every(l=>l.allocation==='unallocated'),true);
 eq((await one("select public.stripe_financial_observation_detail('evt_payout')v")).record.result.reason,'aggregate_payout_unallocated');
 await as('client');await deny(readPayout());await as('', 'anon');await deny(readPayout());
 await as('', 'postgres');await q('update public.profiles set stripe_account_id=null where id=$1',[ids.artisan]);await as('', 'service_role');await deny(storePayout(),'P0001');await deny(beginPayout(),'P0001');
 await as('', 'postgres');await q("update public.profiles set stripe_account_id='acct_QA'where id=$1",[ids.artisan]);
 await q("update public.platform_operator_grants set status='revoked',revoked_at=now(),revoked_by=user_id where user_id=$1 and scope='finance_write'",[ids.operator]);await as('', 'service_role');await deny(store());await deny(begin());await deny(beginFee());await deny(storeFee());await deny(beginPayout());await deny(storePayout());
 console.log(`PASS Checkout charge proof: ${checks} SQL checks; paid frozen source, private ACL, immutable replay/mode, exact dispute observation and no financial state mutation`);
}catch(e){console.error(e.message,e.code,e.where,e.position,e.internalPosition,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}
