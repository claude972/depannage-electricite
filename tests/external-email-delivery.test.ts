import test from "node:test";
import assert from "node:assert/strict";
import { handleEmailDispatch, resendAdapter, resendConfiguration } from "../lib/features/notifications/external-delivery/resend";
import { GENERIC_MESSAGE, type RpcClient } from "../lib/features/notifications/external-delivery/worker";

const id = "11111111-1111-4111-8111-111111111111";
const lease = "22222222-2222-4222-8222-222222222222";
const recipient = "33333333-3333-4333-8333-333333333333";
const providerId = "44444444-4444-4444-8444-444444444444";
const env = {
  NOTIFICATIONS_EMAIL_PROVIDER: "resend",
  NOTIFICATION_RESEND_API_KEY: "re_test_injected_only",
  NOTIFICATION_EMAIL_FROM: "notifications@example.test",
  NOTIFICATION_DELIVERY_SECRET: "x".repeat(32),
};
const request = (secret?: string, query = "") => new Request(`https://example.test/api/internal/notifications/email${query}`, {
  method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {},
});

test("dispatch refuses missing and wrong auth, unsupported configuration and caller-controlled parameters", async () => {
  const noDb = () => { assert.fail("unauthorized request must not open the service client"); };
  const noFetch: typeof fetch = async () => { assert.fail("must not send"); };
  const secret = env.NOTIFICATION_DELIVERY_SECRET;
  for (const [req, settings, expected] of [
    [request(), env, 403],
    [request("z".repeat(32)), env, 403],
    [request(secret), { ...env, NOTIFICATIONS_EMAIL_PROVIDER: "other" }, 503],
    [request(secret, "?to=external"), env, 422],
  ] as const) {
    const response = await handleEmailDispatch(req, settings, noDb, noFetch);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("dispatch revalidates address using the lease and returns only aggregate delivery results", async () => {
  let queued = true;
  const calls: string[] = [];
  const db: RpcClient = { async rpc(name, args) {
    calls.push(name);
    if (name === "claim_external_notification") {
      const data = queued ? { id, lease_token: lease } : null;
      queued = false;
      return { data, error: null };
    }
    if (name === "begin_external_notification")
      return { data: { id, recipient_id: recipient, channel: "email", provider: "resend", idempotency_key: `notification:${id}` }, error: null };
    if (name === "authorize_external_email") {
      assert.equal(args.p_id, id);
      assert.equal(args.p_lease, lease);
      assert.match(String(args.p_payload_tag), /^[0-9a-f]{64}$/);
      return { data: "verified@example.test", error: null };
    }
    assert.equal(name, "finish_external_notification");
    assert.equal(args.p_reference, providerId);
    return { data: true, error: null };
  } };
  const fetcher: typeof fetch = async (url, init) => {
    calls.push("provider");
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("idempotency-key"), `notification:${id}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { from: env.NOTIFICATION_EMAIL_FROM, to: ["verified@example.test"], subject: GENERIC_MESSAGE.title, text: GENERIC_MESSAGE.body });
    return Response.json({ id: providerId });
  };
  const response = await handleEmailDispatch(request(env.NOTIFICATION_DELIVERY_SECRET), env, () => db, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, accepted: 1, uncertain: 0, skipped: 0, unconfirmed: 0 });
  assert.deepEqual(calls, ["claim_external_notification", "begin_external_notification", "authorize_external_email", "provider", "finish_external_notification", "claim_external_notification"]);
});

test("adapter blocks unverified destinations and distinguishes rate limits and ambiguous provider replies", async () => {
  const input = { deliveryId: id, leaseToken: lease, recipientId: recipient, idempotencyKey: `notification:${id}`, ...GENERIC_MESSAGE, signal: new AbortController().signal };
  const config = resendConfiguration(env)!;
  const noRecipient = resendAdapter({ rpc: async () => ({ data: null, error: null }) }, config, async () => assert.fail("no send after SQL refusal"));
  assert.deepEqual(await noRecipient.send(input), { outcome: "failed" });
  const db = { rpc: async () => ({ data: "verified@example.test", error: null }) };
  for (const [reply, expected] of [
    [new Response("{}", { status: 200 }), "uncertain"],
    [new Response("{}", { status: 503 }), "uncertain"],
    [new Response("{}", { status: 429, headers: { "Retry-After": "30" } }), "retryable"],
    [new Response("{}", { status: 429, headers: { "Retry-After": "120" } }), "failed"],
  ] as const) assert.equal((await resendAdapter(db, config, async () => reply).send(input)).outcome, expected);
});
