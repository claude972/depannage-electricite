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


 const ids=Object.fromEntries(['owner','viewer','foreign','client','artisan','admin'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q('insert into auth.users(id,raw_user_meta_data)values($1,$2)',[id,JSON.stringify({full_name:'QA'})]);await q('update public.profiles set role=$2 where id=$1',[id,['owner','viewer','foreign'].includes(n)?'manager':n])}
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const org=await one("insert into public.organizations(name,owner_id)values('QA',$1)returning id v",[ids.owner]);
 const other=await one("insert into public.organizations(name,owner_id)values('Other QA',$1)returning id v",[ids.foreign]);
 for(const[organization,user,role]of [[org,ids.owner,'owner'],[org,ids.viewer,'viewer'],[other,ids.foreign,'owner']])await q('insert into public.organization_members values($1,$2,$3)',[organization,user,role]);
 const sites=[];for(const organization of [org,org,other])sites.push(await one("insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA adresse')returning id v",[organization]));
 await q("insert into public.organization_member_site_scopes values($1,$2,'selected')",[org,ids.viewer]);await q('insert into public.organization_member_site_grants values($1,$2,$3,false)',[org,ids.viewer,sites[0]]);
 const insert=async(site,status,urgent)=>one("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville',$3,$4,100,200)returning id v",[ids.client,site,urgent?'urgent':'scheduled',status]);
 for(let n=0;n<123;n++)await insert(sites[0],['requested','assigned','quoted','accepted','in_progress'][n%5],n<61);
 for(let n=0;n<11;n++)await insert(sites[1],'requested',true);
 for(const status of ['completed','paid','cancelled'])await insert(sites[0],status,true);
 await insert(sites[2],'requested',true);await insert(null,'requested',true);
 const read=(organization=org,site=null)=>one('select public.enterprise_overview_counts($1,$2)v',[organization,site]);
 await as('owner');eq((await read()).counts,{open:134,urgent:72});eq((await read(org,sites[0])).counts,{open:123,urgent:61});await deny(read(other),'P0002');await deny(read(org,sites[2]),'P0002');await deny(read(null),'22023');
 await as('viewer');eq((await read()).counts,{open:123,urgent:61});eq((await read(org,sites[0])).site_id,sites[0]);eq(await one('select public.can_manage_site($1)v',[sites[0]]),false);await deny(read(org,sites[1]),'P0002');await deny(read(other),'P0002');
 for(const who of ['client','artisan','admin']){await as(who);await deny(read())}
 await as('foreign');eq((await read(other)).counts,{open:1,urgent:1});await deny(read(),'P0002');await as('', 'anon');await deny(read());
 await as('', 'postgres');await q('delete from public.organization_member_site_grants where user_id=$1',[ids.viewer]);await as('viewer');eq((await read()).counts,{open:0,urgent:0});await deny(read(org,sites[0]),'P0002');
 await as('', 'postgres');await q("update public.profiles set role='client' where id=$1",[ids.owner]);await as('owner');await deny(read());
 await as('', 'postgres');await q('delete from public.organization_members where user_id=$1',[ids.viewer]);await as('viewer');await deny(read(),'P0002');
 await as('', 'postgres');eq(await one("select prosecdef v from pg_proc where oid='public.enterprise_overview_counts(uuid,uuid)'::regprocedure"),false);
 console.log(`enterprise overview: ${checks} SQL assertions PASS`);
}finally{await db.close()}
