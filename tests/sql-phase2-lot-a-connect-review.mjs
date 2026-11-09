import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

const codes = [
  "non_connect_platform_accounts_v2_access_blocked",
  "account_creation_losses_collector_unavailable",
  "unrelated_test_failure",
];

test("E70 — real Connect POST translates only the two platform configuration errors", async () => {
  const providerCalls = [];
  const stripe = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the SDK request before replying. */ }
    const code = codes[providerCalls.length];
    providerCalls.push([request.method, request.url]);
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "invalid_request_error", code, message: "Provider fixture detail" } }));
  });
  stripe.listen(0, "127.0.0.1");
  await once(stripe, "listening");
  let db;
  try {
    db = await freshDatabase();
    let approved = false;
    let writes = 0;
    await withNext(db, async http => {
      const post = () => http("/api/payments/connect", { method: "POST" });
      assert.equal((await post()).status, 403);
      assert.equal(providerCalls.length, 0);
      approved = true;
      const results = [];
      for (const code of codes) {
        const response = await post();
        const body = await response.json();
        assert.doesNotMatch(body.error, /Provider fixture detail/);
        assert.ok(!body.error.includes(code));
        results.push([response.status, body.error]);
      }
      assert.deepEqual(providerCalls, codes.map(() => ["POST", "/v2/core/accounts"]));
      assert.equal(writes, 0);
      assert.deepEqual(results.map(([status]) => status), [503, 503, 500]);
      for (const [, message] of results.slice(0, 2)) assert.match(message, /administrateur.*Stripe Connect/i);
    }, {
      QA_STRIPE_LOOPBACK_PORT: String(stripe.address().port), STRIPE_SECRET_KEY: "sk_test_synthetic",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", STRIPE_CONNECT_COUNTRY: "FR",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
    }, {
      handle(request, _response, { send }) {
        if (!request.url?.startsWith("/rest/v1/profiles?")) return false;
        if (request.method === "GET") send(200, { role: "artisan", full_name: "Artisan test", artisan_approved: approved, stripe_account_id: null });
        else { writes++; send(500, { error: "Unexpected profile mutation" }); }
        return true;
      },
    });
  } finally {
    await db?.close();
    stripe.closeAllConnections();
    await new Promise(resolve => stripe.close(resolve));
  }
});
