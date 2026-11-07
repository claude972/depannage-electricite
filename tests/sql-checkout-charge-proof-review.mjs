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
 await ingest(event('evt_fee',{type:'application_fee.created',family:'fee',object:{...event('x').object,id:'fee_QA',amount:2400,status:null}}));
 await as('reader');const found=await read();eq(found.proof.charge_id,'ch_QA');eq(found.dispute_observations.map(x=>x.event_id),['evt_dispute']);eq(found.dispute_observations[0].disputed_amount_cents,3000);eq(found.proof.source.amount_cents,12000);
 const historic=await one("select public.stripe_financial_observation_detail('evt_dispute')v");eq(historic.record.result.reason,'dispute_reference_not_bound');eq(historic.record.version,1);
 await as('client');await deny(read());await as('', 'anon');await deny(read());
 await as('', 'postgres');eq(await one('select status v from public.payments where id=$1',[payment]),'paid');eq(await one('select status v from public.interventions where id=$1',[job]),'paid');eq(await one('select count(*)::integer v from charge_proof_private.proofs'),1);
 await q("update public.platform_operator_grants set status='revoked',revoked_at=now(),revoked_by=user_id where user_id=$1 and scope='finance_write'",[ids.operator]);await as('', 'service_role');await deny(store());await deny(begin());
 console.log(`PASS Checkout charge proof: ${checks} SQL checks; paid frozen source, private ACL, immutable replay/mode, exact dispute observation and no financial state mutation`);
}catch(e){console.error(e.message,e.code,e.where,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}
