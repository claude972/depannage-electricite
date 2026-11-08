import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrations = new URL("../supabase/migrations/", import.meta.url);
const migrationNames = (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort();

export async function freshDatabase() {
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

export const actor = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "operator@example.test" };
export const assignee = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "assignee@example.test" };
export const requester = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "requester@example.test" };

export async function asUser(db, user, query, args = []) {
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
const deliveryRpcs = new Set([
  "claim_external_notification", "begin_external_notification", "finish_external_notification",
  "authorize_external_email", "claim_web_push", "finish_web_push",
]);
export const serviceKey = "synthetic-service-role";
export const dispatchSecret = randomBytes(32).toString("base64url");
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function fakeSession(user) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: expires })}.synthetic`;
  const cookie = "sb-127-auth-token=base64-" + encode({
    access_token: token, refresh_token: "synthetic-refresh", expires_at: expires,
    expires_in: 3600, token_type: "bearer", user,
  });
  return { token, cookie, user };
}

export async function withNext(db, check, extraEnv = {}, { users = [actor], rpcAllowlist = rpcNames, handle } = {}) {
  const sessions = new Map(users.map(user => [user.id, fakeSession(user)]));
  const byAuthorization = new Map([...sessions.values()].map(session => ["Bearer " + session.token, session.user]));
  const rejectedSql = [];
  const gateway = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    try {
      const signedIn = byAuthorization.get(request.headers.authorization);
      const isService = request.headers.authorization === "Bearer " + serviceKey;
      if (!signedIn && !isService) return send(401, { error: "Invalid fixture identity" });
      if (signedIn && request.method === "GET" && request.url === "/auth/v1/user")
        return send(200, signedIn);
      if (handle && await handle(request, response, { user: signedIn, isService, send })) return;
      const rpc = request.url?.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
      if (request.method !== "POST" || !rpc || !(isService ? deliveryRpcs : rpcAllowlist).has(rpc))
        return send(404, { error: "Unexpected fixture RPC" });
      let body = "";
      for await (const chunk of request) body += chunk;
      const args = JSON.parse(body);
      const fields = Object.keys(args);
      assert.ok(fields.every(field => /^p_[a-z][a-z0-9_]*$/.test(field)));
      const call = fields.map((field, i) => `${field} => $${i + 1}`).join(", ");
      const sql = `select to_jsonb(public.${rpc}(${call})) v`;
      const data = isService
        ? await db.transaction(async tx => {
          await tx.exec("set local role service_role");
          return (await tx.query(sql, Object.values(args))).rows[0].v;
        })
        : await asUser(db, signedIn, sql, Object.values(args));
      return send(200, data);
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
      NODE_OPTIONS: '--require="' + fileURLToPath(new URL("./phase2-lot-a-http-fetch.cjs", import.meta.url)) + '"',
      ...extraEnv,
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
    const http = (route, options = {}, user = users[0]) => fetch(origin + route, {
      ...options,
      headers: { cookie: sessions.get(user.id).cookie, ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
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
