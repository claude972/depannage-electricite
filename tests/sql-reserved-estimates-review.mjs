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
    if(name.endsWith('_reserved_indicative_estimates.sql')||name.endsWith('_indicative_estimate_authorization_order.sql'))continue;
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


 const expected={outage:[15000,25000],panel:[15000,35000],socket:[8000,18000],lighting:[8000,20000],diagnostic:[12000,28000]};
 const actor=crypto.randomUUID(),admin=crypto.randomUUID(),key=crypto.randomUUID(),oldkey=crypto.randomUUID();
 for(const id of [actor,admin])await q("insert into auth.users(id,raw_user_meta_data,email_confirmed_at,phone,phone_confirmed_at)values($1,'{\"full_name\":\"QA\"}',now(),'596696000000',now())",[id]);
 await q("update public.profiles set role='admin'where id=$1",[admin]);
 async function as(id,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec(`set role ${role}`)}
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 const payload={service_slug:'demande-socket',category:'socket',description:'QA panne synthétique',address:'QA adresse',postal_code:'97200',city:'QA ville',urgency:'scheduled'},contact={first_name:'QA',last_name:'Test',email:'',phone:'+596696000000'};
 const prepare=()=>one('select public.prepare_phone_booking($1,$2,$3,$4)v',[key,payload,contact,'card_hold']);
 await as(actor);const before=await prepare();eq(before.expected_max_cents,18000);
 const old=await one("select to_jsonb(public.create_intervention_once($1,'socket','QA panne synthétique','QA adresse','97200','QA ville','scheduled',null))v",[oldkey]);
 await as(null,'postgres');const migration=await readFile(new URL('20261107222548_reserved_indicative_estimates.sql',dir),'utf8');await db.exec(migration);await db.exec(await readFile(new URL('20261107223002_indicative_estimate_authorization_order.sql',dir),'utf8'));
 eq(await one('select indicative_price_version v from public.interventions where id=$1',[old.id]),null);
 eq(await one('select estimate_max_cents v from public.interventions where id=$1',[old.id]),18000);
 eq(await one('select jsonb_build_array(indicative_price_version,expected_min_cents,expected_max_cents)v from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actor,key]),[1,8000,18000]);
 await as(actor);{const now=await prepare();eq(now.estimate,{version:1,min_cents:8000,max_cents:18000,currency:'eur'});delete now.estimate;eq(now,before);}
 await deny(q("select indicative_price_private.create_reserved_intervention('socket','QA description','QA adresse','97200','QA ville','scheduled',null,1,1,2)"));
 await as(admin);const baseline=await one('select public.read_indicative_prices()v');const changed=structuredClone(baseline.ranges);for(const r of Object.values(changed)){r.min_cents+=1000;r.max_cents+=1000}
 await q('select public.stage_indicative_prices($1,1,$2,$3)',[crypto.randomUUID(),changed,'QA changement futur non publié']);
 await as(null,'postgres');await deny(q('update indicative_price_private.control set active_version=2'),'23514');
 // Test-only simulated future publication, rolled back. Production has no activation path.
 await db.exec('begin');await db.exec('alter table indicative_price_private.control drop constraint control_active_version_check');await db.exec('update indicative_price_private.control set active_version=2');
 await as(actor);{const now=await prepare();eq(now.estimate,{version:1,min_cents:8000,max_cents:18000,currency:'eur'});delete now.estimate;eq(now,before);}
 await as(null,'service_role');await q("select public.record_phone_booking_provider($1,$2,'cs_test_QAreserved','pi_QAreserved','session')",[actor,key]);await q("select public.record_phone_booking_provider($1,$2,'cs_test_QAreserved','pi_QAreserved','authorize',18000,'eur','requires_capture')",[actor,key]);
 await as(actor);const completed=await one('select public.submit_phone_booking($1)v',[key]);eq([completed.intervention.estimate_min_cents,completed.intervention.estimate_max_cents],[8000,18000]);
 const replay=await one('select public.submit_phone_booking($1)v',[key]);eq(replay.intervention,completed.intervention);
 const once=await one("select to_jsonb(public.create_intervention_once($1,'socket','QA panne synthétique','QA adresse','97200','QA ville','scheduled',null))v",[key]);eq(once.id,completed.intervention.id);eq(once.indicative_price_version,1);
 await as(null,'postgres');await deny(q('update public.interventions set estimate_max_cents=19000 where id=$1',[once.id]),'P0001');
 // An expected failure aborts the test transaction; use rollback and start a fresh simulation.
 await db.exec('rollback');
 await db.exec('begin');await db.exec('alter table indicative_price_private.control drop constraint control_active_version_check');await db.exec('update indicative_price_private.control set active_version=2');
 for(const[category,range]of Object.entries(expected)){
  await as(null,'postgres');const id=crypto.randomUUID();await q("insert into auth.users(id,raw_user_meta_data,email_confirmed_at,phone,phone_confirmed_at)values($1,'{\"full_name\":\"QA\"}',now(),'596696000000',now())",[id]);await as(id);
  const job=await one("select to_jsonb(public.create_intervention_once($1,$2,'QA panne synthétique','QA adresse','97200','QA ville','scheduled',null))v",[crypto.randomUUID(),category]);eq([job.indicative_price_version,job.estimate_min_cents,job.estimate_max_cents],[2,range[0]+1000,range[1]+1000]);
  const guest=await one('select public.create_on_site_booking($1,$2,$3)v',[crypto.randomUUID(),{...payload,service_slug:'demande-'+category,category},contact]);eq([guest.intervention.estimate_min_cents,guest.intervention.estimate_max_cents],[range[0]+1000,range[1]+1000]);
 }
 await as(null,'postgres');await db.exec('rollback');eq(await one('select active_version v from indicative_price_private.control'),1);
 eq(await one("select count(*)::integer v from public.interventions where indicative_price_version=2"),0);
 eq(await one("select count(*)::integer v from public.phone_booking_requests where actor_id=$1 and request_id=$2",[actor,key]),1);
 // Current site access and archived-site guards remain authoritative on public creation.
 const manager=crypto.randomUUID();await q("insert into auth.users(id,raw_user_meta_data)values($1,'{\"full_name\":\"QA manager\"}')",[manager]);await q("update public.profiles set role='manager'where id=$1",[manager]);
 const org=await one("insert into public.organizations(name,owner_id)values('QA',$1)returning id v",[admin]);await q("insert into public.organization_members values($1,$2,'viewer')",[org,manager]);
 const site=await one("insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA adresse')returning id v",[org]);
 const siteCreate=()=>one("select to_jsonb(public.create_intervention_once($1,'socket','QA panne synthétique','QA adresse','97200','QA ville','scheduled',$2))v",[crypto.randomUUID(),site]);
 await as(manager);await deny(siteCreate());await as(null,'postgres');await q("update public.organization_members set role='manager'where user_id=$1",[manager]);await as(manager);eq((await siteCreate()).indicative_price_version,1);
 await as(null,'postgres');await q('update public.sites set archived_at=now()where id=$1',[site]);await as(manager);await deny(siteCreate(),'P0001');await as(null,'postgres');
 eq((await one("select pg_get_functiondef('indicative_price_private.current_range(text)'::regprocedure)v")).includes('for share'),true);
 // Current-schema privileged synthetic duplicate, distinct from the historical 022/023 fixture.
 const duplicate=crypto.randomUUID();await q("insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,expected_max_cents,phone_verified,indicative_price_version,expected_min_cents)select actor_id,$1,payload,contact,method,expected_max_cents,phone_verified,1,8000 from public.phone_booking_requests where actor_id=$2 and request_id=$3",[duplicate,actor,key]);
 await as(actor);await deny(one('select public.guest_booking_pending()v'),'55000');await as(null,'postgres');await q('delete from public.phone_booking_requests where actor_id=$1 and request_id=$2',[actor,duplicate]);
 const deniedActor=crypto.randomUUID();await q("insert into auth.users(id,raw_user_meta_data)values($1,'{\"full_name\":\"QA denied\"}')",[deniedActor]);await q("update public.profiles set role='artisan'where id=$1",[deniedActor]);await as(deniedActor);
 await deny(q("select public.create_intervention('invalid','QA description','QA adresse','97200','QA ville','scheduled',null)"));
 await as(actor);await deny(q("select public.create_intervention('invalid','QA description','QA adresse','97200','QA ville','scheduled',null)"),'22023');
 console.log(`reserved estimates: ${checks} SQL assertions PASS (future activation simulated only inside rollback)`);
}finally{await db.close()}
