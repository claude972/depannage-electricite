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


 const ids=Object.fromEntries(['admin','backup','client','operator','artisan','manager'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q('insert into auth.users(id,raw_user_meta_data)values($1,$2)',[id,JSON.stringify({full_name:'QA'})]);await q('update public.profiles set role=$2 where id=$1',[id,n==='backup'?'admin':n==='operator'?'client':n])}
 await q("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,'finance_write',$2)",[ids.operator,ids.admin]);
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 await as('', 'anon');const baseline=await one('select public.read_indicative_prices()v');eq(baseline.version,1);eq(baseline.publication_available,false);
 const expected={outage:[15000,25000],panel:[15000,35000],socket:[8000,18000],lighting:[8000,20000],diagnostic:[12000,28000]};
 for(const[k,v]of Object.entries(expected))eq(baseline.ranges[k],{min_cents:v[0],max_cents:v[1]});
 await deny(one('select public.read_indicative_price_staging()v'));await deny(q('select *from indicative_price_private.versions'));
 const cmd=crypto.randomUUID(),reason='QA proposition synthétique non publiée',changed=structuredClone(baseline.ranges);changed.socket.max_cents=18001;
 const stage=(command=cmd,expected=1,ranges=changed)=>one('select public.stage_indicative_prices($1,$2,$3,$4)v',[command,expected,ranges,reason]);
 for(const who of ['client','operator','artisan','manager']){await as(who);await deny(stage());await deny(one('select public.read_indicative_price_staging()v'))}
 await as('', 'postgres');await q("update auth.users set email_confirmed_at=now(),phone='596696000000',phone_confirmed_at=now()where id=$1",[ids.client]);
 const booking=crypto.randomUUID(),payload={service_slug:'plusieurs-prises-sans-courant',category:'socket',description:'QA panne synthétique',address:'QA adresse',postal_code:'97200',city:'QA ville',urgency:'scheduled'},contact={first_name:'QA',last_name:'Test',email:'',phone:'+596696000000'};
 const prepare=()=>one('select public.prepare_phone_booking($1,$2,$3,$4)v',[booking,payload,contact,'card_hold']);
 await as('client');const prepared=await prepare();eq(prepared.expected_max_cents,18000);
 await as('admin');eq((await one('select public.read_indicative_price_staging()v')).staged,null);
 eq(await stage(),{version:2,replayed:false,publication_available:false,active_version:1});eq((await stage()).replayed,true);await deny(stage(cmd,1,baseline.ranges),'P0001');await deny(stage(crypto.randomUUID(),1),'P0001');
 eq((await one('select public.read_indicative_price_staging()v')).staged.ranges,changed);
 const cmd2=crypto.randomUUID();eq((await stage(cmd2,2,baseline.ranges)).version,3);eq((await stage()).version,2);
 await deny(stage(crypto.randomUUID(),3,{socket:{min_cents:1,max_cents:2}}),'22023');await deny(stage(crypto.randomUUID(),3,{...changed,outage:{min_cents:1.5,max_cents:2}}),'22023');
 eq(await one('select public.read_indicative_prices()v'),baseline);await as('client');eq(await prepare(),prepared);
 // New real private interventions still receive the baseline, never the staged amounts.
 await as('client');for(const[k,v]of Object.entries(expected)){const job=await one("select to_jsonb(public.create_intervention($1,'QA panne synthétique','QA adresse','97200','QA ville','scheduled',null))v",[k]);eq([job.estimate_min_cents,job.estimate_max_cents],v)}
 await as('', 'postgres');eq(await one('select count(*)::integer v from indicative_price_private.versions'),3);eq(await one('select ranges v from indicative_price_private.versions where version=2'),changed);await deny(q("update indicative_price_private.versions set reason='changed reason'where version=2"),'P0001');await as('admin');await deny(q('update indicative_price_private.control set active_version=2'));await deny(q('select public.publish_indicative_prices($1,1,3,$2)',[crypto.randomUUID(),'QA publication disabled']),'P0001');await as('', 'postgres');
 await q("update public.profiles set role='client'where id=$1",[ids.admin]);await as('admin');await deny(stage());
 console.log(`indicative prices: ${checks} SQL assertions PASS`);
}finally{await db.close()}
