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
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),manager=crypto.randomUUID();
 for(const id of [owner,other,manager])await q("insert into auth.users(id,raw_user_meta_data)values($1,'{}')",[id]);
 await q("update public.profiles set role='manager' where id=$1",[manager]);
 const org=await one("insert into public.organizations(name,owner_id)values('QA',$1)returning id v",[manager]);
 await q("insert into public.organization_members values($1,$2,'owner')",[org,manager]);
 const site=await one("insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA adresse')returning id v",[org]);
 const job=await one("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','completed',100,200)returning id v",[owner,site]);
 await q("insert into public.organization_members values($1,$2,'viewer')",[org,owner]);
 await q(`insert into public.warranty_cases(intervention_id,client_id,description,status,created_at)
 select $1,$2,'QA garantie synthétique','resolved','2026-11-07T00:00:00.123456Z'::timestamptz + n*interval '1 microsecond' from generate_series(1,105)n`,[job,owner]);
 const active=await one("insert into public.warranty_cases(intervention_id,client_id,description,status,created_at)values($1,$2,'Ancienne QA ouverte','reviewing','2020-01-01')returning id v",[job,owner]);
 async function as(id){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')}
 const page=async(before=null)=>q(`select id,created_at::text at from public.warranty_cases where intervention_id=$1 and ($2::uuid is null or (created_at,id)<($3::timestamptz,$2::uuid))order by created_at desc,id desc limit 101`,[job,before?.id??null,before?.at??null]);
 await as(owner);const first=await page();eq(first.length,101);eq(first.some(r=>r.id===active),false);
 const second=await page(first[99]);eq(second.length,6);eq(second.at(-1).id,active);eq(new Set([...first.slice(0,100),...second].map(r=>r.id)).size,106);
 eq((await q("select id from public.warranty_cases where intervention_id=$1 and status in('submitted','reviewing')limit 2",[job])).map(r=>r.id),[active]);
 await as(other);eq((await page()).length,0);
 await as(manager);eq((await page()).length,101);
 await db.exec('reset role');await q('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,owner]);
 await as(owner);eq((await page()).length,0);eq((await q('select id from public.interventions where id=$1',[job])).length,0);
 console.log(`warranty history: ${checks} real RLS assertions PASS; 106 cases, oldest active independent of page`);
}finally{await db.close()}
