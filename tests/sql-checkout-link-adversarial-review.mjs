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

 await as('', 'service_role');
 await q('select public.confirm_stripe_payment($1,$2,$3,$4,$5,$6)',['evt_QApaid','checkout.session.completed',session,quote,12000,'eur']);
 const refs={session_id:session,payment_intent_id:'pi_QA',charge_id:'ch_QA',destination:'acct_QA',amount_cents:12000,fee_cents:2400,currency:'eur',transfer:{id:'tr_QA',amount:12000,currency:'eur',destination:'acct_QA',source_charge:'ch_QA',reversed:false,amount_reversed:0,livemode:false},fee:{id:'fee_QA',amount:2400,currency:'eur',account:'acct_QA',connected_charge:'py_QA',originating_charge:'ch_QA',amount_refunded:0,livemode:false}};
 const link=(proof=refs)=>one('select public.record_stripe_checkout_link($1,false,$2,null)v',[checkout,proof]);
 // Missing required provider references must fail on their own, before any link/ledger write.
 for(const [path,wrong] of [
  ['transfer.destination',null],['transfer.source_charge',null],['transfer.currency',null],
  ['fee.account',null],['fee.originating_charge',null],['fee.currency',null],
  ['transfer.destination','acct_OTHER'],['transfer.source_charge','ch_OTHER'],
  ['fee.account','acct_OTHER'],['fee.originating_charge','ch_OTHER'],
  ['transfer.currency','usd'],['fee.currency','usd'],
  ['transfer.amount',11999],['fee.amount',2399],
  ['transfer.livemode',true],['fee.livemode',true],
 ]){
  const copy=structuredClone(refs),[obj,key]=path.split('.');copy[obj][key]=wrong;
  await assert.rejects(link(copy),e=>['22023','P0001','23502','23514'].includes(e.code),path+' must reject '+String(wrong));checks++;
 }
 await as('', 'postgres');
 eq(await one('select count(*)::integer v from public.stripe_checkout_links'),0);
 eq(await one("select count(*)::integer v from public.platform_ledger_entries where entry_kind='commission_withheld'"),0);
 await as('client');await deny(link());
 await as('operator');await deny(link());await deny(q('select * from public.stripe_checkout_links'));
 await as('', 'service_role');await deny(q('select * from public.stripe_checkout_links'));
 // A reversal/refund can occur while the other provider object is still unavailable.
 for(const [missing,changed] of [['fee',{transfer:{...refs.transfer,reversed:true,amount_reversed:100}}],['transfer',{fee:{...refs.fee,amount_refunded:100}}]]){
  await db.exec('begin');
  try {
   eq((await link({...refs,[missing]:null})).state,'awaiting_provider');
   const completed=await link({...refs,...changed});
   eq(completed.state,'needs_review');eq(completed.commission,'none');
  } finally{await db.exec('rollback');}
 }
 const recorded=await link();eq(recorded.state,'linked');eq(recorded.commission,'recorded');
 eq((await link()).commission,'existing');
 await as('', 'postgres');
 eq(await one("select count(*)::integer v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'",[payment]),1);
 eq(await one("select amount_cents v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'",[payment]),2400);
 await as('', 'service_role');
 await assert.rejects(link({...refs,charge_id:'ch_OTHER'}));checks++;
 await assert.rejects(link({...refs,fee:{...refs.fee,id:'fee_OTHER'}}));checks++;
 // Historical commission remains unique when the provider later reports a refund.
 const refunded=await link({...refs,fee:{...refs.fee,amount_refunded:100}});
 eq(refunded.state,'needs_review');
 await as('', 'postgres');
 eq(await one("select count(*)::integer v from public.platform_ledger_entries where payment_id=$1 and entry_kind='commission_withheld'",[payment]),1);
 console.log(JSON.stringify({sql:'PASS',suite:'checkout-link-adversarial',checks,provider:false,cloud:false}));
} catch(e) {console.error(e.code,e.message,e.where);process.exitCode=1;} finally{await db.close();}
