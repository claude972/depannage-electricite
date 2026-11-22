import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./documents/harness";

const token = "head.payload.signature";
const user = { id: "10000000-0000-4000-8000-000000000001" };
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable" };

function setup(error?: { status: number }) {
  const calls: unknown[][] = [];
  const cookie = { auth: { getUser: async () => ({ data: { user }, error: null }) } };
  const bearer = { auth: { getUser: async (...args: unknown[]) => {
    calls.push(["verify", ...args]);
    return { data: { user: error ? null : user }, error: error ?? null };
  } } };
  const exports = loadModule("lib/supabase/server.ts", {
    "next/headers": { cookies: async () => { calls.push(["cookies"]); return {}; } },
    "@supabase/ssr": { createServerClient: () => cookie },
    "@supabase/supabase-js": { createClient: (...args: unknown[]) => { calls.push(["create", ...args]); return bearer; } },
  }, env);
  return { authenticate: exports.authenticatedClient as (request?: Request) => Promise<{db: unknown; user: typeof user}>, calls, cookie, bearer };
}

const request = (authorization?: string) => new Request("https://example.test/api/workspace", {
  headers: { Cookie: "valid-ssr-cookie", ...(authorization === undefined ? {} : { Authorization: authorization }) },
});

test("mobile Bearer verifies the JWT remotely and retains that JWT for RLS", async () => {
  const s = setup();
  const result = await s.authenticate(request("Bearer " + token));
  assert.equal(result.db, s.bearer);
  assert.equal(result.user, user);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0][2], env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const options = s.calls[0][3] as { global: { headers: { Authorization: string } }; auth: { persistSession: boolean } };
  assert.equal(options.global.headers.Authorization, "Bearer " + token);
  assert.equal(options.auth.persistSession, false);
  assert.deepEqual(s.calls[1], ["verify", token]);
});

test("an explicitly malformed or rejected Bearer cannot fall back to a valid Web cookie", async () => {
  for (const malformed of ["Basic a", "Bearer abc", "Bearer a.b.c, Bearer d.e.f", ""]) {
    const s = setup();
    await assert.rejects(s.authenticate(request(malformed)), { status: 401 });
    assert.equal(s.calls.length, 0);
  }
  const rejected = setup({ status: 403 });
  await assert.rejects(rejected.authenticate(request("Bearer " + token)), { status: 401 });
  assert.equal(rejected.calls.some(([op]) => op === "cookies"), false);
});

test("an Auth outage is a retryable failure and Web SSR keeps the cookie path", async () => {
  const unavailable = setup({ status: 503 });
  await assert.rejects(unavailable.authenticate(request("Bearer " + token)), { status: 503 });
  const web = setup();
  assert.equal((await web.authenticate(request())).db, web.cookie);
  assert.deepEqual(web.calls, [["cookies"]]);
});
