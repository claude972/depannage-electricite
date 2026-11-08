// Isolated single-connection SQL only. --emit-rollback writes a root-review batch, never executes cloud.
import {readFile,readdir,open} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {isolatedMigrationSql} from './sql-isolated-migrations.mjs';
process.on('uncaughtException',e=>{console.error(e.code||'',e.message,e.where||'');process.exit(1);});
const ids=Object.fromEntries(['client','other','artisan','former','admin','owner','viewer'].map(k=>[k,randomUUID()]));
const run=randomUUID(),q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=`-- QA TRACKING fixture UUIDs ${JSON.stringify(ids)}, run ${run}
begin;
set local statement_timeout='30s';set local lock_timeout='2s';
do $$begin
 if to_regprocedure('public.tracking_command(uuid,text,integer,jsonb)') is null then raise exception '019 absent' using errcode='QA001';end if;
 if exists(select 1 from auth.users where id=any(array[${Object.values(ids).map(v=>q(v)+'::uuid').join(',')}])) then raise exception 'fixture collision' using errcode='QA001';end if;
end $$;
create function pg_temp.t_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TRACKING FAIL: %',label using errcode='QA001';end if;raise notice 'TRACKING PASS: %',label;end$$;
create function pg_temp.t_as(actor uuid,statement text) returns jsonb language plpgsql as $$declare result jsonb;begin
 if actor is null then execute 'set local role anon';else execute 'set local role authenticated';end if;
 perform set_config('request.jwt.claim.sub',coalesce(actor::text,''),true);perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when actor is null then 'anon' else 'authenticated' end)::text,true);
 if statement ~* '^select ' then execute 'select to_jsonb(r.v) from ('||statement||') r(v)' into result;else execute statement into result;end if;execute 'reset role';return result;
 exception when others then execute 'reset role';raise;end$$;
create function pg_temp.t_deny(actor uuid,statement text,expected text,label text) returns void language plpgsql as $$declare code text;begin
 begin perform pg_temp.t_as(actor,statement);exception when others then get stacked diagnostics code=returned_sqlstate;end;
 perform pg_temp.t_check(code=expected,label||' ['||coalesce(code,'success')||']');end$$;
${Object.entries(ids).map(([name,id])=>`insert into auth.users(id,aud,role,email,raw_user_meta_data,email_confirmed_at,created_at,updated_at) values(${q(id)},'authenticated','authenticated',${q('qa-tracking-'+run+'-'+name+'@qa.invalid')},${q(JSON.stringify({full_name:'QA tracking '+name,role:['artisan','former'].includes(name)?'artisan':name==='owner'||name==='viewer'?'manager':'client'}))}::jsonb,now(),now(),now());`).join('\n')}
update public.profiles set role='admin' where id=${q(ids.admin)};
do $$declare
 client uuid=${q(ids.client)};other_id uuid=${q(ids.other)};artisan uuid=${q(ids.artisan)};former uuid=${q(ids.former)};admin uuid=${q(ids.admin)};owner_id uuid=${q(ids.owner)};viewer uuid=${q(ids.viewer)};
 a jsonb; s jsonb; job uuid; job2 uuid; site uuid; org uuid; sid uuid=gen_random_uuid(); v integer; point jsonb; now_text text;
begin
 -- Fixture stage seeding is transaction-local: no payment/quote/admin persisted. Commands below are real RPCs.
 foreach artisan in array array[${q(ids.artisan)}::uuid,former] loop
  perform pg_temp.t_as(artisan,'select public.save_artisan_profile(''QA tracking'',''12345678901234'',''EI'',0,''12 rue du Test'',array[''97200''],array[''panel''])');
  perform pg_temp.t_as(artisan,'select public.submit_artisan_application()');
  perform pg_temp.t_as(admin,format('select public.decide_artisan_application(%L::uuid,''approve'',(select application_version from public.artisan_profiles where user_id=%L::uuid))',artisan,artisan));
 end loop; artisan=${q(ids.artisan)};
 a=pg_temp.t_as(client,'select to_jsonb(i) from public.create_intervention(''panel'',''Panne électrique QA GPS'',''12 rue du Test'',''97200'',''Fort-de-France'',''scheduled'',null) i');job=(a->>'id')::uuid;
 update public.interventions set artisan_id=artisan,status='accepted' where id=job;
 s=pg_temp.t_as(client,format('select public.tracking_snapshot(%L::uuid)',job));
 perform pg_temp.t_check((s->'tracking'->>'control_version')::integer=0,'no tracking row has zero version');
 perform pg_temp.t_deny(null,format('select public.tracking_snapshot(%L::uuid)',job),'42501','anonymous denied');
 perform pg_temp.t_deny(other_id,format('select public.tracking_snapshot(%L::uuid)',job),'42501','unrelated reader denied');
 perform pg_temp.t_deny(client,format('select public.tracking_command(%L::uuid,''start'',0,%L::jsonb)',job,jsonb_build_object('session_id',sid,'consent',true,'consent_policy','tracking-v1')),'42501','client cannot start GPS');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''start'',0,%L::jsonb)',job,jsonb_build_object('session_id',sid,'consent',false,'consent_policy','tracking-v1')),'22023','explicit consent required');
 s=pg_temp.t_as(client,format('select public.tracking_command(%L::uuid,''destination'',0,%L::jsonb)',job,'{"latitude":14.5911,"longitude":-61.0032,"label":"Zone publique aéroport QA","source":"manual"}'));
 v=(s->'tracking'->>'control_version')::integer;
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''destination'',%s,%L::jsonb)',job,v,'{"clear":true}'),'42501','assignee cannot change client target');
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''start'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid,'consent',true,'consent_policy','tracking-v1')));v=(s->'tracking'->>'control_version')::integer;
 perform pg_temp.t_check(s->'tracking'->>'travel_stage'='en_route' and (s->'tracking'->>'shared')::boolean,'start synchronises real travel stage');
 now_text=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 point=jsonb_build_object('session_id',sid,'seq',1,'latitude',14.6035,'longitude',-61.068,'accuracy_m',10,'sampled_at',now_text);
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point));
 perform pg_temp.t_check(s->'tracking'->>'position_state'='fresh' and s->'tracking'->'position'->>'longitude'='-61.068','accepted point is fresh');
 perform pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point));
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point||'{"longitude":-61}'::jsonb),'P0001','same seq different point denied');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point||'{"seq":2,"accuracy_m":999}'::jsonb),'22023','bad accuracy denied');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point||jsonb_build_object('seq',2,'sampled_at','2020-01-01T00:00:00Z')),'22023','old sample denied');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point||jsonb_build_object('seq',2,'sampled_at',to_char((clock_timestamp()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'53300','point admission bounded to five seconds');
 perform pg_temp.t_deny(client,format('update public.intervention_tracking set latitude=0 where intervention_id=%L::uuid',job),'42501','no direct writes');
 perform pg_temp.t_deny(client,'select public.claim_tracking_provider(null,''route'',repeat(''a'',64))','42501','quota service-only');
 perform pg_temp.t_check(pg_temp.t_as(other_id,format('select to_jsonb(count(*)) from public.intervention_tracking where intervention_id=%L::uuid',job))='0'::jsonb,'raw row RLS private');
 perform pg_temp.t_check(pg_temp.t_as(client,format('select to_jsonb(count(*)) from public.intervention_tracking where intervention_id=%L::uuid',job))='1'::jsonb,'authorised raw row fresh');
 -- Latest point only and stale read masks + physically clears, no timeline.
 update public.intervention_tracking set sampled_at=clock_timestamp()-interval '61 seconds' where intervention_id=job;
 perform pg_temp.t_check(pg_temp.t_as(client,format('select to_jsonb(count(*)) from public.intervention_tracking where intervention_id=%L::uuid',job))='0'::jsonb,'stale raw coordinates hidden');
 s=pg_temp.t_as(client,format('select public.tracking_snapshot(%L::uuid)',job));
 perform pg_temp.t_check(s->'tracking'->'position'='null'::jsonb and s->'tracking'->>'position_state'='stale','stale snapshot has no position');
 perform pg_temp.t_check((select latitude is null and sampled_at is null from public.intervention_tracking where intervention_id=job),'snapshot physically purges stale point');
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''stop'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid)));v=(s->'tracking'->>'control_version')::integer;
 perform pg_temp.t_check(not(s->'tracking'->>'shared')::boolean and s->'tracking'->'session_id'='null'::jsonb,'stop revokes session and clears point');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v-1,point),'P0001','late point after stop denied');
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''start'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid,'consent',true,'consent_policy','tracking-v1')));v=(s->'tracking'->>'control_version')::integer;
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''arrived'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid)));v=(s->'tracking'->>'control_version')::integer;
 perform pg_temp.t_check(s->'tracking'->>'travel_stage'='on_site' and not(s->'tracking'->>'shared')::boolean,'arrived uses legacy travel RPC and purges GPS');
 s=pg_temp.t_as(client,format('select public.tracking_command(%L::uuid,''destination'',%s,''{"clear":true}''::jsonb)',job,v));
 perform pg_temp.t_check(s->'tracking'->'destination'='null'::jsonb,'destination clear is explicit and physical');
 v=(s->'tracking'->>'control_version')::integer;
 s=pg_temp.t_as(artisan,format('select public.tracking_command(%L::uuid,''start'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid,'consent',true,'consent_policy','tracking-v1')));v=(s->'tracking'->>'control_version')::integer;
 -- Direct fixture reassignment models the UPDATE used by the real reassign RPC; accepted jobs cannot be reassign-RPC targets.
 update public.interventions set artisan_id=former where id=job;
 perform pg_temp.t_check((select not shared and latitude is null and session_id is null from public.intervention_tracking where intervention_id=job),'assignment trigger physically invalidates');
 perform pg_temp.t_deny(artisan,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point),'42501','former assignee cannot send');
 s=pg_temp.t_as(former,format('select public.tracking_snapshot(%L::uuid)',job));v=(s->'tracking'->>'control_version')::integer;
 s=pg_temp.t_as(former,format('select public.tracking_command(%L::uuid,''start'',%s,%L::jsonb)',job,v,jsonb_build_object('session_id',sid,'consent',true,'consent_policy','tracking-v1')));
 perform pg_temp.t_as(admin,format('select public.decide_artisan_application(%L::uuid,''suspend'',(select application_version from public.artisan_profiles where user_id=%L::uuid))',former,former));
 perform pg_temp.t_check((select not shared and latitude is null and session_id is null from public.intervention_tracking where intervention_id=job),'suspension trigger physically invalidates');
 v=(s->'tracking'->>'control_version')::integer;
 perform pg_temp.t_deny(former,format('select public.tracking_command(%L::uuid,''point'',%s,%L::jsonb)',job,v,point),'42501','suspended point denied');
 update public.interventions set status='completed' where id=job;
 perform pg_temp.t_check((select not shared and latitude is null from public.intervention_tracking where intervention_id=job),'terminal state purges');
 -- Viewer can see tracking but cannot change target; scope revocation removes the entire read.
 a=pg_temp.t_as(owner_id,'select to_jsonb(s) from public.create_site(''GPS QA'',''office'',''12 rue du Test'',0,null) s');site=(a->>'id')::uuid;org=(a->>'organization_id')::uuid;
 insert into public.organization_members(organization_id,user_id,role) values(org,viewer,'manager');
 perform pg_temp.t_as(owner_id,format('select public.set_organization_member_site_access(%L::uuid,%L::uuid,''selected'',%L::jsonb)',org,viewer,jsonb_build_array(jsonb_build_object('site_id',site,'can_write',false))));
 a=pg_temp.t_as(owner_id,format('select to_jsonb(i) from public.create_intervention(''panel'',''Panne électrique site GPS'',''12 rue du Test'',''97200'',''Fort-de-France'',''scheduled'',%L::uuid) i',site));job2=(a->>'id')::uuid;
 s=pg_temp.t_as(viewer,format('select public.tracking_snapshot(%L::uuid)',job2));
 perform pg_temp.t_check(not(s->'permissions'->>'can_confirm_destination')::boolean,'site viewer is read-only');
 perform pg_temp.t_deny(viewer,format('select public.tracking_command(%L::uuid,''destination'',0,''{"clear":true}''::jsonb)',job2),'42501','read-only site target denied');
 perform pg_temp.t_as(owner_id,format('select public.set_organization_member_site_access(%L::uuid,%L::uuid,''selected'',''[]''::jsonb)',org,viewer));
 perform pg_temp.t_deny(viewer,format('select public.tracking_snapshot(%L::uuid)',job2),'42501','site revocation hides snapshot');
 -- Service pacing admission: actual DB authority; no network and no concurrent claim proof.
 a=public.claim_tracking_provider(job,'route',repeat('a',64));perform pg_temp.t_check((a->>'allowed')::boolean,'first provider slot admitted');
 a=public.claim_tracking_provider(job2,'route',repeat('b',64));perform pg_temp.t_check(not(a->>'allowed')::boolean,'shared provider budget blocks second job');
 perform public.tracking_provider_backoff(30);
 a=public.claim_tracking_provider(job2,'geocode',repeat('c',64));perform pg_temp.t_check(not(a->>'allowed')::boolean,'provider backoff shared across operations');
 raise notice 'TRACKING COMPLETE: single connection with fixture stage seeding; no provider, device, HTTP or real races proved';
end $$;
rollback;
`;
if(process.argv[2]==='--emit-rollback'){
 if(process.argv.length!==4)throw Error('Usage --emit-rollback <new file outside checkout>');const dest=path.resolve(process.argv[3]),root=path.resolve(new URL('..',import.meta.url).pathname);if(dest===root||dest.startsWith(root+path.sep))throw Error('Output must be outside checkout');const f=await open(dest,'wx',0o600);try{await f.writeFile(sql);}finally{await f.close();}console.log(JSON.stringify({file:dest,run,fixture_ids:ids,executed:false}));
}else{
 if(process.argv.length!==2)throw Error('Unknown arguments');const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,aud text,role text,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,phone text,phone_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);const names=(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort();
 let used18=false;
 for(const name of names){if(name.includes('019_')&&!names.some(n=>n.includes('018_'))){const migration18=execFileSync('git',['show','6062f92cef83f54c0af1f6713a050fa62a7baeb2:supabase/migrations/202610310018_scoped_support_operators.sql'],{encoding:'utf8'});await db.exec(migration18);used18=true;}const source=await isolatedMigrationSql(db,name,await readFile(new URL(name,dir),'utf8'));await db.exec(source.replace('create extension if not exists pgcrypto;','-- local stub only'));}
 const tables=(await db.query("select table_schema s,table_name n from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth','storage') order by table_schema,table_name")).rows;
 const snapshot=async()=>{const out={};for(const t of tables)out[t.s+'.'+t.n]=(await db.query(`select count(*)::int n from "${t.s}"."${t.n}"`)).rows[0].n;return out;};
 const before=await snapshot();await db.exec(sql);assert.deepEqual(await snapshot(),before);
 console.log(`PASS ${names.length+(used18?1:0)} migrations (018 read-only ${used18?'from reviewed 6062f92':'in checkout'}); isolated tracking matrix, triggers, pacing and rollback counts unchanged. 020 uses an explicit scheduler STUB, NOT a real worker. NOT concurrency/cloud/provider/device.`);
 await assert.rejects(db.exec(sql.replace("(s->'tracking'->>'control_version')::integer=0","false")),e=>e.code==='QA001');await db.exec('rollback');assert.deepEqual(await snapshot(),before);console.log('PASS failed assertion aborts and rollback leaves every table count unchanged.');
 }finally{await db.close();}
}
