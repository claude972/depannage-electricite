import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const r = {
  id: other,
  intervention_id: id,
  appointment_version: 2,
  starts_at: "2027-01-01T10:00:00Z",
  ends_at: "2027-01-01T11:00:00Z",
  remind_at: "2027-01-01T09:00:00Z",
  version: 1,
  status: "scheduled",
  notification_id: null,
  processed_at: null,
  updated_at: "2026-11-07T10:00:00Z",
};
const s = {
  intervention_id: id,
  appointment: { version: 2, starts_at: r.starts_at, ends_at: r.ends_at },
  record: r,
  can_schedule: true,
  eligibility: "available",
  scheduled_for_current_slot: true,
};
function harness(data: unknown = s, error: string | null = null, auth = true) {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data, error: error ? { code: error } : null };
    },
  };
  return {
    ...(loadModule("app/api/interventions/[id]/reminder/route.ts", {
      "@/lib/supabase/server": fakeServerHelpers({ db, authenticated: auth }),
    }) as any),
    calls,
  };
}
const context = { params: Promise.resolve({ id }) };
const request = (suffix = "") =>
  new Request(
    "https://app.example/api/interventions/" + id + "/reminder" + suffix,
  );
const body = {
  command_id: other,
  expected_version: null,
  action: "schedule",
  appointment_version: 2,
  remind_at: r.remind_at,
};
const post = (value: unknown = body, origin = "https://app.example") =>
  new Request("https://app.example/api/interventions/" + id + "/reminder", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
test("real GET returns caller personal state and private cache, no appointment remains explicit", async () => {
  const res = await harness().GET(request(), context);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await res.json(), s);
  const empty = await harness({
    ...s,
    appointment: null,
    record: null,
    eligibility: "no_appointment",
    can_schedule: false,
    scheduled_for_current_slot: false,
  }).GET(request(), context);
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).record, null);
});
test("real GET rejects foreign/extra fields and inconsistent applicability without fake empty success", async () => {
  for (const data of [
    { ...s, intervention_id: other },
    { ...s, record: { ...r, intervention_id: other } },
    { ...s, record: { ...r, recipient_id: other } },
    { ...s, appointment: null },
  ])
    assert.equal((await harness(data).GET(request(), context)).status, 503);
  const stale = await harness({
    ...s,
    appointment: { ...s.appointment, version: 3 },
    scheduled_for_current_slot: false,
  }).GET(request(), context);
  assert.equal(stale.status, 200);
  assert.equal((await stale.json()).scheduled_for_current_slot, false);
});
test("real POST forwards stable command/current slot version; immutable replay receipt accepted", async () => {
  for (const replayed of [false, true]) {
    const h = harness({ record: r, replayed });
    const res = await h.POST(post(), context);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), [
      "write_appointment_reminder",
      {
        p_intervention_id: id,
        p_command_id: other,
        p_action: "schedule",
        p_expected_version: null,
        p_appointment_version: 2,
        p_remind_at: r.remind_at,
      },
    ]);
  }
  const cancel = { command_id: other, expected_version: 1, action: "cancel" };
  const cancelled = {
    ...r,
    version: 2,
    status: "cancelled",
    processed_at: r.updated_at,
  };
  assert.equal(
    (
      await harness({ record: cancelled, replayed: false }).POST(
        post(cancel),
        context,
      )
    ).status,
    200,
  );
});
test("strict command never accepts recipients or unknown/duplicate query; bad projections fail", async () => {
  for (const value of [
    { ...body, recipient_id: other },
    { ...body, remind_at: "tomorrow" },
    { ...body, appointment_version: 0 },
    { action: "cancel", command_id: other, expected_version: null },
  ]) {
    const h = harness();
    assert.equal((await h.POST(post(value), context)).status, 422);
    assert.equal(h.calls.length, 0);
  }
  assert.equal((await harness().GET(request("?x=1"), context)).status, 422);
  for (const record of [
    { ...r, version: 2 },
    { ...r, appointment_version: 3 },
    { ...r, remind_at: "2027-01-01T08:00:00Z" },
  ])
    assert.equal(
      (await harness({ record, replayed: false }).POST(post(), context)).status,
      503,
    );
});
test("auth/origin/current permission/conflict/provider errors remain explicit", async () => {
  for (const [error, status] of [
    ["P0002", 404],
    ["42501", 403],
    ["P0001", 409],
    ["22023", 422],
    ["xx", 503],
  ] as const) {
    const res = await harness(null, error).POST(post(), context);
    assert.equal(res.status, status);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(
    (await harness(null, null, false).GET(request(), context)).status,
    401,
  );
  const h = harness();
  assert.equal(
    (await h.POST(post(body, "https://other.example"), context)).status,
    403,
  );
  assert.equal(h.calls.length, 0);
});
