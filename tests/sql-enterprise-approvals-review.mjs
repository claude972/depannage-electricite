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
  await q("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,created_at)select $1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','quoted',100,200,'2026-11-07T00:00:00.123456Z' from generate_series(1,$3::integer)",[ids.client,site,site===sites[0]?221:1]);
 }
 // Privileged fixtures only: no policy is enabled and no synthetic decision is made.
 await q(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents)
 select id,$1,'[{"label":"QA","quantity":1,"unit_price_cents":10000}]',10000,0,0,10000 from public.interventions`,[ids.client]);
 await q(`insert into public.approvals(quote_id,site_id,created_at) select q.id,i.site_id,i.created_at from public.quotes q join public.interventions i on i.id=q.intervention_id`);
 await q("insert into public.approval_rules(site_id,threshold_cents,required_role,enabled)values($1,10000,'owner',true)",[sites[0]]);
 await q("update public.approvals set status='approved',decided_by=$2,decided_at=now() where id=(select id from public.approvals where site_id=$1 order by id limit 1)",[sites[0],ids.owner]);
 await q("update public.approvals set status='rejected',decided_by=$2,decided_at=now(),note='QA refus' where id=(select id from public.approvals where site_id=$1 and status='pending' order by id limit 1)",[sites[0],ids.owner]);
 const join=`from public.approvals a join public.sites s on s.id=a.site_id join public.quotes q on q.id=a.quote_id join public.interventions i on i.id=q.intervention_id where s.organization_id=$1 and i.site_id=a.site_id`;
 const page=(organization,site=null,before=null)=>q(`select a.id,a.created_at::text at,a.site_id,q.intervention_id ${join} and($2::uuid is null or a.site_id=$2)and($3::uuid is null or(a.created_at,a.id)<($4::timestamptz,$3::uuid))order by a.created_at desc,a.id desc limit 51`,[organization,site,before?.id??null,before?.at??null]);
 const allPages=async(organization,site=null)=>{let all=[],before=null;for(let n=0;n<8;n++){const rows=await page(organization,site,before),items=rows.slice(0,50);all.push(...items);if(rows.length<=50)break;before=items.at(-1)}eq(new Set(all.map(r=>r.id)).size,all.length);return all};
 await as('viewer');const all=await allPages(org);eq(all.length,221);eq(all.every(r=>r.site_id===sites[0]),true);
 for(const [status,count]of [['pending',219],['approved',1],['rejected',1]])eq((await q(`select a.id ${join} and a.status=$2`,[org,status])).length,count);
 const oldest=all.at(-1);eq((await q(`select a.id ${join} and a.id=$2`,[org,oldest.id])).map(r=>r.id),[oldest.id]);
 eq((await q('select enabled,required_role,threshold_cents from public.approval_rules where site_id=$1',[sites[0]])),[{enabled:true,required_role:'owner',threshold_cents:10000}]);
 eq((await page(org,sites[1])).length,0);eq((await page(other)).length,0);
 await as('owner');eq((await allPages(org)).length,222);eq((await q('select site_id from public.approval_rules where site_id=$1',[sites[1]])).length,0);
 await as('foreign');eq((await page(org)).length,0);eq((await page(other)).length,1);
 await as('client');eq((await q('select id from public.approvals')).length,0);
 await as('', 'postgres');await q('delete from public.organization_member_site_grants where user_id=$1',[ids.viewer]);
 await as('viewer');eq((await page(org)).length,0);eq((await q('select site_id from public.approval_rules where site_id=$1',[sites[0]])).length,0);
 await as('', 'postgres');await q('delete from public.organization_members where user_id=$1',[ids.owner]);
 await as('owner');eq((await page(org)).length,0);
 console.log(`enterprise approvals: ${checks} real RLS assertions PASS (221 selected-site approvals, exact old detail and rules; no migration)`);
}finally{await db.close()}
