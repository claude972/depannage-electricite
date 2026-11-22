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

 await q('update public.sites set budget_cents=case when id=$1 then 100000 when id=$2 then 200000 else 999999 end',[sites[0],sites[1]]);
 const seed=async(site,status='accepted')=>{const job=await one("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,$3,'panel','QA panne synthétique','QA adresse','97200','QA ville','scheduled','completed',100,200)returning id v",[ids.client,ids.artisan,site]);
 const quote=await one("insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":1000}]',1000,0,0,1000,$3)returning id v",[job,ids.artisan,status]);
 await q("insert into public.approvals(quote_id,site_id,status)values($1,$2,'pending')",[quote,site]);
 await q("insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,1,'QA','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":200}]',200,0,0,200,'accepted')",[job,quote,ids.artisan]);return {job,quote}};
 const quotes=[];for(let n=0;n<123;n++)quotes.push(await seed(sites[0]));await seed(sites[1]);await seed(sites[2]);const rejected=await seed(sites[0],'rejected');await q("update public.approvals set status='rejected'where quote_id=$1",[rejected.quote]);
 await q("insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,$3,2,'QA','[{\"label\":\"QA\",\"quantity\":1,\"unit_price_cents\":300}]',300,0,0,300,'proposed')",[quotes[0].job,quotes[0].quote,ids.artisan]);
 for(let n=0;n<120;n++)await q("insert into public.compliance_records(site_id,title,kind,due_on,status,created_by)values($1,'QA','audit',(statement_timestamp()at time zone'America/Martinique')::date+$2::integer,'pending',$3)",[sites[0],n%31,ids.owner]);
 for(const[site,offset,status]of [[sites[0],-1,'pending'],[sites[0],31,'pending'],[sites[0],0,'completed'],[sites[1],30,'scheduled'],[sites[2],0,'pending']])await q("insert into public.compliance_records(site_id,title,kind,due_on,status,created_by)values($1,'QA','audit',(statement_timestamp()at time zone'America/Martinique')::date+$2::integer,$3,$4)",[site,offset,status,ids.owner]);
 const read=(organization=org,site=null)=>one('select public.enterprise_professional_overview($1,$2)v',[organization,site]);
 await as('owner');const all=await read();eq(all.counts,{approvals_pending:124,deadlines30:121});eq(all.amounts,{accepted_commitment_cents:148800,reference_budget_cents:300000,currency:'eur'});eq(Object.keys(all).sort(),['organization_id','site_id','counts','amounts','window','captured_at'].sort());
 eq(all.window.from,await one("select to_char((statement_timestamp()at time zone'America/Martinique')::date,'YYYY-MM-DD')v"));eq(all.window.to,await one("select to_char((statement_timestamp()at time zone'America/Martinique')::date+30,'YYYY-MM-DD')v"));
 eq((await read(org,sites[0])).amounts.accepted_commitment_cents,147600);
 eq(await one('select sum(accepted_total_cents)::integer v from public.accepted_quote_totals($1)',[quotes.map(x=>x.quote)]),147600);
 await deny(read(other),'P0002');await deny(read(org,sites[2]),'P0002');await deny(read(null),'22023');
 await as('viewer');eq((await read()).counts,{approvals_pending:123,deadlines30:120});eq((await read()).amounts,{accepted_commitment_cents:147600,reference_budget_cents:100000,currency:'eur'});eq(await one('select public.can_manage_site($1)v',[sites[0]]),false);await deny(read(org,sites[1]),'P0002');
 for(const who of ['client','artisan','admin']){await as(who);await deny(read())}await as('foreign');eq((await read(other)).counts,{approvals_pending:1,deadlines30:1});await deny(read(),'P0002');await as('', 'anon');await deny(read());
 await as('', 'postgres');await q('delete from public.organization_member_site_grants where user_id=$1',[ids.viewer]);await as('viewer');eq((await read()).counts,{approvals_pending:0,deadlines30:0});eq((await read()).amounts,{accepted_commitment_cents:0,reference_budget_cents:0,currency:'eur'});await deny(read(org,sites[0]),'P0002');
 await as('', 'postgres');await q("update public.profiles set role='client'where id=$1",[ids.owner]);await as('owner');await deny(read());await as('', 'postgres');await q('delete from public.organization_members where user_id=$1',[ids.viewer]);await as('viewer');await deny(read(),'P0002');
 await as('', 'postgres');eq(await one("select prosecdef v from pg_proc where oid='public.enterprise_professional_overview(uuid,uuid)'::regprocedure"),false);
 console.log(`enterprise professional overview: ${checks} SQL assertions PASS`);
}finally{await db.close()}
