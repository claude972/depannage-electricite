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



 const ids=Object.fromEntries(['admin','backup','client','operator'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q("insert into auth.users(id,raw_user_meta_data,email_confirmed_at,phone,phone_confirmed_at)values($1,'{\"full_name\":\"QA\"}',now(),'596696000000',now())",[id]);await q('update public.profiles set role=$2 where id=$1',[id,['admin','backup'].includes(n)?'admin':'client'])}
 await q("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,'finance_write',$2)",[ids.operator,ids.admin]);
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const refusal=async(sql,args=[],code='P0001')=>{await db.exec('savepoint refusal');await deny(q(sql,args),code);await db.exec('rollback to savepoint refusal');await db.exec('release savepoint refusal')};
 const reason='QA publication synthétique uniquement';const pub=(cmd,active,latest)=>one('select public.publish_indicative_prices($1,$2,$3,$4)v',[cmd,active,latest,reason]);
 const stage=(expected,ranges)=>one('select public.stage_indicative_prices($1,$2,$3,$4)v',[crypto.randomUUID(),expected,ranges,reason]);
 const baseline=await one('select public.read_indicative_prices()v');const changed=structuredClone(baseline.ranges);changed.socket.max_cents=19000;
 const payload={service_slug:'demande-socket',category:'socket',description:'QA panne synthétique',address:'QA adresse',postal_code:'97200',city:'QA ville',urgency:'scheduled'},contact={first_name:'QA',last_name:'Test',email:'',phone:'+596696000000'},booking=crypto.randomUUID();
 await as('client');const reserved=await one('select public.prepare_phone_booking($1,$2,$3,$4)v',[booking,payload,contact,'card_hold']);
 await as('admin');await stage(1,changed);await deny(pub(crypto.randomUUID(),1,2),'P0001');await deny(q('update indicative_price_private.publication_gate set enabled=true'));eq(await one('select public.read_indicative_prices()v'),baseline);
 await as('', 'postgres');eq(await one('select enabled v from indicative_price_private.publication_gate'),false);await db.exec('begin');await refusal('update indicative_price_private.control set active_version=2');await q('update indicative_price_private.publication_gate set enabled=true');
 for(const actor of ['client','operator']){await as(actor);await refusal('select public.publish_indicative_prices($1,1,2,$2)',[crypto.randomUUID(),reason],'42501')}
 await as('admin');await refusal('select public.publish_indicative_prices($1,1,3,$2)',[crypto.randomUUID(),reason]);const command=crypto.randomUUID();eq(await pub(command,1,2),{published_version:2,active_version:2,replayed:false});eq((await pub(command,1,2)).replayed,true);await as('backup');await refusal('select public.publish_indicative_prices($1,1,2,$2)',[command,reason]);await as('admin');
 const active=await one('select public.read_indicative_prices()v');eq(active.version,2);eq(active.source,'operator_version');eq(active.ranges,changed);eq((await one('select public.read_indicative_price_staging()v')).staged,null);
 await refusal('select public.publish_indicative_prices($1,1,2,$2)',[crypto.randomUUID(),reason]);await refusal('select public.publish_indicative_prices($1,1,2,$2)',[command,'Other QA publication reason']);
 const changed3=structuredClone(changed);changed3.socket.max_cents=20000;await stage(2,changed3);eq((await one('select public.read_indicative_prices()v')).version,2);const second=crypto.randomUUID();await pub(second,2,3);eq(await pub(command,1,2),{published_version:2,active_version:3,replayed:true});
 for(const cap of [49,100000000]){await db.exec('savepoint invalid_cap');const ranges=structuredClone(baseline.ranges);ranges.socket={min_cents:1,max_cents:cap};await stage(3,ranges);await deny(pub(crypto.randomUUID(),3,4),'22023');await db.exec('rollback to savepoint invalid_cap');await db.exec('release savepoint invalid_cap')}
 for(const cap of [50,99999999]){await db.exec('savepoint valid_cap');const ranges=structuredClone(baseline.ranges);ranges.socket={min_cents:1,max_cents:cap};await stage(3,ranges);eq((await pub(crypto.randomUUID(),3,4)).published_version,4);await db.exec('rollback to savepoint valid_cap');await db.exec('release savepoint valid_cap')}
 await as('client');eq(await one('select public.prepare_phone_booking($1,$2,$3,$4)v',[booking,payload,contact,'card_hold']),reserved);
 await as('', 'service_role');await q("select public.record_phone_booking_provider($1,$2,'cs_test_QApublish','pi_QApublish','session')",[ids.client,booking]);await q("select public.record_phone_booking_provider($1,$2,'cs_test_QApublish','pi_QApublish','authorize',18000,'eur','requires_capture')",[ids.client,booking]);
 await as('client');const job=(await one('select public.submit_phone_booking($1)v',[booking])).intervention;eq([job.estimate_min_cents,job.estimate_max_cents],[8000,18000]);
 await as('', 'postgres');eq(await one('select count(*)::integer v from indicative_price_private.publications'),2);await refusal('delete from indicative_price_private.publications',[],'P0001');await q('update indicative_price_private.publication_gate set enabled=false');
 await as('', 'anon');eq((await one('select public.read_indicative_prices()v')).version,3);await refusal('select *from indicative_price_private.versions',[],'42501');
 await as('admin');await refusal('select public.publish_indicative_prices($1,1,2,$2)',[command,reason]);eq((await one('select public.read_indicative_price_staging()v')).publication_available,false);
 await as('', 'postgres');await q('update indicative_price_private.publication_gate set enabled=true');await q("update public.profiles set role='client'where id=$1",[ids.admin]);await as('admin');await refusal('select public.publish_indicative_prices($1,1,2,$2)',[command,reason],'42501');
 await as('', 'postgres');await db.exec('rollback');eq(await one('select enabled v from indicative_price_private.publication_gate'),false);eq(await one('select active_version v from indicative_price_private.control'),1);eq(await one('select count(*)::integer v from indicative_price_private.publications'),0);
 console.log(`price publication: ${checks} SQL assertions PASS; activation only in rolled-back synthetic transaction`);
}finally{await db.close()}
