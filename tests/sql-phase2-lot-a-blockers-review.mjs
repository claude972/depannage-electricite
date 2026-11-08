import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrations = new URL("../supabase/migrations/", import.meta.url);
const migrationNames = (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort();

async function freshDatabase() {
  const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create role authenticator;
      create schema auth;
      create table auth.users (
        id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
        email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz,
        is_anonymous boolean default false
      );
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
    `);
    for (const name of migrationNames) {
      const sql = await isolatedMigrationSql(db, name, await readFile(new URL(name, migrations), "utf8"));
      await db.exec(sql.replace("create extension if not exists pgcrypto;", "-- PGlite provides gen_random_uuid"));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

const actor = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "operator@example.test" };
const assignee = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "assignee@example.test" };
const requester = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "requester@example.test" };

async function asUser(db, user, query, args = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]);
    return (await tx.query(query, args)).rows[0]?.v;
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const rpcNames = new Set(["mutate_support_triage", "read_warranty_policy_editor", "write_warranty_policy"]);
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${encode({ alg: "HS256" })}.${encode({ sub: actor.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;
const cookie = "sb-127-auth-token=base64-" + encode({
  access_token: accessToken, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600, token_type: "bearer", user: actor,
});

async function withNext(db, check) {
  const rejectedSql = [];
  const gateway = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    try {
      if (request.headers.authorization !== "Bearer " + accessToken)
        return send(401, { error: "Invalid fixture identity" });
      if (request.method === "GET" && request.url === "/auth/v1/user")
        return send(200, actor);
      const rpc = request.url?.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
      if (request.method !== "POST" || !rpc || !rpcNames.has(rpc))
        return send(404, { error: "Unexpected fixture RPC" });
      let body = "";
      for await (const chunk of request) body += chunk;
      const args = JSON.parse(body);
      const fields = Object.keys(args);
      assert.ok(fields.every(field => /^p_[a-z_]+$/.test(field)));
      const call = fields.map((field, i) => `${field} => $${i + 1}`).join(", ");
      return send(200, await asUser(db, actor, `select public.${rpc}(${call}) v`, Object.values(args)));
    } catch (error) {
      rejectedSql.push({ code: error.code, constraint: error.constraint });
      return send(400, { code: error.code ?? "XX000", message: "Fixture SQL rejected" });
    }
  });
  const gatewayPort = await listen(gateway);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [next.stdout, next.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-5000); });
  const stopped = once(next, "exit");
  try {
    for (let i = 0; i < 150 && !logs.includes("Ready in"); i++) {
      if (next.exitCode !== null) break;
      await sleep(100);
    }
    assert.match(logs, /Ready in/, "Next.js did not start on the local loopback");
    const http = (route, options = {}) => fetch(origin + route, {
      ...options,
      headers: { cookie, "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(20_000),
    });
    await check(http, rejectedSql);
  } finally {
    if (next.exitCode === null && next.signalCode === null) next.kill("SIGTERM");
    await stopped;
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
  }
}

test("E01 — independent revision-zero assign and escalate return 200 and record one exact audit each", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, assignee, requester])
      await db.query("insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values($1, $2, now(), $3)", [
        user.id, user.email, { role: "client", full_name: "Compte de recette" },
      ]);
    const admin = { id: randomUUID() };
    await db.query("insert into auth.users(id) values($1)", [admin.id]);
    await db.query("update public.profiles set role = 'admin' where id = $1", [admin.id]);
    for (const user of [actor, assignee])
      for (const scope of ["support_read", "support_status"])
        await asUser(db, admin, "select public.platform_grant_scope($1,$2,$3) v", [user.id, scope, "Fixture triage"]);

    const commands = [];
    for (const action of [{ action: "assign", assigned_to: assignee.id }, { action: "set_escalated", escalated: true }]) {
      const created = await asUser(db, requester, "select public.create_support_ticket($1,$2,$3,null) v", [
        randomUUID(), "Triage de recette", "Signalement synthétique pour reproduction.",
      ]);
      commands.push({ ...action, ticket_id: created.ticket.id, expected_version: 0, command_id: randomUUID(), reason: "Motif de recette" });
    }

    await withNext(db, async (http, rejectedSql) => {
      const observed = [];
      for (const command of commands) {
        const response = await http("/api/support/triage", { method: "POST", body: JSON.stringify(command) });
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        observed.push({ status: response.status, body: await response.json() });
      }
      assert.deepEqual(observed.map(entry => entry.status), [200, 200], JSON.stringify({ rejectedSql, observed }));
      for (const [{ body }, command] of observed.map((entry, index) => [entry, commands[index]])) {
        assert.equal(body.triage.ticket_id, command.ticket_id);
        assert.equal(body.triage.version, 1);
        assert.equal(body.replayed, false);
        const audits = (await db.query(
          "select actor_id, action, target_kind, details from public.platform_audit where target_id=$1", [command.ticket_id],
        )).rows;
        assert.deepEqual(audits, [{ actor_id: actor.id, action: "support_triage_changed", target_kind: "support_ticket",
          details: { command_id: command.command_id, action: command.action, version: 1 } }]);
      }
    });
  } finally {
    await db.close();
  }
});

test("E28 — the first warranty policy is readable and can be saved through HTTP", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id) values($1)", [actor.id]);
    await db.query("update public.profiles set role = 'admin' where id = $1", [actor.id]);
    const route = "/api/admin/warranty-policy";
    await withNext(db, async http => {
      const initial = await http(route);
      const saved = await http(route, { method: "POST", body: JSON.stringify({
        action: "save", command_id: randomUUID(), expected_version: 0, title: "Conditions test", body: "Texte de recette.",
      }) });
      assert.deepEqual([initial.status, saved.status], [200, 200]);
      const { version, draft, published, operator_enabled } = await initial.json();
      assert.deepEqual({ version, draft, published, operator_enabled }, {
        version: 0, draft: { title: "", body: "" }, published: null, operator_enabled: false,
      });
      assert.deepEqual(await saved.json(), { version: 1, action: "save", replayed: false });
      const persisted = await asUser(db, actor, "select public.read_warranty_policy_editor() v");
      assert.equal(persisted.version, 1);
      assert.equal(persisted.draft.title, "Conditions test");
    });
  } finally {
    await db.close();
  }
});
