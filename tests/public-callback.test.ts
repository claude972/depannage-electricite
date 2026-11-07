import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const origin = "https://app.test";
const id = "20000000-0000-4000-8000-000000000001";
const command = { request_id: id, phone: "06 96 01 02 03", reason: "existing_request", consent: true };
const post = (path: string, body: unknown, from = origin) => new Request(origin + path, {
  method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
type Handler = (request: Request) => Promise<Response>;
function setup(data: unknown, options: { enabled?: boolean; authenticated?: boolean; code?: string } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const db = { async rpc(name: string, args: unknown) {
    calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    return { data, error: options.code ? { code: options.code } : null };
  } };
  const handlers = loadModule("lib/features/public-callback/handlers.ts", {
    "@/lib/supabase/server": { ...fakeServerHelpers({ db, authenticated: options.authenticated }), adminClient: () => db },
    "node:process": { env: { PUBLIC_CALLBACK_INTAKE_ENABLED: options.enabled ? "true" : "false" } },
  });
  return {
    calls, availability: handlers.getPublicCallback as () => Response, submit: handlers.postPublicCallback as Handler,
    queue: handlers.getSupportCallbacks as Handler, close: handlers.postSupportCallback as Handler,
  };
}

test("public callback intake gates, requires consent, normalizes locally and returns only a confirmed receipt", async () => {
  const path = "/api/public/callback";
  const closed = setup(true);
  assert.deepEqual(await closed.availability().json(), { available: false });
  assert.equal((await closed.submit(post(path, command))).status, 503);
  assert.equal(closed.calls.length, 0);
  const service = setup(true, { enabled: true, authenticated: false });
  assert.deepEqual(await service.availability().json(), { available: true });
  for (const body of [{ ...command, consent: false }, { ...command, phone: "invalid" }, { ...command, name: "Unexpected" }]) {
    assert.equal((await service.submit(post(path, body))).status, 422);
  }
  assert.equal((await service.submit(post(path, command, "https://other.test"))).status, 403);
  assert.equal(service.calls.length, 0);
  const response = await service.submit(post(path, command));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(service.calls, [{ name: "submit_public_callback", args: {
    p_request_id: id, p_phone: "+596696010203", p_reason: "existing_request", p_consent: true,
  } }]);
  for (const [phone, normalized] of [["05 96 01 02 03", "+596596010203"], ["05 97 01 02 03", "+596597010203"]]) {
    const landline = setup(true, { enabled: true });
    assert.equal((await landline.submit(post(path, { ...command, phone }))).status, 200);
    assert.equal((landline.calls[0].args as { p_phone: string }).p_phone, normalized);
  }
  const throttled = await setup(null, { enabled: true, code: "53300" }).submit(post(path, command));
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("retry-after"), "60");
  assert.equal((await setup(null, { enabled: true, code: "P0001" }).submit(post(path, command))).status, 409);
  assert.equal((await setup({ received: true }, { enabled: true }).submit(post(path, command))).status, 503);
});

test("support callback queue and closure preserve auth, scope, projection and optimistic version", async () => {
  const path = "/api/support/callbacks";
  const row = { id, phone: "+596696010203", reason: "new_request", version: 1, created_at: "2026-11-07T10:00:00Z", closed_at: null };
  const snapshot = { total: 1, items: [row], can_close: false };
  const queue = setup(snapshot);
  const response = await queue.queue(new Request(origin + path));
  assert.deepEqual(await response.json(), { ...snapshot, page: { number: 1, limit: 25, pages: 1 } });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await queue.queue(new Request(origin + path + "?status=closed"))).status, 503);
  assert.equal((await queue.queue(new Request(origin + path + "?page=1&page=2"))).status, 422);
  assert.equal((await setup({ ...snapshot, items: [{ ...row, request_id: id }] }).queue(new Request(origin + path))).status, 503);
  assert.equal((await setup(null, { authenticated: false }).queue(new Request(origin + path))).status, 401);
  assert.equal((await setup(null, { code: "42501" }).queue(new Request(origin + path))).status, 403);
  const close = setup(true);
  assert.equal((await close.close(post(path, { id, expected_version: 2 }))).status, 422);
  assert.deepEqual(await (await close.close(post(path, { id, expected_version: 1 }))).json(), { closed: true });
  assert.deepEqual(close.calls, [{ name: "close_support_callback", args: { p_id: id, p_expected_version: 1 } }]);
  assert.equal((await setup(null, { code: "P0001" }).close(post(path, { id, expected_version: 1 }))).status, 409);
});
