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
 let checks=0;
 const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
 const q=async(sql,p=[])=> (await db.query(sql,p)).rows;
 const one=async(sql,p=[])=> (await q(sql,p))[0].v;
 const user=crypto.randomUUID(), foreign=crypto.randomUUID();
 for(const id of [user,foreign])await q("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),'{\"role\":\"client\",\"full_name\":\"Test\"}')",[id,`${id}@example.test`]);
 const notify=async(recipient=user,site=null)=>one("insert into public.notifications(recipient_id,kind,title,body,dedupe_key,site_id)values($1,'message_received','Private title','Private body',$2,$3)returning id v",[recipient,crypto.randomUUID(),site]);
 const historical=await notify();
 await q("insert into public.notification_preferences(user_id,email_enabled,push_enabled)values($1,true,true)",[user]);
 eq(await one('select count(*)::int v from notification_delivery_private.outbox'),0);
 const inactive=await notify();
 eq(await one('select count(*)::int v from notification_delivery_private.outbox'),0);
 eq(await one("select public.claim_external_notification('email','test',true)v"),null);
 await db.exec('update notification_delivery_private.control set enabled=true');
 eq(await one("select public.claim_external_notification('email','test',true)v"),null); // no disabled-period backlog
 const id=await notify();
 eq(await one('select count(*)::int v from notification_delivery_private.outbox'),2);
 await q("update public.notifications set read_at=now()where id=$1",[id]);
 eq(await one('select count(*)::int v from notification_delivery_private.outbox'),2);
 await db.exec('set role service_role');
 const claim=async(channel='email',provider='test')=>one('select public.claim_external_notification($1,$2,true)v',[channel,provider]);
 const begin=async(l)=>one('select public.begin_external_notification($1,$2)v',[l.id,l.lease_token]);
 const finish=async(l,result,ref=null)=>one('select public.finish_external_notification($1,$2,$3,$4)v',[l.id,l.lease_token,result,ref]);
 const a=await claim(); eq(!!a.id,true);eq(await claim(),null); // no overlapping lease
 eq(await one("select public.claim_external_notification('email','other',true)v"),null);
 const payload=await begin(a);eq(Object.keys(payload).sort(),['channel','id','idempotency_key','provider','recipient_id']);eq(payload.recipient_id,user);
 eq(await begin(a),null);
 eq(await finish({...a,lease_token:crypto.randomUUID()},'accepted','x'),false);
 eq(await finish(a,'uncertain'),true);
 await db.exec("reset role;update notification_delivery_private.outbox set next_attempt_at=now()-interval '1 minute';set role service_role");
 const b=await claim();eq((await begin(b)).idempotency_key,payload.idempotency_key);
 eq(await finish(b,'accepted','provider-reference'),true);eq(await finish(b,'accepted','provider-reference'),false);
 eq(await claim(),null);
 // Withdrawal between claim and begin prevents any send.
 const push=await claim('push');
 await db.exec(`reset role;update public.notification_preferences set push_enabled=false;set role service_role`);
 eq(await begin(push),null);
 eq(await one("select status v from notification_delivery_private.outbox where id=$1",[push.id]),'cancelled');
 // Scope loss after enqueue, even with enabled preferences.
 await db.exec('reset role');
 const org=crypto.randomUUID(),site=crypto.randomUUID();
 await q("insert into public.organizations(id,owner_id,name)values($1,$2,'Test')",[org,user]);
 await q("insert into public.organization_members(organization_id,user_id,role)values($1,$2,'owner')on conflict do nothing",[org,user]);
 await q("insert into public.sites(id,organization_id,name,address,type)values($1,$2,'Test','Test address','office')",[site,org]);
 const scoped=await notify(user,site);
 eq(await one('select count(*)::int v from notification_delivery_private.outbox where notification_id=$1',[scoped]),1);
 await q('delete from public.organization_members where organization_id=$1 and user_id=$2',[org,user]);
 await q('update public.organizations set owner_id=$1 where id=$2',[foreign,org]);
 await db.exec('set role service_role');eq(await claim(),{skipped:true});
 // Muted at creation creates no queue. New preference opt-in does not backfill.
 await db.exec("reset role;update public.notification_preferences set muted_kinds=array['message_received']");
 const muted=await notify();eq(await one('select count(*)::int v from notification_delivery_private.outbox where notification_id=$1',[muted]),0);
 // Membership fixture emits its own real notification; exclude it from the lease/crash scenario.
 await db.exec("update notification_delivery_private.outbox set status='cancelled' where status='pending'");
 await db.exec("update public.notification_preferences set muted_kinds='{}'");
 // Expired send leases are uncertain, retried with same provider/key, bounded to three sends.
 const crash=await notify();await db.exec('set role service_role');
 let lease=await claim();const first=await begin(lease);
 for(let attempt=2;attempt<=3;attempt++){
  await db.exec("reset role;update notification_delivery_private.outbox set lease_until=now()-interval '1 second'where status='sending';set role service_role");
  eq(await finish(lease,'accepted','too-late'),false);
  lease=await claim();eq((await begin(lease)).idempotency_key,first.idempotency_key);
 }
 await db.exec("reset role;update notification_delivery_private.outbox set lease_until=now()-interval '1 second'where status='sending';set role service_role");
 eq(await claim(),{skipped:true});eq(await claim(),null);
 eq(await one('select status v from notification_delivery_private.outbox where notification_id=$1',[crash]),'uncertain');
 eq(await one('select attempts v from notification_delivery_private.outbox where notification_id=$1',[crash]),3);
 // Fault injection: optional enqueue failure cannot roll back the in-app notification.
 await db.exec(`reset role;
 create function notification_delivery_private.test_fail()returns trigger language plpgsql as $$begin raise exception 'injected enqueue failure';end;$$;
 create trigger test_fail before insert on notification_delivery_private.outbox for each row execute function notification_delivery_private.test_fail();`);
 const failed=await notify();eq(await one('select count(*)::int v from public.notifications where id=$1',[failed]),1);
 eq(await one('select count(*)::int v from notification_delivery_private.enqueue_failures where notification_id=$1',[failed]),1);
 await db.exec('drop trigger test_fail on notification_delivery_private.outbox');
 // Real ACL refusal, including private impersonation helper.
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const sql of ["select public.claim_external_notification('email','test',true)","select *from notification_delivery_private.outbox","select notification_delivery_private.eligible(null,'email')"]){
   await assert.rejects(db.query(sql),e=>e.code==='42501');checks++;
  }
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(db.query("select public.claim_external_notification('email','test',false)"),e=>e.code==='22023');checks++;
 // Full worker + real SQL RPCs + injected adapter: uncertainty then exact-key recovery.
 await db.exec('reset role');
 await notify();
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[foreign]);
 await db.exec('set role service_role');
 const {processExternalNotifications,GENERIC_MESSAGE}=await import('../lib/features/notifications/external-delivery/worker.ts');
 const rpc={async rpc(name,args){
  const keys={claim_external_notification:['p_channel','p_provider','p_idempotent'],begin_external_notification:['p_id','p_lease'],finish_external_notification:['p_id','p_lease','p_outcome','p_reference'],authorize_external_email:['p_id','p_lease','p_payload_tag']}[name];
  assert.ok(keys);
  return {error:null,data:await one(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')})v`,keys.map(k=>args[k]))};
 }};
 const deliveries=[];
 const adapter={channel:'email',provider:'test',durableIdempotency:true,async send(input){
  deliveries.push(input);eq(input.body,GENERIC_MESSAGE.body);
  return deliveries.length===1?{outcome:'uncertain'}:{outcome:'accepted',reference:'injected-reference'};
 }};
 eq((await processExternalNotifications(rpc,adapter)).uncertain,1);
 eq(await one("select current_setting('request.jwt.claim.sub')v"),foreign);
 await db.exec("reset role;update notification_delivery_private.outbox set next_attempt_at=now()-interval '1 minute'where status='uncertain';set role service_role");
 eq((await processExternalNotifications(rpc,adapter)).accepted,1);
 eq(deliveries.length,2);eq(deliveries[0].idempotencyKey,deliveries[1].idempotencyKey);

 // Deactivation/reactivation invalidates both pending work and an already reserved lease.
 await db.exec('reset role');
 const oldPending=await notify(); const oldLeased=await notify();
 await db.exec('set role service_role');const stale=await claim();
 await db.exec('reset role;update notification_delivery_private.control set enabled=false');
 const whileOff=await notify();
 await db.exec('update notification_delivery_private.control set enabled=true;set role service_role');
 eq(await begin(stale),null);
 eq(await claim(),{skipped:true});eq(await claim(),null);
 eq(await one('select count(*)::int v from notification_delivery_private.outbox where notification_id=$1',[whileOff]),0);

 // The provider boundary binds current verified address and body, and expires before provider deduplication.
 const authorize=(l,tag='a'.repeat(64))=>one('select public.authorize_external_email($1,$2,$3)v',[l.id,l.lease_token,tag]);
 await db.exec('reset role');await notify();await db.exec('set role service_role');
 const emailLease=await claim('email','resend');
 eq(await authorize(emailLease),null); // reservation alone cannot disclose an address
 await begin(emailLease);
 eq(await authorize({...emailLease,lease_token:crypto.randomUUID()}),null);
 eq(await authorize(emailLease),`${user}@example.test`);
 eq(await authorize(emailLease,'b'.repeat(64)),null);
 eq(await finish(emailLease,'uncertain'),true);
 await db.exec("reset role;update notification_delivery_private.outbox set next_attempt_at=now()-interval '1 minute'where status='uncertain'");
 await q("update auth.users set email='changed@example.test' where id=$1",[user]);
 await db.exec('set role service_role');
 const newLease=await claim('email','resend');await begin(newLease);
 eq(await authorize(newLease),null);
 eq(await finish(newLease,'failed'),true);
 eq(await one('select status v from notification_delivery_private.outbox where id=$1',[newLease.id]),'uncertain');
 await db.exec('reset role');const oldEmail=await notify();
 await q("update notification_delivery_private.outbox set created_at=now()-interval '23 hours 1 second' where notification_id=$1",[oldEmail]);
 await db.exec('set role service_role');
 const expired=await claim('email','resend');await begin(expired);eq(await authorize(expired),null);await finish(expired,'failed');
 await db.exec('reset role');await notify();await db.exec('set role service_role');
 const disabled=await claim('email','resend');await begin(disabled);
 await db.exec('reset role;update notification_delivery_private.control set enabled=false;set role service_role');
 eq(await authorize(disabled),null);
 eq(await one('select public.external_notification_dispatch_enabled()v'),false);
 await db.exec('reset role;set role authenticated');
 await assert.rejects(authorize(disabled),e=>e.code==='42501');checks++;
 await assert.rejects(db.query('select public.external_notification_dispatch_enabled()'),e=>e.code==='42501');checks++;
 console.log(`PASS external notification outbox: ${checks} checks, full migrations, inactive gate, scoped revalidation, leases, bounded uncertain retry, enqueue isolation and ACL`);
}catch(e){console.error(e.message,e.code,e.query,e.stack?.split("\n").slice(0,4).join("\n"));process.exitCode=1;}finally{await db.close()}
