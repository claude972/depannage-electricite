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


 const ids=Object.fromEntries(['owner','viewer','foreign','client'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q('insert into auth.users(id,raw_user_meta_data)values($1,$2)',[id,JSON.stringify({full_name:'QA'})]);await q('update public.profiles set role=$2 where id=$1',[id,n==='client'?'client':'manager'])}
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const org=await one("insert into public.organizations(name,owner_id)values('QA',$1)returning id v",[ids.owner]);
 const other=await one("insert into public.organizations(name,owner_id)values('Other QA',$1)returning id v",[ids.foreign]);
 for(const[o,u,r]of [[org,ids.owner,'owner'],[org,ids.viewer,'viewer'],[other,ids.foreign,'owner']])await q('insert into public.organization_members values($1,$2,$3)',[o,u,r]);
 const sites=[];for(const organization of [org,org,other])sites.push(await one("insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA adresse')returning id v",[organization]));
 await q("insert into public.organization_member_site_scopes values($1,$2,'selected')",[org,ids.viewer]);await q('insert into public.organization_member_site_grants values($1,$2,$3,false)',[org,ids.viewer,sites[0]]);
 for(const site of sites){
  await q("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,created_at)select $1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','completed',100,200,'2026-11-07T00:00:00.123456Z' from generate_series(1,$3::integer)",[ids.client,site,site===sites[0]?101:1]);
  await q("insert into public.compliance_records(site_id,title,kind,due_on,status,created_by)select $1,'QA contrôle','audit','2026-01-01','pending',$2 from generate_series(1,$3::integer)",[site,ids.owner,site===sites[0]?301:1]);
 }
 // The same invoker predicates/order as the HTTP PostgREST reads, under actual RLS.
 async function pages(table,site){
  const jobs=table==='interventions', field=jobs?'created_at':'due_on', op=jobs?'<':'>',dir=jobs?'desc':'asc';
  let before=null,all=[];
  for(let n=0;n<10;n++){
   const rows=await q(`select id,${field}::text at from public.${table} where site_id=$1 and ${jobs?"status in ('completed','paid','cancelled')":"status in ('pending','scheduled')"} and ($2::uuid is null or (${field},id) ${op} ($3::${jobs?'timestamptz':'date'},$2::uuid)) order by ${field} ${dir},id ${dir} limit 51`,[site,before?.id??null,before?.at??null]);
   const page=rows.slice(0,50);all.push(...page);if(rows.length<=50)break;before=page.at(-1);
  }
  eq(new Set(all.map(r=>r.id)).size,all.length);return all;
 }
 await as('viewer');eq((await pages('interventions',sites[0])).length,101);eq((await pages('compliance_records',sites[0])).length,301);
 for(const site of sites.slice(1)){eq((await pages('interventions',site)).length,0);eq((await pages('compliance_records',site)).length,0);eq((await q('select id from public.sites where id=$1',[site])).length,0)}
 await as('owner');eq((await pages('compliance_records',sites[0])).length,301);eq((await pages('interventions',sites[1])).length,1);
 await as('foreign');eq((await pages('compliance_records',sites[0])).length,0);
 await as('', 'postgres');await q('delete from public.organization_member_site_grants where user_id=$1',[ids.viewer]);
 await as('viewer');eq((await q('select id from public.sites where id=$1',[sites[0]])).length,0);eq((await pages('interventions',sites[0])).length,0);eq((await pages('compliance_records',sites[0])).length,0);
 console.log(`site records: ${checks} real RLS assertions PASS (301 compliance / 101 jobs; no migration)`);
}finally{await db.close()}
