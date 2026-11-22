import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "../documents/harness";
const J = "10000000-0000-4000-8000-000000000001",
  P = "20000000-0000-4000-8000-000000000001",
  K = "30000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: J }) };
const receipt = {
  intervention_id: J,
  payer_id: P,
  version: 1,
  replayed: false,
};
const state = {
  intervention_id: J,
  payer_id: P,
  version: 1,
  can_manage: true,
  can_checkout: false,
  delegate_current: true,
  external_session_pending: false,
  link: `/#detail/${J}`,
};
function fixture(data: unknown, error: unknown = null, auth = true) {
  const calls: any[] = [];
  const m = loadModule("app/api/interventions/[id]/payer/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({
      authenticated: auth,
      db: {
        rpc: async (name: string, args: unknown) => {
          calls.push({ name, args });
          return { data, error };
        },
      },
    }),
  });
  return {
    calls,
    get: (q = "") =>
      (m.GET as any)(
        new Request("https://qa.invalid/api/interventions/" + J + "/payer" + q),
        context,
      ),
    post: (
      body: unknown = { command_id: K, payer_id: P, expected_version: null },
      origin = "https://qa.invalid",
    ) =>
      (m.POST as any)(
        new Request("https://qa.invalid/api/interventions/" + J + "/payer", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify(body),
        }),
        context,
      ),
  };
}
test("payer real handler sends only stable command and scope under caller JWT", async () => {
  const f = fixture(receipt);
  const r = await f.post();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    {
      name: "set_intervention_payer",
      args: {
        p_intervention_id: J,
        p_command_id: K,
        p_payer_id: P,
        p_expected_version: null,
      },
    },
  ]);
});
test("explicit revoke and exact replay use confirmed version", async () => {
  const f = fixture({ ...receipt, payer_id: null, version: 2, replayed: true });
  assert.equal(
    (await f.post({ command_id: K, payer_id: null, expected_version: 1 }))
      .status,
    200,
  );
});
test("arbitrary actor, money, unknown fields, origin and session refused before RPC", async () => {
  for (const extra of [
    { actor_id: P },
    { amount_cents: 1 },
    { role: "owner" },
  ]) {
    const f = fixture(receipt);
    assert.equal(
      (
        await f.post({
          command_id: K,
          payer_id: P,
          expected_version: null,
          ...extra,
        })
      ).status,
      422,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(receipt);
  assert.equal((await f.post(undefined, "https://evil.invalid")).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await fixture(receipt, null, false).post()).status, 401);
});
test("wrong receipt version, scope or payer never confirms success", async () => {
  for (const changed of [
    { version: 2 },
    { payer_id: K },
    { intervention_id: P },
  ])
    assert.equal(
      (await fixture({ ...receipt, ...changed }).post()).status,
      503,
    );
});
test("status permits only safe same dossier link and projected capabilities", async () => {
  assert.equal((await fixture(state).get()).status, 200);
  for (const changed of [
    { link: "https://checkout.stripe.com/private" },
    { intervention_id: P },
    { email: "private@example.invalid" },
  ])
    assert.equal((await fixture({ ...state, ...changed }).get()).status, 503);
});
test("SQL refusal and stale command propagate without provider data", async () => {
  for (const [code, status] of [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 409],
    ["53300", 429],
    ["XX000", 503],
  ] as const) {
    const r = await fixture(null, { code }).post();
    assert.equal(r.status, status);
    assert.match(r.headers.get("Cache-Control"), /no-store/);
  }
});
test("unexpected query fails before SQL", async () => {
  const f = fixture(state);
  assert.equal((await f.get("?actor=" + P)).status, 422);
  assert.equal(f.calls.length, 0);
});
