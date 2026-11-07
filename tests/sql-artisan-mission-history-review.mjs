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

 const ids=Object.fromEntries(['artisan','other','client','manager','admin'].map(x=>[x,crypto.randomUUID()]));
 for(const[n,id]of Object.entries(ids)){await q('insert into auth.users(id,raw_user_meta_data)values($1,$2)',[id,JSON.stringify({full_name:'QA',role:'client'})]);await q('update public.profiles set role=$2,artisan_approved=true where id=$1',[id,['artisan','other'].includes(n)?'artisan':n])}
 async function as(actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[ids[actor]??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const insert=async(artisan,status,site=null)=>one("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,created_at)values($1,$2,$3,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled',$4,100,200,'2026-11-07T00:00:00.123456Z')returning id v",[ids.client,artisan,site,status]);
 for(let n=0;n<123;n++)await insert(ids.artisan,['assigned','quoted','accepted','in_progress'][n%4]);
 for(let n=0;n<112;n++)await insert(ids.artisan,n%2?'paid':'completed');
 await insert(ids.artisan,'cancelled');await insert(null,'requested');
 const org=await one("insert into public.organizations(name,owner_id)values('QA', $1)returning id v",[ids.client]);
 await q("insert into public.organization_members(organization_id,user_id,role)values($1,$2,'viewer')",[org,ids.artisan]);
 const site=await one("insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA adresse')returning id v",[org]);
 const foreign=await insert(ids.other,'assigned',site);
 const page=(f='active',at=null,id=null)=>one('select public.artisan_mission_history_page($1,$2,$3)v',[f,at,id]);
 await as('artisan');eq(await one('select public.can_access_intervention($1)v',[foreign]),true);
 for(const[f,count]of [['active',123],['done',112]]){let cursor=null,all=[];for(let n=0;n<5;n++){const data=await page(f,cursor?.created_at,cursor?.id);eq(data.counts,{active:123,done:112});eq(data.items.length<=51,true);const visible=data.items.slice(0,50);all.push(...visible);if(data.items.length<=50)break;cursor=visible.at(-1)}eq(all.length,count);eq(new Set(all.map(x=>x.id)).size,count);eq(all.some(x=>x.id===foreign),false);eq(Object.keys(all[0]).sort(),['id','category','address','city','urgency','status','created_at','completed_at','paid_at'].sort());eq(all.map(x=>x.id),all.map(x=>x.id).sort().reverse())}
 await deny(page('unknown'),'22023');await deny(page('active','infinity',foreign),'22023');await deny(page('active',null,foreign),'22023');
 for(const who of ['client','manager','admin']){await as(who);await deny(page())}
 await as('other');eq((await page()).counts,{active:1,done:0});eq((await page()).items.map(x=>x.id),[foreign]);await as('', 'anon');await deny(page());
 await as('', 'postgres');eq(await one("select prosecdef v from pg_proc where oid='public.artisan_mission_history_page(text,timestamptz,uuid)'::regprocedure"),false);
 const moving=await insert(ids.artisan,'in_progress');await q("update public.interventions set created_at='2026-11-08T00:00:00Z' where id=$1",[moving]);await as('artisan');eq((await page()).counts,{active:124,done:112});eq((await page()).items.some(x=>x.id===moving),true);
 await q("select public.intervention_action($1,'complete','{}',0,null)",[moving]);
 eq((await page()).counts,{active:123,done:113});eq((await page()).items.some(x=>x.id===moving),false);eq((await page('done')).items.some(x=>x.id===moving),true);
 await as('', 'postgres');await q('update public.interventions set artisan_id=$2 where id=$1',[moving,ids.other]);await as('artisan');eq((await page('done')).counts,{active:123,done:112});eq((await page('done')).items.some(x=>x.id===moving),false);
 await as('', 'postgres');await q("update public.profiles set role='client' where id=$1",[ids.artisan]);await as('artisan');await deny(page());
 console.log(`artisan mission history: ${checks} SQL assertions PASS`);
}finally{await db.close()}
