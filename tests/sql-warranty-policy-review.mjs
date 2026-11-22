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
  const ids = { owner: crypto.randomUUID(), outside: crypto.randomUUID() };
  for (const id of Object.values(ids))
    await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query("update public.profiles set role='admin' where id=$1", [
    ids.owner,
  ]);
  async function as(name, query, params = []) {
    await db.exec("set role " + (name === "anon" ? "anon" : "authenticated"));
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        ids[name] ?? "",
      ]);
      return (await db.query(query, params)).rows[0]?.v;
    } finally {
      await db.exec("reset role");
    }
  }
  let checks = 0;
  function ok(v, message) {
    assert.ok(v, message);
    checks++;
  }
  async function denied(fn, code) {
    await assert.rejects(fn, (e) => e.code === code);
    checks++;
  }
  const pub = (version = null) =>
    as("anon", "select public.read_public_warranty_terms($1)v", [version]);
  const edit = (actor = "owner") =>
    as(actor, "select public.read_warranty_policy_editor()v");
  const gate = () => as("owner", "select public.warranty_requests_enabled()v");
  const write = (
    version,
    action,
    title = null,
    body = null,
    pubVersion = null,
    key = crypto.randomUUID(),
    actor = "owner",
  ) =>
    as(actor, "select public.write_warranty_policy($1,$2,$3,$4,$5,$6)v", [
      key,
      version,
      action,
      title,
      body,
      pubVersion,
    ]);
  const request = (id, actor = "outside") =>
    as(actor, "select to_jsonb(public.request_warranty($1,$2))v", [
      id,
      "Description synthétique du problème QA",
    ]);
  ok(
    (await pub()) === null && !(await gate()),
    "no seeded conditions or activation",
  );
  ok((await edit()).version === 0, "initial version zero");
  await denied(() => edit("outside"), "42501");
  await denied(
    () =>
      write(
        0,
        "save",
        "QA",
        "Texte synthétique QA",
        null,
        crypto.randomUUID(),
        "outside",
      ),
    "42501",
  );
  await denied(() => write(0, "enable", null, null, 1), "P0001");
  await denied(() => write(0, "publish"), "22023");
  const saveKey = crypto.randomUUID();
  await write(
    0,
    "save",
    "Conditions QA",
    "Texte uniquement synthétique pour test, sans valeur contractuelle.",
    null,
    saveKey,
  );
  ok(
    (await pub()) === null && !(await gate()),
    "draft is private and disabled",
  );
  ok(
    (
      await write(
        0,
        "save",
        "Conditions QA",
        "Texte uniquement synthétique pour test, sans valeur contractuelle.",
        null,
        saveKey,
      )
    ).replayed,
    "save replay exact",
  );
  await denied(
    () =>
      write(
        0,
        "save",
        "Changed",
        "Texte uniquement synthétique pour test, sans valeur contractuelle.",
        null,
        saveKey,
      ),
    "P0001",
  );
  await denied(() => write(0, "publish"), "P0001");
  await write(1, "publish");
  const v2 = await pub();
  ok(
    v2.version === 2 &&
      v2.actor_id === undefined &&
      v2.command_id === undefined &&
      !(await gate()),
    "publish is public but never enables intake",
  );
  await db.query(
    "update public.app_settings set value='true'where key='warranty_requests_enabled'",
  );
  ok(
    !(await gate()),
    "raw app switch cannot bypass explicit published activation",
  );
  await denied(() => write(2, "enable", null, null, 1), "P0001");
  const enableKey = crypto.randomUUID();
  await write(2, "enable", null, null, 2, enableKey);
  ok(await gate(), "explicit activation tied to publication");
  const job = (
    await db.query(
      "insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,completed_at)values($1,'outage','Synthetic QA intervention','QA fixture address','97200','QA city','urgent',100,200,'paid',now())returning id",
      [ids.outside],
    )
  ).rows[0].id;
  const first = await request(job);
  ok(first.terms_version === 2, "new case stores exact published version");
  await denied(() => request(job), "23505");
  await denied(() => request(job, "owner"), "42501");
  await write(3, "save", "Brouillon QA", "Nouveau texte QA non publié");
  ok(
    (await pub()).version === 2 && (await gate()),
    "editing draft leaves current published terms and gate intact",
  );
  await write(4, "publish");
  ok(
    (await pub()).version === 5 && !(await gate()),
    "new publication forces explicit reactivation",
  );
  ok(
    (await pub(2)).body === v2.body,
    "old published conditions remain retrievable unchanged",
  );
  ok(
    (await pub(1)) === null && (await pub(3)) === null,
    "drafts and switch commands never public",
  );
  await denied(() => request(job), "P0001");
  ok(
    (await write(2, "enable", null, null, 2, enableKey)).replayed &&
      !(await gate()),
    "old activation retry does not reactivate",
  );
  await write(5, "enable", null, null, 5);
  await write(6, "withdraw");
  ok((await pub()) === null && !(await gate()), "withdrawal closes intake");
  ok((await pub(5)).version === 5, "withdrawal preserves published history");
  const historic = (
    await db.query(
      "insert into public.warranty_cases(intervention_id,client_id,description,status)values($1,$2,'Historic QA without invented terms','resolved')returning terms_version",
      [job, ids.outside],
    )
  ).rows[0];
  ok(historic.terms_version === null, "historic cases stay unassigned");
  ok(
    (
      await as("outside", "select count(*)::int v from public.warranty_cases")
    ).valueOf() === 2,
    "existing case history remains readable with gate off",
  );
  const resolved = await as(
    "owner",
    "select to_jsonb(public.resolve_warranty($1,'declined','Décision synthétique QA documentée',(select updated_at from public.warranty_cases where id=$1)))v",
    [first.id],
  );
  ok(
    resolved.status === "declined" && resolved.terms_version === 2,
    "existing resolution and reference preserved when closed",
  );
  await write(7, "publish");
  await write(8, "enable", null, null, 8);
  const oldJob = (
    await db.query(
      "insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,completed_at)values($1,'outage','Synthetic QA old intervention','QA fixture address','97200','QA city','urgent',100,200,'paid',now()-interval '2 years')returning id",
      [ids.outside],
    )
  ).rows[0].id;
  await denied(() => request(oldJob), "42501");
  await db.query(
    "update public.interventions set status='completed'where id=$1",
    [oldJob],
  );
  await denied(() => request(oldJob), "42501");
  await write(9, "disable");
  ok(!(await gate()), "explicit disable closes intake");
  ok(
    (
      await db.query(
        "select count(*)::int n from public.audit_log where action like 'warranty_policy:%'",
      )
    ).rows[0].n === 10,
    "one audit per mutation, no replay audit",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec("set role " + role);
    await denied(
      () => db.query("select *from public.warranty_policy_versions"),
      "42501",
    );
    await db.exec("reset role");
  }
  for (const role of ["anon", "service_role"]) {
    await db.exec("set role " + role);
    await denied(
      () =>
        db.query("select public.write_warranty_policy($1,10,'disable')", [
          crypto.randomUUID(),
        ]),
      "42501",
    );
    await db.exec("reset role");
  }
  // A corrective dossier uses a normal request and cannot borrow another client's data.
  async function createJob(client, created, status = "requested") {
    return (await db.query(
      `insert into public.interventions
         (client_id,category,description,address,postal_code,city,urgency,
          estimate_min_cents,estimate_max_cents,status,created_at,completed_at)
       values($1,'socket','Synthetic corrective fixture','QA fixture address',
          '97200','QA city','scheduled',100,200,$2,$3,
          case when $2 = 'paid' then $3::timestamptz + interval '1 hour' else null end)
       returning id`,
      [ids[client], status, created],
    )).rows[0].id;
  }
  ids.correctiveClient = crypto.randomUUID();
  await db.query("insert into auth.users(id) values($1)", [ids.correctiveClient]);
  const baseJob = await createJob("correctiveClient", "2026-01-01T10:00:00Z", "paid");
  const targetJob = await createJob("correctiveClient", "2026-01-02T12:00:00Z");
  const otherJob = await createJob("owner", "2026-01-03T12:00:00Z");
  const cancelled = await createJob("correctiveClient", "2026-01-04T12:00:00Z", "cancelled");
  const nextJob = await createJob("correctiveClient", "2026-01-05T12:00:00Z");
  const { id: correctiveCase } = (await db.query(
    `insert into public.warranty_cases(intervention_id,client_id,description)
     values($1,$2,'Test de rattachement correctif') returning id`, [baseJob, ids.correctiveClient],
  )).rows[0];
  const readLink = (actor, caseId = correctiveCase) => as(actor,
    "select public.read_warranty_corrective_intervention($1)v", [caseId]);
  const linkJob = (actor, target = targetJob, caseId = correctiveCase) => as(actor,
    "select public.link_warranty_corrective_intervention($1,$2)v", [caseId, target]);
  await denied(() => readLink("anon"), "42501");
  await denied(() => readLink("correctiveClient", crypto.randomUUID()), "P0002");
  await denied(() => linkJob("correctiveClient"), "42501");
  await denied(() => linkJob("owner"), "P0001");
  await as("owner", "select public.resolve_warranty($1,'reviewing','Examen de recette',(select updated_at from public.warranty_cases where id=$1))v", [correctiveCase]);
  await denied(() => linkJob("owner", baseJob), "22023");
  await denied(() => linkJob("owner", otherJob), "22023");
  await denied(() => linkJob("owner", cancelled), "22023");
  const ownerRead = await readLink("owner");
  ok(ownerRead.link === null && !ownerRead.has_more &&
    ownerRead.candidates.map((row) => row.id).join(",") === [nextJob, targetJob].join(","),
    "candidate projection excludes original, foreign and cancelled jobs");
  ok((await readLink("correctiveClient")).candidates.length === 0, "candidate list is admin only");
  const firstLink = await linkJob("owner");
  ok(firstLink.link.id === targetJob && !firstLink.replayed, "corrective link saved");
  ok((await readLink("correctiveClient")).link.id === targetJob, "client can read the authorized corrective job");
  await as("owner", "select public.resolve_warranty($1,'resolved','Résolution de recette',(select updated_at from public.warranty_cases where id=$1))v", [correctiveCase]);
  ok((await linkJob("owner")).replayed, "lost response can replay after case resolution");
  await denied(() => linkJob("owner", nextJob), "23505");
  ok((await db.query("select count(*)::int n from public.audit_log where action='warranty_corrective_linked'")).rows[0].n === 1,
    "corrective link replay does not repeat audit");
  const newOwner = crypto.randomUUID();
  await db.query("insert into auth.users(id) values($1)", [newOwner]);
  await db.query("update public.interventions set client_id=$1 where id=$2", [newOwner, targetJob]);
  ok((await readLink("correctiveClient")).link === null, "access to both interventions is required to read the link");
  await denied(() => as("correctiveClient",
    "select linked_by v from public.warranty_corrective_interventions where case_id=$1", [correctiveCase]), "42501");

  // Keep another admin so the existing last-admin guard allows this revocation fixture.
  await db.query("update public.profiles set role='admin'where id=$1", [
    ids.outside,
  ]);
  await db.query("update public.profiles set role='client'where id=$1", [
    ids.owner,
  ]);
  await denied(() => write(2, "enable", null, null, 2, enableKey), "42501");
  await denied(
    () => write(2, "enable", null, null, 2, enableKey, "outside"),
    "P0001",
  );
  await denied(
    () =>
      write(
        10,
        "save",
        "QA",
        "x".repeat(20001),
        null,
        crypto.randomUUID(),
        "outside",
      ),
    "22023",
  );
  await write(10, "save", "QA", "\n", null, crypto.randomUUID(), "outside");
  await denied(
    () =>
      write(11, "publish", null, null, null, crypto.randomUUID(), "outside"),
    "22023",
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
