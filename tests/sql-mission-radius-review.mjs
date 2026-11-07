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
      email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz
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
 const actor=crypto.randomUUID(),other=crypto.randomUUID(),client=crypto.randomUUID();
 for(const [id,role]of [[actor,'artisan'],[other,'artisan'],[client,'client']])await q('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3)',[id,`${id}@example.test`,JSON.stringify({role,full_name:'QA'})]);
 for(const id of [actor,other]){
  await q('update public.profiles set artisan_approved=true where id=$1',[id]);
  await q("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)values($1,'QA','00000000000000','QA address',array['97200','97232','97250','97299'],array['socket'],'approved',true)",[id]);
 }
 async function as(id=actor,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`)}
 const job=async(postal,created='2026-11-06T12:00:00Z')=>one("insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,created_at)values($1,'socket','QA synthetic description','QA private address',$2,'QA city','scheduled',100,200,$3)returning id v",[client,postal,created]);
 const near=await job('97200'),far=await job('97232'),ambiguous=await job('97250'),unknown=await job('97299'),outside=await job('75000');
 await as();const view=()=>one('select public.artisan_mission_radius()v');
 const save=(version,code,km)=>one('select public.save_artisan_mission_radius($1,$2,$3)v',[version,code,km]);
 const page=(after=null,id=null)=>one('select public.available_missions_page($1,$2)v',[after,id]);
 const selected=(id)=>one('select public.available_missions_page(null,null,$1)v',[id]);
 const denied=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 eq((await view()).preference,{version:0,reference_code:null,radius_km:null});
 eq((await view()).options.length,34);eq(Object.keys((await view()).options[0]).sort(),['code','name']);
 eq((await page()).items.length,4);eq((await selected(outside)).items.length,0);
 await denied(save(0,'97209',0),'22023');await denied(save(0,'97209',201),'22023');await denied(save(0,'75056',5),'22023');await denied(save(0,null,5),'22023');
 eq((await save(0,'97209',5)).preference,{version:1,reference_code:'97209',radius_km:5});
 eq((await selected(near)).items.length,1);eq((await selected(far)).items.length,0); // real official centres ~8.7 km apart
 eq((await selected(ambiguous)).items.length,1);eq((await selected(unknown)).items.length,1);
 await denied(save(0,'97209',20),'P0001');
 await as(other);eq((await view()).preference.version,0);eq((await selected(far)).items.length,1);
 await as(client);await denied(view());await denied(save(0,null,null));
 await as();await denied(q('select *from mission_radius_private.commune_centres'));await denied(q('select *from mission_radius_private.preferences'));
 // Offer seen while broad radius; shrinking it is checked by the REAL acceptance RPC.
 await save(1,'97209',20);eq((await selected(far)).items.length,1);
 await save(2,'97209',5);
 await denied(q("select public.intervention_action($1,'accept_mission',null,20,null)",[far]));
 await save(3,'97209',20);
 const accepted=await one("select to_jsonb(public.intervention_action($1,'accept_mission',null,20,null))v",[far]);eq(accepted.artisan_id,actor);eq(accepted.status,'assigned');
 await save(4,null,null);eq((await view()).preference,{version:5,reference_code:null,radius_km:null});
 // Older excluded offers must not consume the page limit. Existing ordering/cursor unchanged.
 await as('', 'postgres');
 const excluded=[];for(let i=0;i<65;i++)excluded.push(await job('97232','2026-11-05T12:00:00Z'));
 const expected=[near,ambiguous,unknown];for(let i=0;i<60;i++)expected.push(await job('97200','2026-11-06T13:00:00Z'));
 await as();await save(5,'97209',5);
 let seen=[],cursor=null;
 for(let i=0;i<3;i++){
  const p=await page(cursor?.created_at??null,cursor?.id??null);eq(p.items.length<=51,true);
  const slice=p.items.slice(0,50);for(const item of slice){eq(item.postal_code==='972**'&&!('latitude'in item)&&!('longitude'in item)&&!('address'in item),true);seen.push(item.id)}
  cursor=slice.at(-1);if(p.items.length<=50)break;
 }
 eq(new Set(seen).size,expected.length);eq(new Set(seen),new Set(expected));
 await as('', 'postgres');await q('update public.artisan_profiles set available=false where user_id=$1',[actor]);await as();eq((await page()).items.length,0);
 await as('', 'postgres');await q('update public.artisan_profiles set available=true where user_id=$1',[actor]);
 const writer=await one("select pg_get_functiondef('public.save_artisan_mission_radius(integer,text,integer)'::regprocedure)v");eq(writer.indexOf('public.profiles')<writer.indexOf('public.artisan_profiles'),true);eq(writer.includes('public.interventions'),false);
 await as('', 'anon');await denied(view());await denied(save(0,null,null));
 // Real HTTP handlers use SQL results and never serialize coordinates.
 const {createMissionRadiusHandlers}=await import('../lib/features/mission-radius/handlers.ts');
 const h=createMissionRadiusHandlers(async()=>({db:{async rpc(name,args={}){await as();try{return {data:await one(`select public.${name}(${Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')})v`,Object.values(args)),error:null}}catch(e){return {data:null,error:{code:e.code}}}}}}));
 const read=await h.GET(new Request('https://app.example.test/api/artisan/mission-radius'));eq(read.status,200);const json=await read.json();eq(JSON.stringify(json).includes('latitude'),false);
 const write=await h.POST(new Request('https://app.example.test/api/artisan/mission-radius',{method:'POST',headers:{origin:'https://app.example.test'},body:JSON.stringify({expected_version:6,reference_code:null,radius_km:null})}));eq(write.status,200);eq((await write.json()).preference.version,7);
 console.log(`PASS mission radius: ${checks} checks, official34 centres, real acceptance, before-pagination filtering and true handlers`);
}catch(e){console.error(e.message,e.code,e.query,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}
