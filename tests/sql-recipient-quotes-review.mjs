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


 for(const site of [...sites,null]){
  await q("insert into public.interventions(client_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents,created_at)select $1,$2,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','quoted',100,200,'2026-11-07T00:00:00.123456Z' from generate_series(1,$3::integer)",[site===null?ids.client:ids.owner,site,site===null?221:1]);
 }
 await q(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,created_at)
 select id,$1,'[{"label":"QA","quantity":1,"unit_price_cents":10000}]',10000,0,0,10000,created_at from public.interventions`,[ids.client]);
 const job=await one('select id v from public.interventions where site_id is null order by id limit 1');
 const active=await one('select id v from public.quotes where intervention_id=$1',[job]);
 await q(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,created_at)
 select $1,$2,'[{"label":"Ancienne QA","quantity":2,"unit_price_cents":5000}]',10000,0,0,10000,'rejected','2026-10-01T00:00:00Z'::timestamptz+(n*interval '1 second')from generate_series(1,25)n`,[job,ids.client]);
 const old=await one('select id v from public.quotes where intervention_id=$1 order by created_at,id limit 1',[job]);
 const page=(before=null)=>q(`select q.id,q.created_at::text at,q.intervention_id from public.quotes q join public.interventions i on i.id=q.intervention_id where i.client_id=auth.uid()and($1::uuid is null or(q.created_at,q.id)<($2::timestamptz,$1::uuid))order by q.created_at desc,q.id desc limit 51`,[before?.id??null,before?.at??null]);
 await as('client');let all=[],before=null;for(let n=0;n<8;n++){const rows=await page(before),items=rows.slice(0,50);all.push(...items);if(rows.length<=50)break;before=items.at(-1)}eq(all.length,246);eq(new Set(all.map(r=>r.id)).size,246);eq(all.some(r=>r.id===old),true);
 eq((await q('select id from public.quotes where intervention_id=$1 order by created_at desc,id desc limit 20',[job])).some(r=>r.id===old),false);
 const exactClient=(qid)=>q('select q.id,q.status,q.total_cents,q.lines from public.quotes q join public.interventions i on i.id=q.intervention_id where q.id=$1 and i.client_id=auth.uid()',[qid]);
 eq((await exactClient(old))[0],{id:old,status:'rejected',total_cents:10000,lines:[{label:'Ancienne QA',quantity:2,unit_price_cents:5000}]});
 eq((await q("select id from public.quotes where intervention_id=$1 and status in('sent','accepted')limit 2",[job])).map(r=>r.id),[active]);
 await as('', 'postgres');await q('update public.interventions set site_id=$2,client_id=$3 where id=$1',[job,sites[0],ids.owner]);
 const exactManager=(qid,organization)=>q('select q.id from public.quotes q join public.interventions i on i.id=q.intervention_id join public.sites s on s.id=i.site_id join public.organization_members m on m.organization_id=s.organization_id and m.user_id=auth.uid()where q.id=$1 and s.organization_id=$2',[qid,organization]);
 await as('viewer');eq((await exactManager(old,org)).map(r=>r.id),[old]);eq((await exactManager(old,other)).length,0);eq((await exactClient(old)).length,0);
 await as('foreign');eq((await exactClient(old)).length,0);eq((await exactManager(old,org)).length,0);
 // Decision context uses the same existing RLS tables, including terms and read-only site grants.
 await as('', 'postgres');
 await q("insert into public.approval_rules(site_id,enabled,threshold_cents,required_role)values($1,true,10000,'owner')",[sites[0]]);
 await q("insert into public.approvals(quote_id,site_id,status)values($1,$2,'approved')",[active,sites[0]]);
 await q("insert into public.quote_terms(quote_id,valid_until,set_by)values($1,'2000-01-01',$2)",[active,ids.owner]);
 const decisionRead=()=>q(`select q.id,r.threshold_cents,(q.total_cents>r.threshold_cents) required,a.status,t.valid_until::text,
 public.can_manage_site(i.site_id) can_write from public.quotes q join public.interventions i on i.id=q.intervention_id
 left join public.approval_rules r on r.site_id=i.site_id left join public.approvals a on a.quote_id=q.id
 left join public.quote_terms t on t.quote_id=q.id where q.id=$1`,[active]);
 await as('viewer');eq((await decisionRead())[0],{id:active,threshold_cents:10000,required:false,status:'approved',valid_until:'2000-01-01',can_write:false});
 await as('owner');eq((await decisionRead())[0].can_write,true);
 await as('foreign');eq((await decisionRead()).length,0);
 await as('', 'postgres');await q('delete from public.organization_member_site_grants where user_id=$1',[ids.viewer]);
 await as('viewer');eq((await exactManager(old,org)).length,0);eq((await decisionRead()).length,0);
 await as('', 'postgres');await q('update public.interventions set client_id=$2 where id=$1',[job,ids.foreign]);
 await as('client');eq((await exactClient(old)).length,0);
 console.log(`recipient quotes: ${checks} real RLS assertions PASS (246 owned quotes; 25 old revisions; no migration)`);
}finally{await db.close()}
