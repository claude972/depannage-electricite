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
 const users=Object.fromEntries(['client','other','artisan','manager','operator','anonymous'].map(x=>[x,crypto.randomUUID()]));
 for(const [name,id]of Object.entries(users))await q('insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data)values($1,$2,now(),$3,$4)',[id,`${id}@example.test`,name==='anonymous',JSON.stringify({role:['artisan','manager'].includes(name)?name:'client',full_name:'QA'})]);
 await q('update public.profiles set artisan_approved=true where id=$1',[users.artisan]);await q("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)values($1,'QA','00000000000000','QA address',array['97200'],array['socket'],'approved',true)",[users.artisan]);
 await q("insert into public.platform_operator_grants(user_id,scope,note,granted_by)values($1,'finance_write','QA fixture',$1)",[users.operator]);
 async function as(id=users.client,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 await as();eq(await one('select public.subscription_guard(false)v'),'client');await deny(q('select public.subscription_guard(true)'));
 for(const who of ['manager','anonymous']){await as(users[who]);await deny(q('select public.subscription_guard(false)'))}
 await as(users.artisan);eq(await one('select public.subscription_guard(false)v'),'artisan');await as(users.operator);eq(await one('select public.subscription_guard(true)v'),'operator');
 await deny(q('select *from subscription_private.offers'));await deny(q('select public.subscription_context($1,false,false)',[users.client]));
 await as('', 'service_role');
 const context=(actor=users.client,live=false,read=false)=>one('select public.subscription_context($1,$2,$3)v',[actor,live,read]);
 eq((await context()).offers,[]);eq((await context()).enabled,false);
 const terms={role:'client',label:'Explicit synthetic QA',active:true,price_id:'price_QA',amount_cents:1234,currency:'eur',interval:'month',interval_count:2,tax_behavior:'inclusive'};
 const offerCmd=crypto.randomUUID();const configure=(actor=users.operator,cmd=offerCmd,id=null,ver=0,live=false,v=terms)=>one('select public.save_subscription_offer($1,$2,$3,$4,$5,$6)v',[actor,cmd,id,ver,live,v]);
 await deny(configure(users.client));const offer=await configure();eq((await configure()).id,offer.id);await deny(configure(users.operator,offerCmd,null,0,false,{...terms,amount_cents:1}),'P0001');
 eq((await context(users.artisan)).offers,[]);eq((await context(users.client,true)).offers,[]);
 const cmd=crypto.randomUUID();const begin=(command=cmd,actor=users.client)=>one('select public.begin_subscription_checkout($1,false,$2,$3,1,\'https://app.test\')v',[actor,command,offer.id]);
 await deny(begin(),'P0001');
 await as('', 'postgres');await db.exec('update subscription_private.control set enabled=true');await as('', 'service_role');
 const started=await begin();eq(started.attempt.offer.amount_cents,1234);eq((await begin()).attempt.id,started.attempt.id);await deny(begin(crypto.randomUUID()),'P0001');
 await deny(q("select public.bind_subscription_provider($1,false,$2,'customer','cus_QA')",[users.other,started.attempt.id]));
 await q("select public.bind_subscription_provider($1,false,$2,'customer','cus_QA')",[users.client,started.attempt.id]);await q("select public.bind_subscription_provider($1,false,$2,'session','cs_test_QA')",[users.client,started.attempt.id]);
 await deny(q("select public.bind_subscription_provider($1,false,$2,'session','cs_test_foreign')",[users.client,started.attempt.id]),'P0001');
 const older=await context(users.client,false,true),newer=await context(users.client,false,true);
 const observe=(seq,status='active',end=2000,cancel=false)=>q('select public.observe_subscription($1,false,$2,$3,\'cs_test_QA\',\'sub_QA\',$4,$5,1000,$6)',[users.client,started.attempt.id,seq,status,cancel,end]);
 await deny(observe(older.account.read_seq),'P0001');await observe(newer.account.read_seq);eq((await context()).attempt.status,'active');await deny(observe(newer.account.read_seq),'P0001');
 for(const [state,end,cancel]of [['past_due',2000,false],['active',3000,false],['active',3000,true],['canceled',3000,true]]){const c=await context(users.client,false,true);await observe(c.account.read_seq,state,end,cancel);eq((await context()).attempt.status,state)}
 const terminal=await context(users.client,false,true);await deny(observe(terminal.account.read_seq,'active',3000),'P0001');
 const fresh=await begin(crypto.randomUUID());eq(fresh.attempt.id!==started.attempt.id,true);
 // Immutable attempt terms survive catalogue edits; no premium/MVP entitlement tables modified.
 await configure(users.operator,crypto.randomUUID(),offer.id,1,false,{...terms,amount_cents:5678});eq((await context()).attempt.offer.amount_cents,1234);
 await as('', 'postgres');await q('update auth.users set email_confirmed_at=null where id=$1',[users.client]);await as('', 'service_role');await deny(context());
 await as('', 'postgres');await q('update public.profiles set artisan_approved=false where id=$1',[users.artisan]);await as('', 'service_role');eq((await context(users.artisan)).eligible,false);await deny(begin(crypto.randomUUID(),users.artisan));
 await as('', 'anon');await deny(q('select public.subscription_guard(false)'));await deny(q('select public.subscription_context($1,false,false)',[users.other]));
 console.log(`PASS subscriptions: ${checks} SQL checks, gate/ACL, explicit catalogue, exact commands, isolated accounts/modes and stale/terminal transitions`);
}catch(e){console.error(e.message,e.code,e.query,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}
