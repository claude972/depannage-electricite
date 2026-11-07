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
  const ids = Object.fromEntries(
    [
      "owner",
      "otherOwner",
      "coord",
      "tech",
      "otherTech",
      "foreign",
      "unverified",
    ].map((n) => [n, crypto.randomUUID()]),
  );
  for (const [n, id] of Object.entries(ids)) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,$4)",
      [
        id,
        JSON.stringify({
          role: n.includes("Owner") || n === "owner" ? "artisan" : "client",
          full_name: "QA " + n,
        }),
        n.toLowerCase() + "@example.invalid",
        n === "unverified" ? null : "2026-01-01T00:00:00Z",
      ],
    );
    if (n.includes("Owner") || n === "owner") {
      await db.query(
        "update public.profiles set artisan_approved=true where id=$1",
        [id],
      );
      await db.query(
        "insert into public.artisan_profiles(user_id,application_status)values($1,'approved')",
        [id],
      );
    }
  }
  async function as(actor, sql, args = []) {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[actor] ?? "",
    ]);
    try {
      return (await db.query(sql, args)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  const team = crypto.randomUUID(),
    teamB = crypto.randomUUID();
  const write = (actor, t, action, values, key = crypto.randomUUID()) =>
    as(actor, "select public.write_provider_team($1,$2,$3,$4)v", [
      t,
      key,
      action,
      values,
    ]);
  const list = (actor, t = team, section = "members", after = null) =>
    as(actor, "select public.provider_team_page($1,$2,$3)v", [
      t,
      section,
      after,
    ]);
  const detail = (actor, j, t = team) =>
    as(actor, "select public.provider_team_mission($1,$2)v", [t, j]);
  const key = crypto.randomUUID();
  let r = await write("owner", team, "create", { name: "Équipe QA" }, key);
  ok(r.team_version === 1, "approved artisan creates independent team");
  ok(
    (await write("owner", team, "create", { name: "Équipe QA" }, key)).replayed,
    "create replay",
  );
  await denied(
    () => write("owner", team, "create", { name: "Different" }, key),
    "P0001",
  );
  await denied(
    () => write("tech", crypto.randomUUID(), "create", { name: "Bad" }),
    "42501",
  );
  await write("otherOwner", teamB, "create", { name: "Équipe étrangère QA" });
  let version = 1;
  async function invite(actor, role, t = team, owner = "owner") {
    const id = crypto.randomUUID();
    const v = t === team ? version : 1;
    await write(owner, t, "invite", {
      invitation_id: id,
      email: actor.toLowerCase() + "@example.invalid",
      role,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      expected_version: v,
    });
    if (t === team) version++;
    return id;
  }
  async function accept(actor, invitation, t = team) {
    const r = await write(actor, t, "accept_invitation", {
      invitation_id: invitation,
    });
    if (t === team) version++;
    return r;
  }
  const techInvite = await invite("tech", "technician");
  await denied(() => accept("foreign", techInvite), "P0002");
  const inviteList = await as(
    "tech",
    "select public.provider_team_invitation_page()v",
  );
  ok(
    inviteList.records.length === 1 && inviteList.records[0].team_id === team,
    "verified email invitation inbox",
  );
  ok(
    (await as("foreign", "select public.provider_team_invitation_page()v"))
      .records.length === 0,
    "foreign inbox empty",
  );
  await denied(
    () => as("unverified", "select public.provider_team_invitation_page()v"),
    "42501",
  );
  await accept("tech", techInvite);
  const coordInvite = await invite("coord", "coordinator");
  await accept("coord", coordInvite);
  const otherInvite = await invite("otherTech", "technician");
  await accept("otherTech", otherInvite);
  ok(
    (await db.query("select role from public.profiles where id=$1", [ids.tech]))
      .rows[0].role === "client",
    "technician not promoted to global artisan",
  );
  ok(
    (await list("tech")).records.length === 1,
    "technician roster only own membership",
  );
  ok(
    (await list("coord")).records.length === 4,
    "coordinator sees team roster",
  );
  await denied(() => list("coord", team, "invitations"), "42501");
  await denied(() => list("foreign"), "P0002");
  async function job(owner = ids.owner, status = "assigned") {
    return (
      await db.query(
        "insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status)values($1,$2,'panel','Private QA operational description','Private QA address','97200','QA','scheduled',100,200,$3)returning id",
        [ids.foreign, owner, status],
      )
    ).rows[0].id;
  }
  const j = await job(),
    pending = await job(ids.owner, "requested"),
    foreignJob = await job(ids.otherOwner);
  await denied(() => detail("tech", j), "P0002");
  await denied(() => detail("coord", pending), "P0002");
  await denied(() => detail("coord", foreignJob), "P0002");
  const assignmentKey = crypto.randomUUID();
  r = await write(
    "coord",
    team,
    "assign",
    { intervention_id: j, technician_id: ids.tech, expected_version: null },
    assignmentKey,
  );
  ok(r.entity_version === 1, "coordinator dispatches internally");
  ok(
    (
      await write(
        "coord",
        team,
        "assign",
        { intervention_id: j, technician_id: ids.tech, expected_version: null },
        assignmentKey,
      )
    ).replayed,
    "assignment retry",
  );
  const d = await detail("tech", j);
  ok(
    d.intervention.address === "Private QA address" &&
      d.intervention.client_id === undefined &&
      d.intervention.estimate_max_cents === undefined &&
      d.permissions.can_assign === false,
    "limited operational projection after attribution only",
  );
  ok(
    (await as(
      "tech",
      "select count(*)::int v from public.interventions where id=$1",
      [j],
    )) === 0,
    "global dossier RLS not widened",
  );
  await denied(
    () => as("tech", "select public.intervention_action($1,'start')v", [j]),
    "42501",
  );
  await denied(
    () =>
      write("tech", team, "assign", {
        intervention_id: j,
        technician_id: ids.otherTech,
        expected_version: 1,
      }),
    "42501",
  );
  await denied(
    () =>
      write("coord", team, "assign", {
        intervention_id: pending,
        technician_id: ids.tech,
        expected_version: null,
      }),
    "42501",
  );
  await denied(
    () =>
      write("coord", team, "assign", {
        intervention_id: foreignJob,
        technician_id: ids.tech,
        expected_version: null,
      }),
    "42501",
  );
  await denied(
    () =>
      write("coord", team, "assign", {
        intervention_id: j,
        technician_id: ids.foreign,
        expected_version: 1,
      }),
    "42501",
  );
  const ackKey = crypto.randomUUID();
  await write(
    "tech",
    team,
    "progress",
    {
      intervention_id: j,
      expected_version: 1,
      state: "acknowledged",
      note: "Prise en charge interne QA",
    },
    ackKey,
  );
  ok(
    (
      await write(
        "tech",
        team,
        "progress",
        {
          intervention_id: j,
          expected_version: 1,
          state: "acknowledged",
          note: "Prise en charge interne QA",
        },
        ackKey,
      )
    ).replayed,
    "progress receipt",
  );
  await denied(
    () =>
      write("tech", team, "progress", {
        intervention_id: j,
        expected_version: 2,
        state: "done",
        note: "",
      }),
    "22023",
  );
  await db.query(
    "update public.interventions set status='in_progress'where id=$1",
    [j],
  );
  await write("tech", team, "progress", {
    intervention_id: j,
    expected_version: 2,
    state: "done",
    note: "Tâche interne QA terminée",
  });
  ok(
    (
      await db.query(
        "select status,artisan_id from public.interventions where id=$1",
        [j],
      )
    ).rows[0].status === "in_progress",
    "internal completion never completes commercial intervention",
  );
  await write("coord", team, "assign", {
    intervention_id: j,
    technician_id: ids.otherTech,
    expected_version: 3,
  });
  await denied(() => detail("tech", j), "P0002");
  await denied(
    () =>
      write(
        "tech",
        team,
        "progress",
        {
          intervention_id: j,
          expected_version: 1,
          state: "acknowledged",
          note: "Prise en charge interne QA",
        },
        ackKey,
      ),
    "42501",
  );
  await write("owner", team, "remove_member", {
    user_id: ids.otherTech,
    expected_version: version,
  });
  version++;
  await denied(() => list("otherTech"), "P0002");
  ok(
    (await detail("coord", j)).assignment.state === "unassigned",
    "removal clears current assignment",
  );
  await denied(
    () =>
      write("owner", team, "remove_member", {
        user_id: ids.owner,
        expected_version: version,
      }),
    "22023",
  );
  // Attribution to a different artisan immediately revokes team operational access.
  await db.query("update public.interventions set artisan_id=$1 where id=$2", [
    ids.otherOwner,
    j,
  ]);
  await denied(() => detail("coord", j), "P0002");
  await denied(
    () =>
      write(
        "coord",
        team,
        "assign",
        {
          intervention_id: j,
          technician_id: ids.otherTech,
          expected_version: null,
        },
        assignmentKey,
      ),
    "P0001",
  );
  // Existing replay checks scope after receipt identity, so test the unchanged command too.
  await denied(
    () =>
      write(
        "coord",
        team,
        "assign",
        { intervention_id: j, technician_id: ids.tech, expected_version: null },
        assignmentKey,
      ),
    "42501",
  );
  for (const table of [
    "provider_teams",
    "provider_team_members",
    "provider_team_invitations",
    "provider_team_assignments",
    "provider_team_commands",
    "provider_team_assignment_events",
  ])
    await denied(
      () => as("tech", "select count(*)v from public." + table),
      "42501",
    );
  ok(
    (
      await db.query(
        "select count(*)::int n from public.provider_team_assignment_events where intervention_id=$1",
        [j],
      )
    ).rows[0].n === 5,
    "one immutable event per internal assignment change",
  );

  // Membership changes and suspension invalidate fresh commands and reads.
  await write("owner", team, "set_role", {
    user_id: ids.coord,
    role: "technician",
    expected_version: version,
  });
  version++;
  await denied(
    () =>
      write("coord", team, "assign", {
        intervention_id: foreignJob,
        technician_id: ids.tech,
        expected_version: null,
      }),
    "42501",
  );
  await db.query(
    "update public.profiles set artisan_approved=false where id=$1",
    [ids.owner],
  );
  await denied(() => list("owner", team, "missions"), "42501");
  await denied(
    () =>
      write("owner", team, "rename", {
        name: "Inactive",
        expected_version: version,
      }),
    "42501",
  );
  await db.query(
    "update public.profiles set artisan_approved=true where id=$1",
    [ids.owner],
  );
  const declined = await invite("foreign", "technician");
  await write("foreign", team, "decline_invitation", {
    invitation_id: declined,
  });
  version++;
  await denied(() => accept("foreign", declined), "P0001");
  const revoked = await invite("foreign", "technician");
  await write("owner", team, "revoke_invitation", {
    invitation_id: revoked,
    expected_version: version,
  });
  version++;
  await denied(() => accept("foreign", revoked), "P0001");
  const expired = await invite("foreign", "technician");
  await db.query(
    "update public.provider_team_invitations set expires_at=now()-interval '1 second'where id=$1",
    [expired],
  );
  await denied(() => accept("foreign", expired), "P0001");
  const rejoin = await invite("otherTech", "technician");
  const joinKey = crypto.randomUUID();
  await write(
    "otherTech",
    team,
    "accept_invitation",
    { invitation_id: rejoin },
    joinKey,
  );
  version++;
  ok(
    (
      await write(
        "otherTech",
        team,
        "accept_invitation",
        { invitation_id: rejoin },
        joinKey,
      )
    ).replayed,
    "accept replay",
  );
  await write("owner", team, "remove_member", {
    user_id: ids.otherTech,
    expected_version: version,
  });
  version++;
  await denied(
    () =>
      write(
        "otherTech",
        team,
        "accept_invitation",
        { invitation_id: rejoin },
        joinKey,
      ),
    "42501",
  );
  // A previously sent invitation must not undo an explicit member removal.
  const currentEmail = (await db.query("select email from auth.users where id=$1", [ids.coord])).rows[0].email;
  await denied(() => write("owner", team, "invite", {
    invitation_id: crypto.randomUUID(), email: currentEmail, role: "technician",
    expires_at: new Date(Date.now() + 86400000).toISOString(), expected_version: version,
  }), "P0001");
  const stale = crypto.randomUUID();
  await db.query(
    "insert into public.provider_team_invitations(id,team_id,email,role,expires_at) values($1,$2,$3,'technician',now()+interval '1 day')",
    [stale, team, currentEmail],
  );
  await write("owner", team, "remove_member", { user_id: ids.coord, expected_version: version });
  version++;
  ok((await db.query("select status from public.provider_team_invitations where id=$1", [stale])).rows[0].status === "revoked",
    "an outstanding invitation to the removed member is revoked");
  await denied(() => accept("coord", stale), "P0001");
  const staleAlias = crypto.randomUUID();
  await db.query(
    "insert into public.provider_team_invitations(id,team_id,email,role,expires_at,created_at) values($1,$2,$3,'technician',now()+interval '1 day',now()-interval '1 day')",
    [staleAlias, team, "changed-coord@example.invalid"],
  );
  await db.query("update auth.users set email=$1 where id=$2", ["changed-coord@example.invalid", ids.coord]);
  await denied(() => accept("coord", staleAlias), "P0001");
  ok(!(await as("coord","select public.provider_team_invitation_page()v")).records.some(row=>row.id===staleAlias),
    "an invitation preceding removal is absent from the invitee's queue");
  await write("owner", team, "revoke_invitation", { invitation_id: staleAlias, expected_version: version });
  version++;
  const freshInvitation = await write("owner", team, "invite", {
    invitation_id: crypto.randomUUID(), email: "changed-coord@example.invalid", role: "technician",
    expires_at: new Date(Date.now() + 86400000).toISOString(), expected_version: version,
  });
  version++;
  await accept("coord", freshInvitation.entity_id);
  version++;
  ok((await list("coord")).team.role === "technician", "fresh invitation after removal can be accepted");
  // New owning team can dispatch without learning a previous team's internal revision.
  const bInvite = await invite("otherTech", "technician", teamB, "otherOwner");
  await accept("otherTech", bInvite, teamB);
  r = await write("otherOwner", teamB, "assign", {
    intervention_id: j,
    technician_id: ids.otherTech,
    expected_version: null,
  });
  ok(r.entity_version === 6, "new team takes over internal assignment");
  ok(
    (await detail("otherTech", j, teamB)).assignment.note === "",
    "old team notes not leaked",
  );
  // Bounded keyset page over real SQL rows.
  for (let i = 0; i < 53; i++) await job();
  const first = await list("owner", team, "missions");
  ok(
    first.records.length === 50 && first.next_after === first.records[49].id,
    "50-row bounded first page",
  );
  const second = await list("owner", team, "missions", first.next_after);
  ok(
    second.records.length === 3 &&
      second.next_after === null &&
      second.records.every((x) => x.id > first.next_after),
    "stable continuation without duplicates",
  );
  // Reassignment away and back never resurrects old technician access.
  await db.query("update public.interventions set artisan_id=$1 where id=$2", [ids.owner, j]);
  await denied(() => detail("otherTech", j, teamB), "P0002");
  await db.query("update public.interventions set artisan_id=$1 where id=$2", [ids.otherOwner, j]);
  await denied(() => detail("otherTech", j, teamB), "P0002");
  const returned = (await detail("otherOwner", j, teamB)).assignment;
  ok(returned.state === "unassigned" && returned.note === "" && returned.version === 7,
    "returning dossier requires a fresh assignment and does not restore previous notes");

  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    try {
      await denied(
        () => db.query("select public.provider_team_list()"),
        "42501",
      );
      await denied(
        () => db.query("select * from public.provider_teams"),
        "42501",
      );
    } finally {
      await db.exec("reset role");
    }
  }

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
