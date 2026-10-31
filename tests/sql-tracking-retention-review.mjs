// No cloud/clock-worker: explicit pg_cron metadata/schedule STUB under isolated PGlite.
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export const nativeInstallPattern=/-- BEGIN PG_CRON INSTALL[\s\S]*?-- END PG_CRON INSTALL/;
/** Simulates named schedule upsert and observable call count, NOT a timer or extension loader. */
export async function installCronStub(db){
 await db.exec(`create schema cron;
 create table cron.job(jobid bigint generated always as identity primary key,jobname text not null,schedule text not null,command text not null,database text not null default current_database(),username text not null default current_user,active boolean not null default true,nodename text not null default 'localhost',nodeport integer default inet_server_port(),unique(jobname,username));
 create table cron.schedule_calls(id integer);
 create function cron.schedule(name text,cadence text,sql text) returns bigint language plpgsql as $$declare result bigint;begin
 insert into cron.schedule_calls values(1);
 insert into cron.job(jobname,schedule,command) values(name,cadence,sql) on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid into result;return result;
 end$$;`);
}
export function stubbedRetentionSql(source){if(!nativeInstallPattern.test(source))throw Error('Native extension block missing');return source.replace(nativeInstallPattern,'-- TEST ONLY: pg_cron install replaced by explicit metadata/schedule stub; NO worker exists.');}
async function main(){
 const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),names=(await readdir(dir)).filter(n=>n.endsWith('.sql')&&!n.includes('020_')).sort();
 for(const name of names){if(name.includes('019_')&&!names.some(n=>n.includes('018_')))await db.exec(execFileSync('git',['show','6062f92cef83f54c0af1f6713a050fa62a7baeb2:supabase/migrations/202610310018_scoped_support_operators.sql'],{encoding:'utf8'}));await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists pgcrypto;','-- Auth/Storage local stub only'));}
 const original=await readFile(new URL('202610310020_tracking_retention.sql',dir),'utf8');
 // The unmodified native install must fail explicitly when pg_cron is unavailable in this engine.
 await assert.rejects(db.exec(original),e=>e.code==='P0001'&&e.message.includes('pg_cron is unavailable'));await db.exec('rollback');
 assert.equal((await db.query("select to_regclass('cron.job') v")).rows[0].v,null);
 await installCronStub(db);const source=stubbedRetentionSql(original);
 await db.exec("insert into cron.job(jobname,schedule,command) values('foreign_untouched','0 0 * * *','select 42;')");
 const foreign=(await db.query("select * from cron.job where jobname='foreign_untouched'")).rows;
 await db.exec(source);
 const name='depannage_tracking_retention_v1';const jobs=(await db.query('select * from cron.job where jobname=$1',[name])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].schedule,'* * * * *');assert.equal(jobs[0].command,'select public.purge_expired_tracking_points();');assert.equal(jobs[0].username,'postgres');assert.equal(jobs[0].active,true);
 assert.equal((await db.query('select count(*)::int n from cron.schedule_calls')).rows[0].n,1);
 await db.exec(source);assert.deepEqual((await db.query('select * from cron.job where jobname=$1',[name])).rows,jobs);assert.equal((await db.query('select count(*)::int n from cron.schedule_calls')).rows[0].n,1);
 assert.deepEqual((await db.query("select * from cron.job where jobname='foreign_untouched'")).rows,foreign);
 console.log('PASS explicit scheduler STUB: native install fails unavailable; correct named job is created once/reapply untouched; foreign job unchanged. NO worker/timing proof.');
 // Every ownership/target/command drift must be refused without fixing or scheduling it.
 for(const [column,value] of [['command','select 99;'],['schedule','*/5 * * * *'],['username','foreign_owner'],['database','foreign_db'],['nodename','foreign.example'],['active',false],['nodeport',5433]]){
  await db.query(`update cron.job set "${column}"=$1 where jobname=$2`,[value,name]);const before=(await db.query('select * from cron.job order by jobid')).rows;
  await assert.rejects(db.exec(source),e=>e.code==='P0001'&&e.message.includes('collision'));await db.exec('rollback');assert.deepEqual((await db.query('select * from cron.job order by jobid')).rows,before);assert.equal((await db.query('select count(*)::int n from cron.schedule_calls')).rows[0].n,1);
  const reset=jobs[0][column];await db.query(`update cron.job set "${column}"=$1 where jobname=$2`,[reset,name]);
 }
 await db.exec('grant usage on schema cron to authenticated');await assert.rejects(db.exec(source),e=>e.code==='42501');await db.exec('rollback');await db.exec('revoke usage on schema cron from authenticated');
 console.log('PASS collision/foreign owner/endpoint/inactive job and unexpected app schema access all fail closed without other job changes.');
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select public.purge_expired_tracking_points()'),e=>e.code==='42501');await assert.rejects(db.query('select * from cron.job'),e=>e.code==='42501');await db.exec('reset role');}
 // SQL fixture points only: no user coordinate, admin, grant or provider call.
 await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('92000000-0000-4000-8000-000000000001','qa-retention@example.invalid','{"role":"client","full_name":"QA retention"}');
 insert into public.interventions(id,client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
 select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92000000-0000-4000-8000-000000000001','panel','Panne QA retention','Lieu public QA','97200','Fort-de-France','scheduled',1,2 from generate_series(10,1012) n;
 insert into public.intervention_tracking(intervention_id,control_version,shared,session_id,consent_at,consent_policy,latitude,longitude,accuracy_m,sampled_at,received_at,destination_latitude,destination_longitude,destination_label,destination_source,confirmed_by,confirmed_at)
 select id,7,false,null,now(),'tracking-v1',14.60,-61.06,10,case when right(id::text,12)::integer<=1010 then now()-interval '61 seconds' else now() end,now(),14.61,-61.05,'Point confirme QA','manual','92000000-0000-4000-8000-000000000001',now() from public.interventions;`);
 const business=await db.query('select intervention_id,control_version,shared,session_id,consent_at,consent_policy,destination_latitude,destination_longitude,destination_label,destination_source,confirmed_by,confirmed_at from public.intervention_tracking order by intervention_id');
 await db.exec('set role service_role');assert.equal((await db.query('select public.purge_expired_tracking_points() n')).rows[0].n,1000);await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from public.intervention_tracking where latitude is not null')).rows[0].n,3);
 await db.exec('set role service_role');assert.equal((await db.query('select public.purge_expired_tracking_points() n')).rows[0].n,1);assert.equal((await db.query('select public.purge_expired_tracking_points() n')).rows[0].n,0);await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from public.intervention_tracking where latitude is not null')).rows[0].n,2);
 assert.deepEqual((await db.query('select intervention_id,control_version,shared,session_id,consent_at,consent_policy,destination_latitude,destination_longitude,destination_label,destination_source,confirmed_by,confirmed_at from public.intervention_tracking order by intervention_id')).rows,business.rows);
 assert.equal((await db.query("select count(*)::int n from public.intervention_tracking where latitude is null and (longitude is not null or accuracy_m is not null or sampled_at is not null or received_at is not null)")).rows[0].n,0);
 console.log('PASS service-only bounded purge: 1000 then1 then0; 2 fresh points survive; only five GPS fields cleared, business/destination/consent unchanged. SKIP LOCKED concurrency NOT proved by single connection.');
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
