import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { handlePushEnrollment, handleWebPushDispatch, pushEndpoint, webPushConfiguration } from "../lib/features/notifications/external-delivery/web-push";

const key = createECDH("prime256v1");
key.generateKeys();
const browser = createECDH("prime256v1");
browser.generateKeys();
const origin = "https://app.example.test";
const endpoint = "https://fcm.googleapis.com/fcm/send/synthetic-endpoint";
const secret = "test-dispatch-key-replace-with-random-secret";
const env = {
  NEXT_PUBLIC_APP_URL: origin,
  NOTIFICATIONS_PUSH_PROVIDER: "webpush",
  NOTIFICATION_DELIVERY_SECRET: secret,
  NOTIFICATION_VAPID_SUBJECT: "mailto:push@example.test",
  NOTIFICATION_VAPID_PUBLIC_KEY: key.getPublicKey().toString("base64url"),
  NOTIFICATION_VAPID_PRIVATE_KEY: key.getPrivateKey().toString("base64url"),
};
const keys = { p256dh: browser.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const actor = randomUUID(), session = randomUUID();
const target = { id: randomUUID(), lease_token: randomUUID(), enrollment_version: 3, endpoint, p256dh: keys.p256dh, auth_key: keys.auth };
const browserRecord = { version: 3, browser: "current", opted_in: true, dispatch_enabled: true };
const read = () => new Request(`${origin}/api/notifications/push`);
const enroll = (requestOrigin = origin, subscription = { endpoint, keys }) => new Request(read().url, {
  method: "POST", headers: { Origin: requestOrigin },
  body: JSON.stringify({ action: "register", expected_version: 2, consent: true, subscription }),
});

test("Web Push admits only browser endpoint paths on known HTTPS services", () => {
  for (const url of [endpoint, "https://updates.push.services.mozilla.com/wpush/v2/ABC-123", "https://web.push.apple.com/ABC-123"]) assert.equal(pushEndpoint(url), true);
  for (const url of [endpoint.replace("https", "http"), endpoint.replace("googleapis.com", "googleapis.com.example.test"),
    `${endpoint}?redirect=x`, `${endpoint}#other`, endpoint.replace("https://", "https://user@"),
    endpoint.replace("/fcm", ":444/fcm"), "https://fcm.googleapis.com/other/path", "https://localhost/fcm/send/test",
    "https://evilpush.apple.com/abc", "https://web.push.apple.com/../private/abc", "https://fcm.googleapis.com/fcm/send/%0a"]) assert.equal(pushEndpoint(url), false, url);
  assert.ok(webPushConfiguration(env));
  assert.equal(webPushConfiguration({ ...env, NOTIFICATION_VAPID_PUBLIC_KEY: keys.p256dh }), null);
  assert.equal(webPushConfiguration({ ...env, NEXT_PUBLIC_APP_URL: `${origin}/private` }), null);
});

test("browser registration uses the verified identity and exposes only the public key and state", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps = { env, authenticate: async () => ({ actor, session }), admin: () => ({
    async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data: browserRecord, error: null }; },
  }) };
  const response = await handlePushEnrollment(enroll(), deps);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  assert.deepEqual(await response.json(), { available: true, public_key: env.NOTIFICATION_VAPID_PUBLIC_KEY,
    enrollment: { version: 3, browser: "current", opted_in: true } });
  assert.equal(calls[0].args.p_actor, actor);
  assert.equal(calls[0].args.p_session, session);
  assert.equal(calls[0].args.p_expected, 2);
  assert.equal(calls[0].args.p_endpoint, endpoint);
  assert.equal((await handlePushEnrollment(enroll("https://other.example.test"), deps)).status, 403);
  assert.equal((await handlePushEnrollment(enroll(origin, { endpoint: "https://localhost", keys }), deps)).status, 422);
  assert.equal(calls.length, 1);
  assert.deepEqual(await (await handlePushEnrollment(read(), { ...deps, env: {} })).json(), { available: false, public_key: null, enrollment: null });
  assert.equal((await handlePushEnrollment(read(), { ...deps, authenticate: async () => { throw { status: 401 }; } })).status, 401);
});

function worker(outcome: number | "lost", candidate = target, saved = true) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const outbound: { url: string; init?: RequestInit }[] = [];
  let leases = 0;
  const request = (authorization = `Bearer ${secret}`, query = "") => new Request(`${origin}/api/internal/notifications/push${query}`, { method: "POST", headers: { Authorization: authorization } });
  const run = (r = request()) => handleWebPushDispatch(r, env, () => ({ async rpc(name, args) {
    calls.push({ name, args });
    return { data: name === "claim_web_push" ? leases++ === 0 ? candidate : null : saved, error: null };
  } }), async (url, init) => {
    outbound.push({ url: String(url), init });
    if (outcome === "lost") throw Error("transport error");
    return new Response(null, { status: outcome });
  });
  return { request, run, calls, outbound };
}

test("the Web Push worker sends a VAPID-signed encrypted notice once and returns counts", async () => {
  const f = worker(201);
  assert.equal((await f.run(f.request("Bearer invalid"))).status, 403);
  assert.equal((await f.run(f.request(undefined, "?recipient=foreign"))).status, 422);
  assert.equal(f.calls.length, 0);
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, accepted: 1, failed: 0, uncertain: 0, skipped: 0 });
  assert.equal(f.outbound.length, 1);
  const sent = f.outbound[0];
  const sentHeaders = new Headers(sent.init?.headers);
  assert.equal(sent.url, endpoint);
  assert.equal(sent.init?.redirect, "error");
  assert.equal(sentHeaders.get("ttl"), "60");
  assert.equal(sentHeaders.get("content-encoding"), "aes128gcm");
  assert.match(sentHeaders.get("authorization")!, /^vapid t=.+, k=/i);
  assert.ok(sent.init?.body instanceof Uint8Array);
  assert.equal(Buffer.from(sent.init!.body as Uint8Array).includes("private-notice-v1"), false);
  assert.deepEqual(f.calls[1].args, { p_id: target.id, p_lease: target.lease_token, p_outcome: "accepted", p_enrollment_version: 3 });
});

test("uncertain or expired Web Push stays bound to one lease, and unsafe stored URLs never send", async () => {
  for (const [reply, expected] of [["lost", "uncertain"], [500, "uncertain"], [410, "expired"], [429, "failed"]] as const) {
    const f = worker(reply);
    assert.equal((await f.run()).status, 200);
    assert.equal(f.outbound.length, 1);
    assert.equal(f.calls[1].args.p_outcome, expected);
  }
  const invalid = worker(201, { ...target, endpoint: "https://169.254.169.254/latest" });
  assert.equal((await invalid.run()).status, 200);
  assert.equal(invalid.outbound.length, 0);
  assert.equal(invalid.calls[1].args.p_outcome, "failed");
  assert.equal((await worker(201, target, false).run()).status, 503);
});
