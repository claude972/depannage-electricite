import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "../documents/harness";
const ID = "10000000-0000-4000-8000-000000000001",
  RID = "20000000-0000-4000-8000-000000000001",
  KEY = "30000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: ID }) };
const instant = "2030-01-01T12:00:00Z";
const record = {
  id: RID,
  kind: "credential",
  record_id: ID,
  source_version: 1,
  due_on: "2030-01-03",
  remind_at: instant,
  version: 1,
  status: "scheduled",
  notification_id: null,
  processed_at: null,
  updated_at: instant,
};
const command = {
  action: "schedule",
  command_id: KEY,
  expected_version: null,
  source_version: 1,
  due_on: "2030-01-03",
  remind_at: instant,
};
function fixture(
  kind: "credential" | "compliance",
  data: unknown,
  error: unknown = null,
  auth = true,
) {
  const calls: any[] = [];
  const m = loadModule(
    kind === "credential"
      ? "app/api/artisan/credentials/[id]/reminder/route.ts"
      : "app/api/compliance/[id]/reminder/route.ts",
    {
      "@/lib/supabase/server": fakeServerHelpers({
        authenticated: auth,
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
      (m.GET as any)(new Request("https://qa.invalid/path" + query), context),
    post: (body: unknown = command, origin = "https://qa.invalid") =>
      (m.POST as any)(
        new Request("https://qa.invalid/path", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify(body),
        }),
        context,
      ),
  };
}
test("both real handlers bind source identity and exact chosen date/time to caller", async () => {
  for (const kind of ["credential", "compliance"] as const) {
    const f = fixture(kind, { record: { ...record, kind }, replayed: false });
    const r = await f.post();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
      {
        name: "write_operational_reminder",
        args: {
          p_kind: kind,
          p_record_id: ID,
          p_command_id: KEY,
          p_action: "schedule",
          p_expected_version: null,
          p_source_version: 1,
          p_due_on: "2030-01-03",
          p_remind_at: instant,
        },
      },
    ]);
  }
});
test("cancel uses only current personal version and stable command", async () => {
  const f = fixture("credential", {
    record: {
      ...record,
      status: "cancelled",
      version: 2,
      processed_at: instant,
    },
    replayed: true,
  });
  assert.equal(
    (await f.post({ action: "cancel", command_id: KEY, expected_version: 1 }))
      .status,
    200,
  );
  assert.equal(f.calls[0].args.p_source_version, null);
  assert.equal(f.calls[0].args.p_remind_at, null);
});
test("no invented date or injected recipient/channel/source is accepted", async () => {
  for (const body of [
    { ...command, due_on: null },
    { ...command, remind_at: "tomorrow" },
    { ...command, recipient_id: RID },
    { ...command, kind: "compliance" },
    { ...command, sms: true },
    { action: "cancel", command_id: KEY, expected_version: null },
  ]) {
    const f = fixture("credential", null);
    assert.equal((await f.post(body)).status, 422);
    assert.equal(f.calls.length, 0);
  }
});
test("wrong date, source, revision or status receipt does not confirm", async () => {
  for (const changed of [
    { kind: "compliance" },
    { record_id: RID },
    { source_version: 2 },
    { due_on: "2030-01-04" },
    { version: 2 },
    { remind_at: "2030-01-02T12:00:00Z" },
    { status: "sent", processed_at: instant },
  ])
    assert.equal(
      (
        await fixture("credential", {
          record: { ...record, ...changed },
          replayed: false,
        }).post()
      ).status,
      503,
    );
});
test("GET represents missing expiry and empty personal reminder honestly", async () => {
  const data = {
    kind: "credential",
    record_id: ID,
    source: { version: 1, due_on: null },
    record: null,
    eligibility: "no_date",
    can_schedule: false,
    scheduled_for_current_source: false,
  };
  assert.equal((await fixture("credential", data).get()).status, 200);
  for (const changed of [
    { record_id: RID },
    { can_schedule: true },
    { email: "private@example.invalid" },
  ])
    assert.equal(
      (await fixture("credential", { ...data, ...changed }).get()).status,
      503,
    );
});
test("authentication, origin, query and SQL refusals remain private", async () => {
  const f = fixture("credential", null);
  assert.equal((await f.post(command, "https://evil.invalid")).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (await fixture("credential", null, null, false).get()).status,
    401,
  );
  assert.equal(
    (await fixture("credential", null).get("?recipient_id=" + RID)).status,
    422,
  );
  for (const [code, status] of [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 409],
    ["22023", 422],
    ["XX000", 503],
  ] as const) {
    const r = await fixture("credential", null, { code }).post();
    assert.equal(r.status, status);
    assert.match(r.headers.get("Cache-Control"), /no-store/);
  }
});
