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
 const users=Object.fromEntries(['client','foreign','artisan','other'].map(x=>[x,crypto.randomUUID()]));
 for(const [name,id]of Object.entries(users))await q('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3)',[id,`${id}@example.test`,JSON.stringify({role:['artisan','other'].includes(name)?'artisan':'client',full_name:'QA'})]);
 for(const id of [users.artisan,users.other]){await q('update public.profiles set artisan_approved=true where id=$1',[id]);await q("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)values($1,'QA','00000000000000','QA address',array['97200'],array['socket'],'approved',true)",[id])}
 const job=await one("insert into public.interventions(client_id,artisan_id,status,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)values($1,$2,'assigned','socket','QA description','QA address','97200','QA city','scheduled',100,200)returning id v",[users.client,users.artisan]);
 const photo=await one("insert into public.documents(owner_id,intervention_id,name,path,mime_type)values($1,$2,'Private name','private/photo.png','image/png')returning id v",[users.client,job]);
 const foreignPhoto=await one("insert into public.documents(owner_id,intervention_id,name,path,mime_type)values($1,$2,'Other','private/foreign.png','image/png')returning id v",[users.foreign,job]);
 async function as(id=users.client,role='authenticated'){await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`)}
 const command=(id,action,ver,doc=null,review=null,consent=null,decision=null)=>one('select public.photo_review_command($1,$2,$3,$4,$5,$6,$7,$8)v',[job,id,action,ver,doc,review,consent,decision]);
 const list=()=>one('select public.photo_review_list($1)v',[job]);
 const source=(review)=>one('select public.photo_review_source($1,$2)v',[job,review]);
 const proof=(id,action,cmd=null,ver=null,category=null,readability=null)=>one('select public.photo_review_provider($1,$2,$3,$4,$5,$6,$7,$8,$9)v',[users.client,job,id,action,cmd,ver,'a'.repeat(64),category,readability]);
 const deny=async(p,code='42501')=>{await assert.rejects(p,e=>e.code===code);checks++};
 await as();eq(await list(),{can_request:true,items:[]});
 await deny(command(crypto.randomUUID(),'request',0,photo,null,false),'22023');
 await deny(command(crypto.randomUUID(),'request',0,foreignPhoto,null,true));
 const request=crypto.randomUUID(),id=await command(request,'request',0,photo,null,true);
 eq(await command(request,'request',0,photo,null,true),id);eq((await list()).items[0].result,null);
 await deny(proof(id,'reserve',request,1));await deny(q('select *from photo_triage_private.reviews'));
 await as(users.foreign);await deny(list());await deny(source(id));
 await as(users.artisan);await deny(command(crypto.randomUUID(),'request',0,photo,null,true));await deny(source(id));eq((await list()).items[0].can_review,false);
 await as();const withdraw=crypto.randomUUID();await command(withdraw,'withdraw',1,null,id);eq((await list()).items[0].status,'withdrawn');eq(await command(withdraw,'withdraw',1,null,id),id);
 const req2=crypto.randomUUID();await command(req2,'request',2,photo,null,true);
 await as('', 'service_role');eq(await proof(id,'reserve',req2,3),true);eq(await proof(id,'reserve',req2,3),false);
 await as();eq((await list()).items[0].status,'uncertain');await deny(command(crypto.randomUUID(),'withdraw',4,null,id),'P0001');
 await as('', 'service_role');await deny(proof(id,'finish',null,null,'safe','readable'),'22023');eq(await proof(id,'finish',null,null,'socket','limited'),true);eq(await proof(id,'finish',null,null,'socket','limited'),false);
 await as();eq((await list()).items[0].status,'awaiting_review');eq((await list()).items[0].result,null);await deny(command(crypto.randomUUID(),'review',5,null,id,null,'validate'));
 await as(users.artisan);eq((await list()).items[0].result,{category:'socket',readability:'limited'});const reviewCmd=crypto.randomUUID();await command(reviewCmd,'review',5,null,id,null,'validate');eq(await command(reviewCmd,'review',5,null,id,null,'validate'),id);
 await as();eq((await list()).items[0].result,{category:'socket',readability:'limited'});
 // Assignment A→B→A never revives validated classification.
 await as('', 'postgres');await q('update public.interventions set artisan_id=$1 where id=$2',[users.other,job]);await q('update public.interventions set artisan_id=$1 where id=$2',[users.artisan,job]);await as();eq((await list()).items[0].status,'invalidated');eq((await list()).items[0].result,null);await deny(source(id));
 // New photo: mutation of document identity between provider reservation and finish invalidates proof.
 await as('', 'postgres');const doc2=await one("insert into public.documents(owner_id,intervention_id,name,path,mime_type)values($1,$2,'QA','private/second.png','image/png')returning id v",[users.client,job]);
 await as();const req3=crypto.randomUUID(),id2=await command(req3,'request',0,doc2,null,true);
 await as('', 'service_role');eq(await proof(id2,'reserve',req3,1),true);
 await as('', 'postgres');await q("update public.documents set path='private/replaced.png'where id=$1",[doc2]);
 await as('', 'service_role');await deny(proof(id2,'finish',null,null,'panel','readable'));
 await as();eq((await list()).items.find(i=>i.id===id2).result,null);
 await as('', 'anon');await deny(list());
 console.log(`PASS photo triage: ${checks} checks, consent/version/ACL, no provider-proof forgery, current artisan validation and irreversible invalidation`);
}catch(e){console.error(e.message,e.code,e.query,e.stack?.split('\n').slice(0,5).join('\n'));process.exitCode=1}finally{await db.close()}
