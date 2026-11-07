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


 const ids=Object.fromEntries(['admin','operator','client','artisan','manager'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q('insert into auth.users(id,raw_user_meta_data)values($1,$2)',[id,JSON.stringify({full_name:'QA'})]);await q('update public.profiles set role=$2 where id=$1',[id,n==='operator'?'client':n])}
 await q("insert into public.platform_operator_grants(user_id,scope,granted_by)values($1,'finance_read',$2),($1,'support_read',$2)",[ids.operator,ids.admin]);
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p)=>{await assert.rejects(p,e=>e.code==='42501');checks++};
 for(let n=0;n<130;n++){const id=crypto.randomUUID();await q("insert into auth.users(id,raw_user_meta_data)values($1,'{\"full_name\":\"QA artisan\"}')",[id]);await q("update public.profiles set role='artisan',created_at=$2 where id=$1",[id,n<9?'2026-01-01':'2026-11-07']);await q('insert into public.artisan_profiles(user_id,application_status)values($1,$2)',[id,n<9?'submitted':'draft'])}
 for(let n=0;n<140;n++)await q("insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,created_at)values($1,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled',$2,100,200,$3)",[ids.client,n<12?['requested','assigned','quoted','accepted','in_progress','completed'][n%6]:'paid',n<12?'2026-01-01':'2026-11-07']);
 await as('admin');const result=await one('select public.admin_dashboard_snapshot()v');eq(result.counts,{interventions:140,active_interventions:12,pending_applications:9});eq(result.active.length,6);eq(result.pending.length,6);eq(result.active.map(x=>x.id),result.active.map(x=>x.id).sort());eq(result.pending.map(x=>x.id),result.pending.map(x=>x.id).sort());eq(result.active.every(x=>x.status!=='paid'),true);eq(result.pending.every(x=>x.application_status==='submitted'),true);eq(Object.hasOwn(result.active[0],'address'),false);eq(Object.hasOwn(result.pending[0],'phone'),false);
 const legacy=await one('select public.admin_overview()v');eq(legacy.interventions.filter(x=>!['paid','cancelled'].includes(x.status)).length,0);eq(legacy.artisans.filter(x=>x.application_status==='submitted').length,0);eq(legacy.counts.active_interventions,result.counts.active_interventions);
 for(const who of ['operator','client','artisan','manager']){await as(who);await deny(one('select public.admin_dashboard_snapshot()v'))}
 await as('', 'anon');await deny(one('select public.admin_dashboard_snapshot()v'));
 await as('', 'postgres');await q("update public.profiles set role='admin' where id=$1",[ids.manager]);await q("update public.profiles set role='client' where id=$1",[ids.admin]);await as('admin');await deny(one('select public.admin_dashboard_snapshot()v'));
 await as('', 'postgres');eq(await one("select prosecdef v from pg_proc where oid='public.admin_dashboard_snapshot()'::regprocedure"),false);
 console.log(`admin dashboard: ${checks} SQL assertions PASS`);
}finally{await db.close()}
