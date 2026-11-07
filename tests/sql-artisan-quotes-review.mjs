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
 // Equivalent relational shape to the PostgREST INNER embeds; no security definer RPC.
 const quote=async(job,author)=>one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,created_at)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":10000}]',10000,20,2000,12000,'2026-11-07T00:00:00.123456Z')returning id v`,[job,author]);
 let moved;for(let n=0;n<123;n++){const job=await insert(ids.artisan,'quoted');const quoteId=await quote(job,ids.artisan);if(n===0)moved={job,quoteId}}
 const foreign=await insert(ids.other,'quoted');await quote(foreign,ids.other);
 const page=(before=null)=>q(`select q.id,q.intervention_id,q.created_at from public.quotes q join public.interventions i on i.id=q.intervention_id join public.profiles p on p.id=q.artisan_id where q.artisan_id=auth.uid()and i.artisan_id=auth.uid()and p.role='artisan'and($1::uuid is null or q.id<$1)order by q.created_at desc,q.id desc limit 51`,[before]);
 await as('artisan');let all=[],before=null;for(let n=0;n<4;n++){const rows=await page(before),visible=rows.slice(0,50);all.push(...visible);if(rows.length<=50)break;before=visible.at(-1).id}eq(all.length,123);eq(new Set(all.map(x=>x.id)).size,123);
 await as('other');eq((await page()).length,1);
 await as('', 'postgres');await q('update public.interventions set artisan_id=$2 where id=$1',[moved.job,ids.other]);
 await as('artisan');eq(await one('select count(*)::integer v from public.quotes where id=$1',[moved.quoteId]),0);
 await as('other');eq((await page()).length,1); // newly assigned artisan never acquires old author's quote in this list
 await as('', 'postgres');await q("update public.profiles set role='client'where id=$1",[ids.artisan]);await as('artisan');eq((await page()).length,0);
 await as('client');eq((await page()).length,0);await as('admin');eq((await page()).length,0);
 console.log(`artisan quotes: ${checks} real RLS assertions PASS (123 rows; no new migration)`);
}finally{await db.close()}
