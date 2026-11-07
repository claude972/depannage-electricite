import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "../documents/harness";
const ID = "10000000-0000-4000-8000-000000000001",
  USER = "20000000-0000-4000-8000-000000000001",
  KEY = "30000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: ID }) };
const policy = {
  version: 1,
  enabled: true,
  threshold_cents: 1000,
  steps: [{ role: "manager" }, { user_id: USER }],
};
const state = {
  quote_id: ID,
  site_id: USER,
  required: true,
  approved_current: false,
  policy,
  workflow: null,
  permissions: { can_submit: true, can_decide: false, can_respond: false },
  events: [],
  next_after: null,
};
function fixture(
  mode: "policy" | "workflow",
  data: unknown,
  error: unknown = null,
  authenticated = true,
) {
  const calls: any[] = [];
  const r = loadModule(
    mode === "policy"
      ? "app/api/sites/[id]/approval-policy/route.ts"
      : "app/api/quotes/[id]/approval/route.ts",
    {
      "@/lib/supabase/server": fakeServerHelpers({
        authenticated,
        db: {
          rpc: async (name: string, args: unknown) => {
            calls.push({ name, args });
            return { data, error };
          },
        },
      }),
    },
  );
  return {
    calls,
    get: (query = "") =>
      (r.GET as any)(new Request("https://qa.invalid/path" + query), context),
    post: (body: unknown, origin = "https://qa.invalid") =>
      (r.POST as any)(
        new Request("https://qa.invalid/path", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify(body),
        }),
        context,
      ),
  };
}
const policyInput = {
  command_id: KEY,
  expected_version: null,
  enabled: true,
  threshold_cents: 1000,
  steps: policy.steps,
};
const command = {
  command_id: KEY,
  action: "submit",
  expected_version: null,
  note: "",
};
const receipt = {
  quote_id: ID,
  version: 1,
  state: "pending",
  current_step: 1,
  replayed: false,
};
test("policy route transmits explicit role or nominated member and stable command", async () => {
  const f = fixture("policy", { site_id: ID, version: 1, replayed: false });
  const r = await f.post(policyInput);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    {
      name: "set_advanced_approval_policy",
      args: {
        p_site_id: ID,
        p_command_id: KEY,
        p_expected_version: null,
        p_enabled: true,
        p_threshold_cents: 1000,
        p_steps: policy.steps,
      },
    },
  ]);
});
test("policy rejects implicit/both authorities, empty/oversized steps and injected totals", async () => {
  for (const steps of [
    [],
    [{ role: "admin" }],
    [{ role: "manager", user_id: USER }],
    Array(11).fill({ role: "owner" }),
  ]) {
    const f = fixture("policy", null);
    assert.equal((await f.post({ ...policyInput, steps })).status, 422);
    assert.equal(f.calls.length, 0);
  }
  assert.equal(
    (await fixture("policy", null).post({ ...policyInput, amount_cents: 1 }))
      .status,
    422,
  );
});
test("workflow real POST binds exact quote, expected revision, action and note", async () => {
  const f = fixture("workflow", receipt);
  assert.equal((await f.post(command)).status, 200);
  assert.equal(f.calls[0].args.p_quote_id, ID);
  assert.equal(f.calls[0].args.p_command_id, KEY);
});
test("information and rejection require an explicit note; client cannot choose actor or stage", async () => {
  for (const action of ["request_information", "reject", "respond"]) {
    const f = fixture("workflow", receipt);
    assert.equal((await f.post({ ...command, action, note: " " })).status, 422);
    assert.equal(f.calls.length, 0);
  }
  assert.equal(
    (await fixture("workflow", receipt).post({ ...command, actor_id: USER }))
      .status,
    422,
  );
  assert.equal(
    (await fixture("workflow", receipt).post({ ...command, current_step: 2 }))
      .status,
    422,
  );
});
test("receipt wrong scope, revision or resulting state is not success", async () => {
  for (const changed of [
    { quote_id: USER },
    { version: 2 },
    { state: "rejected" },
  ])
    assert.equal(
      (await fixture("workflow", { ...receipt, ...changed }).post(command))
        .status,
      503,
    );
});
test("status verifies capabilities, event ordering, pagination and unknown sensitive fields", async () => {
  assert.equal((await fixture("workflow", state).get()).status, 200);
  const event = {
    version: 1,
    actor_id: USER,
    action: "submit",
    note: "",
    created_at: "2026-11-07T12:00:00Z",
  };
  for (const changed of [
    { quote_id: USER },
    { private_email: "leak@example.invalid" },
    { events: [event, event] },
    { events: [event], next_after: 1 },
  ])
    assert.equal(
      (await fixture("workflow", { ...state, ...changed }).get()).status,
      503,
    );
  assert.equal(
    (await fixture("workflow", { ...state, events: [event] }).get("?after=1"))
      .status,
    503,
  );
});
test("policy GET validates site and returns null policy honestly", async () => {
  assert.equal(
    (
      await fixture("policy", {
        site_id: ID,
        policy: null,
        can_manage: true,
      }).get()
    ).status,
    200,
  );
  assert.equal(
    (await fixture("policy", { site_id: USER, policy, can_manage: true }).get())
      .status,
    503,
  );
});
test("origin, authentication, URL fields and SQL refusals are enforced", async () => {
  const f = fixture("workflow", receipt);
  assert.equal((await f.post(command, "https://evil.invalid")).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await fixture("workflow", state, null, false).get()).status,
    401,
  );
  for (const query of ["?after=-1", "?after=1&after=2", "?site=" + USER])
    assert.equal((await fixture("workflow", state).get(query)).status, 422);
  for (const [code, status] of [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 409],
    ["53300", 429],
    ["XX000", 503],
  ] as const)
    assert.equal(
      (await fixture("workflow", null, { code }).post(command)).status,
      status,
    );
});
