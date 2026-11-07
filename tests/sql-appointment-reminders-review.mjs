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
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
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
  const ok = (v, m) => {
    assert.ok(v, m);
    checks++;
  };
  const denied = async (fn, code) => {
    await assert.rejects(fn, (e) => e.code === code);
    checks++;
  };
  const ids = {
    client: crypto.randomUUID(),
    artisan: crypto.randomUUID(),
    outsider: crypto.randomUUID(),
    manager: crypto.randomUUID(),
  };
  for (const [name, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,raw_user_meta_data)values($1,$2)",
      [
        id,
        JSON.stringify({
          role:
            name === "artisan"
              ? "artisan"
              : name === "manager"
                ? "manager"
                : "client",
        }),
      ],
    );
  async function as(name, sql, args = []) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[name] ?? "",
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  async function job(client = ids.client, site = null) {
    return (
      await db.query(
        "insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)values($1,$2,$3,'panel','Synthetic QA request','QA fixture address','97200','QA','scheduled',100,200,'assigned')returning id",
        [client, ids.artisan, site],
      )
    ).rows[0].id;
  }
  async function slot(j) {
    return (
      await db.query(
        "insert into public.intervention_appointments(intervention_id,starts_at,ends_at,updated_by)values($1,now()+interval '2 days',now()+interval '2 days 1 hour',$2)returning *",
        [j, ids.artisan],
      )
    ).rows[0];
  }
  const future = new Date(Date.now() + 3600000).toISOString();
  const read = (actor, j) =>
    as(actor, "select public.read_appointment_reminder($1)v", [j]);
  const write = (
    actor,
    j,
    action = "schedule",
    version = null,
    appointmentVersion = 1,
    time = future,
    key = crypto.randomUUID(),
  ) =>
    as(actor, "select public.write_appointment_reminder($1,$2,$3,$4,$5,$6)v", [
      j,
      key,
      action,
      version,
      appointmentVersion,
      time,
    ]);
  async function due(id) {
    await db.query(
      "update public.appointment_reminders set remind_at=now()-interval '1 minute'where id=$1",
      [id],
    );
  }
  async function emit(limit = 100) {
    await db.exec("set role service_role");
    try {
      return (
        await db.query("select public.emit_due_appointment_reminders($1)v", [
          limit,
        ])
      ).rows[0].v;
    } finally {
      await db.exec("reset role");
    }
  }
  const j = await job();
  ok(
    (await read("client", j)).eligibility === "no_appointment",
    "no invented appointment",
  );
  await slot(j);
  await denied(() => read("outsider", j), "P0002");
  await denied(() => write("outsider", j), "P0002");
  await denied(() => read("", j), "42501");
  await denied(
    () =>
      write(
        "client",
        j,
        "schedule",
        null,
        1,
        new Date(Date.now() - 1000).toISOString(),
      ),
    "22023",
  );
  await denied(
    () =>
      write(
        "client",
        j,
        "schedule",
        null,
        1,
        new Date(Date.now() + 3 * 86400000).toISOString(),
      ),
    "22023",
  );
  await denied(() => write("client", j, "schedule", null, 2), "P0001");
  const key = crypto.randomUUID();
  let r = await write("client", j, "schedule", null, 1, future, key);
  const reminder = r.record;
  ok(
    r.record.status === "scheduled" && r.record.version === 1,
    "personal reminder persisted",
  );
  ok(
    (await write("client", j, "schedule", null, 1, future, key)).replayed,
    "exact replay",
  );
  await denied(
    () =>
      write(
        "client",
        j,
        "schedule",
        null,
        1,
        new Date(Date.now() + 7200000).toISOString(),
        key,
      ),
    "P0001",
  );
  await denied(() => write("client", j), "P0001");
  ok(
    (await read("artisan", j)).record === null,
    "artisan cannot see client reminder",
  );
  const artisanReminder = (await write("artisan", j)).record;
  await write("artisan", j, "cancel", 1, null, null);
  await due(artisanReminder.id);
  ok((await emit()).processed === 0, "cancelled reminders never emitted");
  await due(reminder.id);
  let processed = await emit();
  ok(
    processed.sent === 1 && processed.processed === 1,
    "one persistent internal notification emitted",
  );
  ok((await emit()).processed === 0, "worker replay deduplicated");
  r = await read("client", j);
  ok(
    r.record.status === "sent" &&
      r.record.version === 2 &&
      r.record.notification_id !== null,
    "real emitted state and version",
  );
  ok(
    (
      await as(
        "client",
        "select count(*)::int v from public.notifications where kind='appointment_reminder'",
      )
    ).valueOf() === 1,
    "recipient sees reminder via existing notification RLS",
  );
  ok(
    (
      await as(
        "outsider",
        "select count(*)::int v from public.notifications where kind='appointment_reminder'",
      )
    ).valueOf() === 0,
    "foreign notification hidden",
  );
  ok(
    (await write("client", j, "schedule", null, 1, future, key)).record
      .version === 1,
    "old receipt immutable after worker",
  );
  await denied(() => write("client", j, "cancel", 1, null, null), "P0001");
  // Slot changes invalidate even within a transaction sharing now().
  const j2 = await job();
  await slot(j2);
  const changed = (await write("client", j2)).record;
  await db.query(
    "update public.intervention_appointments set starts_at=starts_at+interval '1 hour',ends_at=ends_at+interval '1 hour'where intervention_id=$1",
    [j2],
  );
  ok(
    !(await read("client", j2)).scheduled_for_current_slot,
    "GET never promises changed slot reminder",
  );
  await due(changed.id);
  ok((await emit()).sent === 0, "changed slot suppressed");
  ok(
    (await read("client", j2)).record.status === "invalidated",
    "invalidation recorded",
  );
  const j3 = await job();
  await slot(j3);
  const removed = (await write("artisan", j3)).record;
  await db.query(
    "update public.interventions set artisan_id=null where id=$1",
    [j3],
  );
  await due(removed.id);
  ok((await emit()).sent === 0, "reassignment checked at emission");
  await denied(() => read("artisan", j3), "P0002");
  // Organization membership of the dossier creator must still exist at emission.
  const org = (
    await db.query(
      "insert into public.organizations(name,owner_id)values('QA reminder org',$1)returning id",
      [ids.manager],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.organization_members values($1,$2,'owner'),($1,$3,'manager')",
    [org, ids.manager, ids.client],
  );
  const site = (
    await db.query(
      "insert into public.sites(organization_id,name,type,address)values($1,'QA','office','QA address')returning id",
      [org],
    )
  ).rows[0].id;
  const j4 = await job(ids.client, site);
  await slot(j4);
  const scoped = (await write("client", j4)).record;
  await db.query(
    "delete from public.organization_members where organization_id=$1 and user_id=$2",
    [org, ids.client],
  );
  await due(scoped.id);
  ok((await emit()).sent === 0, "removed organization member suppressed");
  await denied(() => read("client", j4), "P0002");
  const j5 = await job();
  await slot(j5);
  const muted = (await write("client", j5)).record;
  await as(
    "client",
    "select public.save_notification_preferences(array['appointment_reminder'],false,false,false,0)v",
  );
  await due(muted.id);
  ok((await emit()).sent === 0, "muted notification not falsely sent");
  ok(
    (await read("client", j5)).record.status === "muted",
    "mute outcome persisted",
  );
  const j6 = await job();
  await slot(j6);
  const closed = (await write("client", j6)).record;
  await db.query(
    "update public.interventions set status='cancelled'where id=$1",
    [j6],
  );
  await due(closed.id);
  ok((await emit()).sent === 0, "closed mission suppressed");
  // Simulate a delayed worker without rewriting the slot (which would instead invalidate its version).
  await db.query(
    "insert into public.appointment_reminders(recipient_id,intervention_id,appointment_version,starts_at,ends_at,remind_at,status)values($1,$2,1,now()-interval '1 hour',now(),now()-interval '2 hours','scheduled')on conflict(recipient_id,intervention_id)do nothing",
    [ids.artisan, j5],
  );
  await db.exec(
    "alter table public.intervention_appointments disable trigger version_appointment_reminder_slot",
  );
  await db.query(
    "update public.intervention_appointments set starts_at=now()-interval '1 hour',ends_at=now()where intervention_id=$1",
    [j5],
  );
  await db.exec(
    "alter table public.intervention_appointments enable trigger version_appointment_reminder_slot",
  );
  await db.query(
    "update public.appointment_reminders r set starts_at=a.starts_at,ends_at=a.ends_at from public.intervention_appointments a where r.intervention_id=a.intervention_id and r.intervention_id=$1 and r.recipient_id=$2",
    [j5, ids.artisan],
  );
  ok((await emit()).sent === 0, "late reminder is not emitted");
  ok(
    (await read("artisan", j5)).record.status === "expired",
    "expired outcome real",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec("set role " + role);
    await denied(
      () => db.query("select *from public.appointment_reminders"),
      "42501",
    );
    await db.exec("reset role");
  }
  for (const actor of ["client", "artisan"])
    await denied(
      () => as(actor, "select public.emit_due_appointment_reminders()v"),
      "42501",
    );
  await denied(() => emit(101), "22023");
  await denied(() => emit(0), "22023");
  const batch = [];
  for (let i = 0; i < 4; i++) {
    const id = await job();
    await slot(id);
    const record = (await write("artisan", id)).record;
    batch.push(record.id);
    await due(record.id);
  }
  ok((await emit(2)).processed === 2, "bounded first batch");
  ok((await emit(2)).processed === 2, "bounded second batch");
  ok((await emit()).processed === 0, "no duplicate batch");
  const replacedJob = await job();
  await slot(replacedJob);
  const replaced = (await write("client", replacedJob)).record;
  await db.query(
    "delete from public.intervention_appointments where intervention_id=$1",
    [replacedJob],
  );
  await slot(replacedJob);
  await due(replaced.id);
  ok(
    (await emit()).sent === 0,
    "replacement slot with reset version but different instants does not reuse reminder",
  );
  await db.query(
    "insert into public.organization_members values($1,$2,'manager')",
    [org, ids.client],
  );
  const scopeJob = await job(ids.client, site);
  await slot(scopeJob);
  const scopedAgain = (await write("client", scopeJob)).record;
  await db.query(
    "insert into public.organization_member_site_scopes(organization_id,user_id,scope)values($1,$2,'selected')",
    [org, ids.client],
  );
  await due(scopedAgain.id);
  ok(
    (await emit()).sent === 0,
    "selected site scope withdrawal blocks emission despite current membership",
  );
  await denied(() => read("client", scopeJob), "P0002");
  const cron = (
    await db.query(
      "select *from cron.job where jobname='depannage_appointment_reminders_v1'",
    )
  ).rows[0];
  ok(
    cron.command === "select public.emit_due_appointment_reminders(100);" &&
      cron.schedule === "* * * * *",
    "independent dedicated scheduler metadata",
  );
  ok(
    (
      await db.query(
        "select count(*)::int n from public.appointment_reminder_commands where command_id=$1",
        [key],
      )
    ).rows[0].n === 1,
    "one receipt for exact retries",
  );
  const schedulerFile = new URL(
    "../supabase/migrations/20261107145359_appointment_reminders_schedule.sql",
    import.meta.url,
  );
  const scheduledBefore = (
    await db.query("select count(*)::int n from cron.schedule_calls")
  ).rows[0].n;
  const trackingBefore = (
    await db.query(
      "select *from cron.job where jobname='depannage_tracking_retention_v1'",
    )
  ).rows;
  await db.exec(await readFile(schedulerFile, "utf8"));
  ok(
    (await db.query("select count(*)::int n from cron.schedule_calls")).rows[0]
      .n === scheduledBefore,
    "scheduler retry does not reschedule any job",
  );
  assert.deepEqual(
    (
      await db.query(
        "select *from cron.job where jobname='depannage_tracking_retention_v1'",
      )
    ).rows,
    trackingBefore,
  );
  checks++;
  await db.query(
    "update cron.job set command='select 42;'where jobname='depannage_appointment_reminders_v1'",
  );
  const schedulerSql = await readFile(schedulerFile, "utf8");
  await denied(() => db.exec(schedulerSql), "P0001");
  await db.exec("rollback");
  ok(
    (
      await db.query(
        "select command from cron.job where jobname='depannage_appointment_reminders_v1'",
      )
    ).rows[0].command === "select 42;",
    "collision does not overwrite incompatible job",
  );
  console.log(
    JSON.stringify({
      sql: "PASS",
      checks,
      migrations: (await readdir(dir)).filter((n) => n.endsWith(".sql")).length,
      auth_storage_cron: "SIMULATED",
      concurrency: "sequential interleavings only",
    }),
  );
} catch (error) {
  console.error(error.code || "", error.message, error.query || "");
  process.exitCode = 1;
} finally {
  await db.close();
}
