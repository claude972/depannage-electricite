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
  let checks = 0;
  const eq = (a, b) => {
    assert.deepEqual(a, b);
    checks++;
  };
  const deny = async (p, code) => {
    await assert.rejects(p, (e) => e.code === code);
    checks++;
  };
  const ids = Object.fromEntries(
    ["owner", "viewer", "foreign", "artisan"].map((x) => [
      x,
      crypto.randomUUID(),
    ]),
  );
  for (const [n, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,now(),$3)",
      [
        id,
        n + "@example.invalid",
        JSON.stringify({
          role: n === "artisan" ? "artisan" : "client",
          full_name: "QA " + n,
        }),
      ],
    );
  const org = (
    await db.query(
      "insert into public.organizations(name,owner_id)values('QA',$1)returning id",
      [ids.owner],
    )
  ).rows[0].id;
  for (const who of ["owner", "viewer"])
    await db.query(
      "insert into public.organization_members(organization_id,user_id,role)values($1,$2,$3)",
      [org, ids[who], who],
    );
  const site = (
    await db.query(
      "insert into public.sites(organization_id,name,type,address,budget_cents)values($1,'QA','office','Fixture QA',10000)returning id",
      [org],
    )
  ).rows[0].id;
  const due = (
    await db.query(
      "select ((clock_timestamp()at time zone'America/Martinique')::date+7)::text v",
    )
  ).rows[0].v;
  const remind = new Date(Date.now() + 3600000).toISOString();
  const document = (
    await db.query(
      "insert into public.documents(owner_id,name,path,mime_type)values($1,'QA','qa/'||gen_random_uuid()::text,'application/pdf')returning id",
      [ids.artisan],
    )
  ).rows[0].id;
  const credential = (
    await db.query(
      "insert into public.artisan_credentials(user_id,document_id,kind,expires_on)values($1,$2,'liability',$3)returning id",
      [ids.artisan, document, due],
    )
  ).rows[0].id;
  async function compliance() {
    return (
      await db.query(
        "insert into public.compliance_records(site_id,title,kind,due_on,status,created_by)values($1,'QA','audit',$2,'pending',$3)returning id",
        [site, due, ids.owner],
      )
    ).rows[0].id;
  }
  async function as(who, sql, args = []) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[who] ?? "",
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  const read = (who, kind, id) =>
    as(who, "select public.read_operational_reminder($1,$2)v", [kind, id]);
  const schedule = (
    who,
    kind,
    id,
    version = null,
    source = 1,
    date = due,
    time = remind,
    key = crypto.randomUUID(),
  ) =>
    as(
      who,
      "select public.write_operational_reminder($1,$2,$3,'schedule',$4,$5,$6,$7)v",
      [kind, id, key, version, source, date, time],
    );
  const cancel = (who, kind, id, version, key = crypto.randomUUID()) =>
    as(
      who,
      "select public.write_operational_reminder($1,$2,$3,'cancel',$4,null,null,null)v",
      [kind, id, key, version],
    );
  async function worker(limit = 100) {
    await db.exec("set role service_role");
    try {
      return (
        await db.query("select public.emit_due_operational_reminders($1)v", [
          limit,
        ])
      ).rows[0].v;
    } finally {
      await db.exec("reset role");
    }
  }
  const dueNow = (id) =>
    db.query(
      "update public.operational_reminders set remind_at=clock_timestamp()-interval '1 second'where id=$1",
      [id],
    );
  await deny(read("foreign", "credential", credential), "P0002");
  await deny(schedule("owner", "credential", credential), "P0002");
  await deny(schedule("artisan", "credential", credential, null, 2), "P0001");
  await deny(
    schedule(
      "artisan",
      "credential",
      credential,
      null,
      1,
      due,
      due + "T12:00:00-04:00",
    ),
    "22023",
  );
  await deny(
    schedule(
      "artisan",
      "credential",
      credential,
      null,
      1,
      due,
      new Date(Date.now() - 60000).toISOString(),
    ),
    "22023",
  );
  const key = crypto.randomUUID();
  let r = await schedule(
    "artisan",
    "credential",
    credential,
    null,
    1,
    due,
    remind,
    key,
  );
  eq(r.record.status, "scheduled");
  eq(
    (
      await schedule(
        "artisan",
        "credential",
        credential,
        null,
        1,
        due,
        remind,
        key,
      )
    ).replayed,
    true,
  );
  await deny(
    schedule(
      "artisan",
      "credential",
      credential,
      null,
      1,
      due,
      new Date(Date.now() + 7200000).toISOString(),
      key,
    ),
    "P0001",
  );
  await deny(schedule("artisan", "credential", credential), "P0001");
  await dueNow(r.record.id);
  eq((await worker()).sent, 1);
  eq((await worker()).processed, 0);
  eq((await read("artisan", "credential", credential)).record.status, "sent");
  eq(
    (
      await db.query(
        "select count(*)::int v from public.notifications where kind='credential_reminder'",
      )
    ).rows[0].v,
    1,
  );
  // Reschedule then cancel: no emission and stable cancellation receipt.
  r = await schedule("artisan", "credential", credential, 2);
  const ck = crypto.randomUUID();
  await cancel("artisan", "credential", credential, 3, ck);
  eq((await cancel("artisan", "credential", credential, 3, ck)).replayed, true);
  await dueNow(r.record.id);
  eq((await worker()).sent, 0);
  // Source edits invalidate immediately, including same-day updates through the monotonic revision.
  await schedule("artisan", "credential", credential, 4);
  await db.query(
    "update public.artisan_credentials set kind='other'where id=$1",
    [credential],
  );
  let view = await read("artisan", "credential", credential);
  eq(view.record.status, "invalidated");
  eq(view.source.version, 2);
  eq(view.scheduled_for_current_source, false);
  await db.query(
    "update public.artisan_credentials set expires_on=null where id=$1",
    [credential],
  );
  eq((await read("artisan", "credential", credential)).eligibility, "no_date");
  await deny(schedule("artisan", "credential", credential, 6, 3), "P0001");
  const c = await compliance();
  await deny(read("foreign", "compliance", c), "P0002");
  r = await schedule("viewer", "compliance", c);
  await dueNow(r.record.id);
  eq((await worker()).sent, 1);
  eq((await read("viewer", "compliance", c)).record.status, "sent");
  eq(
    await as(
      "foreign",
      "select count(*)::int v from public.notifications where kind='compliance_reminder'",
    ),
    0,
  );
  // Preference applies to these new kinds through the existing real writer.
  await as(
    "viewer",
    "select public.save_notification_preferences($1,false,false,false,0)",
    [["compliance_reminder"]],
  );
  r = await schedule("viewer", "compliance", c, 2);
  await dueNow(r.record.id);
  eq((await worker()).sent, 0);
  eq((await read("viewer", "compliance", c)).record.status, "muted");
  r = await schedule("viewer", "compliance", c, 4);
  await db.query(
    "update public.organization_members set role='manager'where organization_id=$1 and user_id=$2",
    [org, ids.viewer],
  );
  await dueNow(r.record.id);
  eq((await worker()).sent, 0);
  eq((await read("viewer", "compliance", c)).record.status, "invalidated");
  r = await schedule("viewer", "compliance", c, 6);
  await db.query(
    "insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",
    [org, ids.viewer],
  );
  await dueNow(r.record.id);
  eq((await worker()).sent, 0);
  await deny(read("viewer", "compliance", c), "P0002");
  eq(
    await as(
      "viewer",
      "select count(*)::int v from public.notifications where kind='compliance_reminder'",
    ),
    0,
  );
  // Archive and completion suppress an owner's pending reminder too.
  const c2 = await compliance();
  r = await schedule("owner", "compliance", c2);
  await db.query("update public.sites set archived_at=now()where id=$1", [
    site,
  ]);
  await dueNow(r.record.id);
  eq((await worker()).sent, 0);
  eq((await read("owner", "compliance", c2)).eligibility, "closed");
  eq((await read("owner", "compliance", c2)).record.status, "invalidated");
  await db.query("update public.sites set archived_at=null where id=$1", [
    site,
  ]);
  r = await schedule("owner", "compliance", c2, 2);
  await db.query(
    "update public.compliance_records set status='completed'where id=$1",
    [c2],
  );
  eq((await read("owner", "compliance", c2)).record.status, "invalidated");
  // Bounded sweep and per-command dedupe across independent records.
  const c3 = await compliance(),
    c4 = await compliance();
  const r3 = await schedule("owner", "compliance", c3),
    r4 = await schedule("owner", "compliance", c4);
  await dueNow(r3.record.id);
  await dueNow(r4.record.id);
  eq((await worker(1)).processed, 1);
  eq((await worker(1)).processed, 1);
  eq((await worker()).processed, 0);
  await deny(worker(101), "22023");
  await deny(
    as("owner", "select public.emit_due_operational_reminders(1)"),
    "42501",
  );
  for (const t of ["operational_reminders", "operational_reminder_commands"])
    await deny(as("owner", "select count(*)v from public." + t), "42501");
  const cron = (
    await db.query(
      "select active,command from cron.job where jobname='depannage_operational_reminders_v1'",
    )
  ).rows;
  eq(cron.length, 1);
  eq(cron[0].active, false);
  eq(cron[0].command, "select public.emit_due_operational_reminders(100);");
  eq(
    (
      await db.query(
        "select active v from cron.job where jobname='depannage_appointment_reminders_v1'",
      )
    ).rows[0].v,
    true,
  );

  eq(
    (
      await db.query(
        "select to_jsonb(j)v from cron.job j where jobname<>'depannage_operational_reminders_v1'order by jobname",
      )
    ).rows,
    previousJobs,
  );
  const scheduleFile = (await readdir(dir)).find((x) =>
    x.endsWith("_operational_reminders_schedule.sql"),
  );
  await db.exec(await readFile(new URL(scheduleFile, dir), "utf8"));
  eq(
    (
      await db.query(
        "select count(*)::int v from cron.job where jobname='depannage_operational_reminders_v1'",
      )
    ).rows[0].v,
    1,
  );
  // Seed an honestly overdue historical reminder without waiting a calendar day.
  const overdue = await compliance();
  await db.query(
    "update public.compliance_records set due_on=current_date-2 where id=$1",
    [overdue],
  );
  await db.query(
    "insert into public.operational_reminders(recipient_id,kind,record_id,source,remind_at,status)values($1,'compliance',$2,public.operational_reminder_source($1,'compliance',$2),now()-interval '3 days','scheduled')",
    [ids.owner, overdue],
  );
  eq((await worker()).sent, 0);
  eq((await read("owner", "compliance", overdue)).record.status, "expired");
  const deleted = await compliance();
  await schedule("owner", "compliance", deleted);
  await db.query("delete from public.compliance_records where id=$1", [
    deleted,
  ]);
  eq(
    (
      await db.query(
        "select status v from public.operational_reminders where record_id=$1",
        [deleted],
      )
    ).rows[0].v,
    "invalidated",
  );
  await deny(read("owner", "compliance", deleted), "P0002");
  console.log(
    JSON.stringify({
      sql: "PASS",
      checks,
      migrations: (await readdir(dir)).filter((x) => x.endsWith(".sql")).length,
      cron: "explicit metadata stub, new job inactive",
      cloud: false,
      concurrency: "sequential interleavings",
    }),
  );
} catch (e) {
  console.error(e.code, e.message, e.query, e.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
