import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.query||'',error.detail||'');process.exit(1)});
// ENT-11 — isolated PostgreSQL execution of all versioned migrations, with explicit Auth/Storage/cron stubs.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
// Every fixture below is synthetic QA data: no real site, rate, delay, calendar or regulation.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
`);
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
  const sql = (await isolatedMigrationSql(db, file, await readFile(new URL(file,dir),'utf8'))).replace('create extension if not exists pgcrypto;','-- pgcrypto omitted in isolated stub harness only');
  await db.exec(sql);
}

let checks=0;
const ids={owner:'10000000-0000-4000-8000-000000000001',reader:'10000000-0000-4000-8000-000000000002',outside:'10000000-0000-4000-8000-000000000003',writer:'10000000-0000-4000-8000-000000000004'};
for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())',[id,JSON.stringify({role:'manager',full_name:'QA '+name}),name+'@example.invalid']);
const org=(await db.query("insert into public.organizations(name,owner_id)values('QA contacts org',$1)returning id",[ids.owner])).rows[0].id;
for(const [name,role]of [['owner','owner'],['reader','viewer'],['writer','manager']])await db.query('insert into public.organization_members values($1,$2,$3)',[org,ids[name],role]);
const site=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site','office','QA fixture address',0)returning id",[org])).rows[0].id;
const siteB=(await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA site B','office','QA fixture address',0)returning id",[org])).rows[0].id;
await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.writer]);
await db.query('insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,true)',[org,ids.writer,site]);
async function as(name,sql,args=[]){await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}}
async function snapshot(actor,orgId=org,after=null){return(await as(actor,'select public.organization_sla_snapshot($1,$2)v',[orgId,after])).rows[0].v;}
function ok(v,m){assert.ok(v,m);checks++;}async function denied(fn,code){await assert.rejects(fn,e=>!code||e.code===code);checks++;}
// 103 visible sites in the owner scope, deliberately beyond the legacy local100.
for(let i=0;i<101;i++)await db.query("insert into public.sites(organization_id,name,type,address,budget_cents)values($1,$2,'office','QA fixture address',0)",[org,'QA extra '+i]);
const cal=(await db.query("insert into public.organization_sla_calendars(organization_id,name,timezone,windows,closed_dates,created_by)values($1,'QA calendar','UTC',$2,'[]',$3)returning id",[org,JSON.stringify([{weekday:5,start:'08:00',end:'17:00'}]),ids.owner])).rows[0].id;
const policy=(await db.query("insert into public.site_sla_policies(site_id,name,calendar_id,response_target_minutes,resolution_target_minutes,status,created_by)values($1,'QA policy',$2,60,240,'active',$3)returning id",[site,cal,ids.owner])).rows[0].id;
const caseId=(await db.query("insert into public.site_sla_cases(site_id,policy_id,reference,opened_at,created_by)values($1,$2,'QA synthetic case','2026-11-06T09:00:00Z',$3)returning id",[site,policy,ids.owner])).rows[0].id;
let all=await snapshot('owner');ok(all.visible_sites_total===103&&all.remaining_sites_total===103&&all.sites.length===20&&all.organization_wide===true,'SQL exact visible universe above100, bounded20');
ok(Number.isFinite(Date.parse(all.captured_at)),'SQL timestamp captured once');
let collected=[...all.sites],cursor=all.sites.at(-1).id;
while(collected.length<103){const next=await snapshot('owner',org,cursor);ok(next.organization_id===org&&next.sites.every(s=>s.id>cursor)&&next.sites.length<=20,'successive bounded pages');collected.push(...next.sites);cursor=next.sites.at(-1).id;}
ok(new Set(collected.map(s=>s.id)).size===103,'all visible sites reachable without duplicates');
const own=collected.find(s=>s.id===site);ok(own.organization_id===org&&own.cases_total===1&&own.cases.length===1&&own.policies[0].id===policy,'scoped facts and policies');
const single=await snapshot('writer');ok(single.organization_wide===false&&single.visible_sites_total===1&&single.sites.length===1&&single.sites[0].id===site,'selected grant subset exact, no hidden site totals');
ok(single.calendars_total===1&&single.calendars.length===1&&single.calendars[0].id===cal,'only needed calendars');
ok(single.sites[0].cases[0].pauses_total===0&&single.sites[0].cases[0].pauses.length===0,'zero pauses based on real count');
await db.query("insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",[org,ids.reader]);
await db.query('insert into public.organization_member_site_grants(organization_id,user_id,site_id,can_write)values($1,$2,$3,false)',[org,ids.reader,site]);
const readonly=await snapshot('reader');ok(readonly.sites.length===1&&!readonly.organization_wide,'readonly user can read only visible scope');
await denied(()=>snapshot('outside'),'P0002');await denied(()=>snapshot('owner',crypto.randomUUID()),'P0002');
// Missing calendar is a configured policy state, not an invented default.
await db.query('update public.site_sla_policies set calendar_id=null where id=$1',[policy]);
const missing=await snapshot('reader');ok(missing.calendars_total===0&&missing.calendars.length===0&&missing.sites[0].policies[0].calendar_id===null,'missing calendar preserved');
await db.query('update public.site_sla_policies set calendar_id=$1 where id=$2',[cal,policy]);
// Pause lists and cases are bounded with independent exact totals.
for(let n=0;n<21;n++)await db.query("insert into public.site_sla_pauses(case_id,site_id,started_at,ended_at,created_by)values($1,$2,$3,$4,$5)",[caseId,site,new Date(Date.UTC(2026,10,6,9,n)).toISOString(),new Date(Date.UTC(2026,10,6,9,n,30)).toISOString(),ids.owner]);
const pauses=await snapshot('reader');ok(pauses.sites[0].cases[0].pauses_total===21&&pauses.sites[0].cases[0].pauses.length===20,'pause cap explicit');
ok(pauses.sites[0].cases[0].pauses.every(p=>p.site_id===site&&p.case_id===caseId),'pause identity projection');
for(let n=0;n<101;n++)await db.query("insert into public.site_sla_cases(site_id,policy_id,opened_at,created_by)values($1,$2,'2026-11-06T10:00:00Z',$3)",[site,policy,ids.owner]);
const cases=await snapshot('reader');ok(cases.sites[0].cases_total===102&&cases.sites[0].cases.length===100,'case cap explicit count102 rather than fake100');
ok(!JSON.stringify(cases).includes('QA synthetic case'),'no raw reference, notes or intervention details returned');
await db.query('delete from public.organization_member_site_grants where organization_id=$1 and user_id=$2',[org,ids.reader]);const revoked=await snapshot('reader');ok(revoked.visible_sites_total===0&&revoked.sites.length===0&&!revoked.organization_wide,'removed grant has zero VISIBLE sites, no org claim');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,ids.reader]);await denied(()=>snapshot('reader'),'P0002');
await db.exec('set role anon');await denied(()=>db.query('select public.organization_sla_snapshot($1,null)',[org]),'42501');await db.exec('reset role');
await db.exec('set role service_role');await denied(()=>db.query('select public.organization_sla_snapshot($1,null)',[org]),'42501');await db.exec('reset role');
console.log(JSON.stringify({sql:'PASS',checks,runtime:'PGlite 0.5.13',auth_storage_cron:'SIMULATED',concurrency_cloud_proof:false}));await db.close();
