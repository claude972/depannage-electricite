import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, fakeServerHelpers, loadModule } from "./documents/harness";

function load(options: { authenticated?: boolean; configured?: boolean; fee?: number }) {
  const handlers = loadModule("app/api/payments/checkout/route.ts", {
    "node:process": { env: {} },
    "@/lib/supabase/server": { ...fakeServerHelpers({ db: {}, authenticated: options.authenticated }), adminClient: () => ({}) },
    "@/lib/supabase/stripe": {
      stripeClient: () => { if (options.configured === false) throw new ApiError(503, "Configuration requise"); return {}; },
      appUrl: () => "https://app.test",
      commissionBps: () => options.fee ?? 1000,
    },
  });
  return () => (handlers.GET as (request: Request) => Promise<Response>)(new Request("https://app.test/api/payments/checkout"));
}

test("checkout availability: configuration only, session required, never cached", async () => {
  const ok = await load({})();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await ok.json(), { available: true });
  assert.deepEqual(await (await load({ configured: false })()).json(), { available: false });
  assert.deepEqual(await (await load({ fee: 10000 })()).json(), { available: false });
  assert.equal((await load({ authenticated: false })()).status, 401);
});
