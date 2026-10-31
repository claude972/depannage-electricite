import { isolatedMigrationSql } from './sql-isolated-migrations.mjs';
// Isolated PostgreSQL verification, not live Supabase: Auth and Storage are explicit stubs.
// Install pinned @electric-sql/pglite@0.5.13 outside the app; PGLITE_MODULE selects its dist/index.js.
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
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
console.log('PASS: all migrations execute in isolated PostgreSQL with explicit Auth/Storage stubs');
const ids = {
  artisan1:'10000000-0000-4000-8000-000000000001',
  artisan2:'10000000-0000-4000-8000-000000000002',
  emptyArtisan:'10000000-0000-4000-8000-000000000003',
  client:'10000000-0000-4000-8000-000000000004',
  manager:'10000000-0000-4000-8000-000000000005',
  admin:'10000000-0000-4000-8000-000000000006',
};
for (const [name,id] of Object.entries(ids)) {
  const role = name.startsWith('artisan') || name==='emptyArtisan' ? 'artisan' : name==='manager' ? 'manager' : 'client';
  await db.query('insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())',[id,JSON.stringify({role,full_name:name}),`${name}@example.invalid`]);
}
await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
async function as(name,sql,params=[]) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]??'']);
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
const args=['2026-10-01T00:00:00Z','2026-11-01T00:00:00Z','2026-09-01T00:00:00Z','2026-10-01T00:00:00Z'];
const call='select public.artisan_performance($1,$2,$3,$4) result';
for (const actor of ['client','manager','admin']) await assert.rejects(()=>as(actor,call,args));
await db.exec('set role anon');
await assert.rejects(()=>db.query(call,args)); await db.exec('reset role');
await assert.rejects(()=>as('artisan1','select public.artisan_performance($1,$2,$3,$4,$5)',[...args,ids.artisan2]));
console.log('PASS: anonymous/non-artisan roles and a requested other artisan cannot read performance');
let sequence=0;
async function fixture({artisan='artisan1',paidAt='2026-10-15T12:00:00Z',completedAt=paidAt,amount=100,paymentStatus='paid',status='paid',rating=null}) {
  sequence += 1;
  const job=(await db.query(`insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,completed_at,paid_at)
  values($1,$2,'panel','Fixture performance électrique','12 rue de test','97200','Fort-de-France','scheduled',100,200,$3,$4,$5) returning id`,[ids.client,ids[artisan],status,completedAt,paymentStatus==='paid'?paidAt:null])).rows[0].id;
  const quote=(await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at)
  values($1,$2,'[{"label":"Fixture","quantity":1,"unit_price_cents":100}]', $3,0,0,$3,'accepted',now()) returning id`,[job,ids[artisan],amount])).rows[0].id;
  await db.query('insert into public.payments(quote_id,session_id,total_cents,currency,status,paid_at) values($1,$2,$3,\'eur\',$4,$5)',[quote,`cs_perf_${sequence}`,amount,paymentStatus,paymentStatus==='paid'?paidAt:null]);
  if(rating!==null) await db.query('insert into public.reviews(intervention_id,author_id,rating) values($1,$2,$3)',[job,ids.client,rating]);
  return job;
}
// 130 settled records exceed both the 100-job and 100-payment workspace windows.
for(let i=0;i<130;i++) await fixture({rating:i<2?(i===0?4:5):null});
await fixture({paidAt:'2026-09-15T12:00:00Z',amount:200});
await fixture({paidAt:'2026-10-01T00:00:00Z',amount:300}); // inclusive start
await fixture({paidAt:'2026-11-01T00:00:00Z',amount:900}); // exclusive end
await fixture({paidAt:'2026-08-31T23:59:59Z',amount:900}); // outside previous start
await fixture({paymentStatus:'pending',status:'completed',amount:800,completedAt:'2026-10-18T12:00:00Z'});
await fixture({paymentStatus:'failed',status:'completed',amount:700,completedAt:'2026-10-18T12:00:00Z'});
const otherJob=await fixture({artisan:'artisan2',amount:9999,rating:1});
let result=(await as('artisan1',call,args)).rows[0].result;
assert.equal(result.current.paid_service_cents,13300);
assert.equal(result.current.paid_count,131);
assert.equal(result.current.completed_missions_count,133); // paid plus completed unpaid jobs
assert.equal(result.previous.paid_service_cents,200);
assert.equal(result.previous.paid_count,1);
assert.equal(result.rating.average,4.5);
assert.equal(result.rating.count,2);
assert.equal(result.rating.period,'all_time');
assert.equal(result.growth_percent,6550);
assert.equal(result.punctuality_rate,null);
assert.equal(result.scope,'all_current_artisan_records');assert.equal(result.limited,false);assert.equal(result.currency,'eur');
assert.match(result.basis.revenue,/TTC/); assert.match(result.basis.revenue,/ne représente pas le net/);
console.log('PASS: global >100-record aggregates, paid-only totals, interval edges, all-time ratings and honest basis');
const other=(await as('artisan2',call,args)).rows[0].result;
assert.equal(other.current.paid_service_cents,9999);assert.equal(other.current.paid_count,1);assert.equal(other.rating.average,1);assert.equal(other.growth_percent,null);
const empty=(await as('emptyArtisan',call,args)).rows[0].result;
assert.equal(empty.current.paid_service_cents,0);assert.equal(empty.current.paid_count,0);assert.equal(empty.rating.average,null);assert.equal(empty.rating.count,0);assert.equal(empty.growth_percent,null);
console.log('PASS: each artisan sees only own figures, empty data and zero denominator never fabricate growth or ratings');
for (const invalid of [
 [null,...args.slice(1)],['infinity',...args.slice(1)],
 ['2026-10-01T00:00:00Z','2026-12-01T00:00:00Z',...args.slice(2)],
 [args[1],args[0],...args.slice(2)],
 [args[0],args[1],'2026-08-01T00:00:00Z',args[3]],
 [args[0],args[1],args[2],'2026-09-30T00:00:00Z'],
]) await assert.rejects(()=>as('artisan1',call,invalid));
const unequal=['2026-03-01T00:00:00Z','2026-04-01T00:00:00Z','2026-02-01T00:00:00Z','2026-03-01T00:00:00Z'];
assert.equal((await as('artisan1',call,unequal)).rows[0].result.current.paid_count,0);
console.log('PASS: direct RPC rejects null/nonfinite/reversed/oversized/disconnected periods and accepts unequal calendar-month lengths');
// Appointment read projection is protected by real application RLS (Storage/Auth remain stubs).
await db.query('insert into public.intervention_appointments(intervention_id,starts_at,ends_at,note,updated_by) values($1,$2,$3,$4,$5)',[otherJob,'2026-12-01T12:00:00Z','2026-12-01T13:00:00Z','Private appointment note',ids.artisan2]);
assert.equal((await as('artisan1','select * from public.intervention_appointments where intervention_id=$1',[otherJob])).rows.length,0);
assert.equal((await as('artisan2','select * from public.intervention_appointments where intervention_id=$1',[otherJob])).rows[0].note,'Private appointment note');
console.log('PASS: latest appointment details remain under dossier RLS and are not exposed to another artisan');
await db.close();
