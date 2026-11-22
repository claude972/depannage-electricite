import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const team = "10000000-0000-4000-8000-000000000001",
  command = "20000000-0000-4000-8000-000000000001",
  job = "30000000-0000-4000-8000-000000000001",
  user = "40000000-0000-4000-8000-000000000001";
const teamDto = {
  id: team,
  name: "Équipe QA",
  owner_id: user,
  version: 1,
  role: "owner",
  active: true,
};
function setup(
  path: string,
  data: unknown,
  error: unknown = null,
  authenticated = true,
) {
  const calls: any[] = [];
  const route = loadModule(path, {
    "@/lib/supabase/server": fakeServerHelpers({
      authenticated,
      db: {
        rpc: async (name: string, args: unknown) => {
          calls.push({ name, args });
          return { data, error };
        },
      },
    }),
  });
  return {
    route: route as Record<
      string,
      (r: Request, c?: unknown) => Promise<Response>
    >,
    calls,
  };
}
const root = "app/api/provider-teams/route.ts",
  nested = "app/api/provider-teams/[id]/route.ts",
  inbox = "app/api/provider-team-invitations/route.ts",
  detail = "app/api/provider-teams/[id]/missions/[interventionId]/route.ts";
const context = { params: Promise.resolve({ id: team, interventionId: job }) };
function req(body?: unknown, query = "", origin = "https://qa.invalid") {
  return new Request("https://qa.invalid/api/provider-teams" + query, {
    method: body ? "POST" : "GET",
    headers: { origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const receipt = {
  team_id: team,
  action: "create",
  team_version: 1,
  entity_id: team,
  entity_version: 1,
  state: "created",
  replayed: false,
};
test("create passes caller command and receives private confirmed receipt", async () => {
  const { route, calls } = setup(root, receipt);
  const r = await route.POST(
    req({
      action: "create",
      team_id: team,
      command_id: command,
      name: " Équipe QA ",
    }),
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control")!, /private, no-store/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      name: "write_provider_team",
      args: {
        p_team_id: team,
        p_command_id: command,
        p_action: "create",
        p_values: { name: "Équipe QA" },
      },
    },
  ]);
});
test("write refuses foreign origin, unauthenticated and extra financial keys before RPC", async () => {
  for (const [body, origin, authenticated, status] of [
    [
      { action: "create", team_id: team, command_id: command, name: "QA" },
      "https://evil.invalid",
      true,
      403,
    ],
    [
      { action: "create", team_id: team, command_id: command, name: "QA" },
      "https://qa.invalid",
      false,
      401,
    ],
    [
      {
        action: "create",
        team_id: team,
        command_id: command,
        name: "QA",
        commission: 20,
      },
      "https://qa.invalid",
      true,
      422,
    ],
  ] as const) {
    const { route, calls } = setup(root, receipt, null, authenticated);
    assert.equal((await route.POST(req(body, "", origin))).status, status);
    assert.equal(calls.length, 0);
  }
});
test("assignment null initial version and stable UUID forwarded unchanged", async () => {
  const { route, calls } = setup(nested, {
    ...receipt,
    action: "assign",
    entity_id: job,
    entity_version: 6,
    state: "assigned",
  });
  const r = await route.POST(
    req({
      action: "assign",
      command_id: command,
      intervention_id: job,
      technician_id: user,
      expected_version: null,
    }),
    context,
  );
  assert.equal(r.status, 200);
  assert.equal(calls[0].args.p_values.expected_version, null);
});
test("SQL denial/conflict/unavailable mappings remain private", async () => {
  for (const [code, status] of [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 409],
    ["22023", 422],
    ["53300", 429],
    ["XX000", 503],
  ] as const) {
    const { route } = setup(root, null, { code });
    const r = await route.GET(req());
    assert.equal(r.status, status);
    assert.match(r.headers.get("Cache-Control")!, /no-store/);
    if (status === 503) assert.equal(r.headers.get("Retry-After"), "2");
  }
});
test("receipt must match requested entity, state and version", async () => {
  for (const bad of [
    { entity_id: user },
    { state: "done" },
    { entity_version: 3 },
  ]) {
    const { route } = setup(nested, {
      ...receipt,
      action: "assign",
      entity_id: job,
      entity_version: 2,
      state: "assigned",
      ...bad,
    });
    assert.equal(
      (
        await route.POST(
          req({
            action: "assign",
            command_id: command,
            intervention_id: job,
            technician_id: user,
            expected_version: 1,
          }),
          context,
        )
      ).status,
      503,
    );
  }
});
test("invitation accepted through real inbox handler", async () => {
  const { route, calls } = setup(inbox, {
    ...receipt,
    action: "accept_invitation",
    entity_id: job,
    entity_version: 1,
    state: "accepted",
  });
  assert.equal(
    (
      await route.POST(
        req({
          action: "accept_invitation",
          command_id: command,
          team_id: team,
          invitation_id: job,
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.p_values)), {
    invitation_id: job,
  });
});
test("team list validates private projection and cursor", async () => {
  const { route } = setup(root, { records: [teamDto], next_after: null });
  assert.equal((await route.GET(req())).status, 200);
  for (const data of [
    {
      records: [{ ...teamDto, email: "leak@example.invalid" }],
      next_after: null,
    },
    { records: [teamDto, teamDto], next_after: null },
    { records: [teamDto], next_after: team },
  ]) {
    assert.equal((await setup(root, data).route.GET(req())).status, 503);
  }
});
test("team section validates URL scope and unknown/duplicate query fields", async () => {
  const data = {
    team: teamDto,
    section: "members",
    records: [],
    next_after: null,
  };
  assert.equal(
    (await setup(nested, data).route.GET(req(), context)).status,
    200,
  );
  assert.equal(
    (
      await setup(nested, {
        ...data,
        team: { ...teamDto, id: user },
      }).route.GET(req(), context)
    ).status,
    503,
  );
  for (const query of [
    "?section=finance",
    "?section=members&section=members",
    "?owner_id=" + user,
  ]) {
    const { route, calls } = setup(nested, data);
    assert.equal((await route.GET(req(undefined, query), context)).status, 422);
    assert.equal(calls.length, 0);
  }
});
const mission = {
  team_id: team,
  intervention: {
    id: job,
    category: "panel",
    status: "assigned",
    description: "Description privée QA",
    address: "Adresse QA",
    postal_code: "97200",
    city: "QA",
  },
  appointment: null,
  assignment: null,
  permissions: {
    can_assign: true,
    can_acknowledge: false,
    can_complete: false,
  },
};
test("mission detail permits limited projection and rejects added PII or wrong scope", async () => {
  assert.equal(
    (await setup(detail, mission).route.GET(req(), context)).status,
    200,
  );
  for (const data of [
    { ...mission, team_id: user },
    {
      ...mission,
      intervention: { ...mission.intervention, client_phone: "private" },
    },
    { ...mission, permissions: { ...mission.permissions, can_assign: null } },
  ])
    assert.equal(
      (await setup(detail, data).route.GET(req(), context)).status,
      503,
    );
});
test("invitation inbox validates response and role", async () => {
  const data = {
    records: [
      {
        id: job,
        team_id: team,
        team_name: "QA",
        role: "technician",
        expires_at: "2030-01-01T00:00:00Z",
        team_active: true,
      },
    ],
    next_after: null,
  };
  assert.equal((await setup(inbox, data).route.GET(req())).status, 200);
  data.records[0].role = "owner";
  assert.equal((await setup(inbox, data).route.GET(req())).status, 503);
});
