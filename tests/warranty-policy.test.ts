import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const id = "10000000-0000-4000-8000-000000000001";
const publication = {
  version: 2,
  title: "Conditions QA",
  body: "Texte synthétique de test uniquement.",
  published_at: "2026-01-01T00:00:00Z",
};
const state = {
  version: 3,
  draft: { title: publication.title, body: publication.body },
  published: publication,
  operator_enabled: true,
};
function harness(
  path: string,
  data: unknown,
  error: string | null = null,
  authenticated = true,
) {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data, error: error ? { code: error } : null };
    },
    from() {
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        limit: async () => ({ data: [], error: null }),
      };
    },
  };
  return {
    ...(loadModule(path, {
      "@/lib/supabase/server": {
        ...fakeServerHelpers({ db, authenticated }),
        serverClient: async () => db,
        publicClient: () => db,
      },
    }) as any),
    calls,
  };
}
const admin = "app/api/admin/warranty-policy/route.ts",
  pub = "app/api/public/warranty-terms/route.ts",
  warranty = "app/api/warranty/route.ts";
const req = (path = "/api/admin/warranty-policy") =>
  new Request("https://app.example" + path);
const post = (body: unknown, origin = "https://app.example") =>
  new Request("https://app.example/api/admin/warranty-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
function withEnv(value: string | undefined, fn: () => Promise<void>) {
  return (async () => {
    const old = process.env.WARRANTY_REQUESTS_ENABLED;
    try {
      if (value === undefined) delete process.env.WARRANTY_REQUESTS_ENABLED;
      else process.env.WARRANTY_REQUESTS_ENABLED = value;
      await fn();
    } finally {
      if (old === undefined) delete process.env.WARRANTY_REQUESTS_ENABLED;
      else process.env.WARRANTY_REQUESTS_ENABLED = old;
    }
  })();
}
test("operator GET distinguishes persisted enablement from environment gate without mutating either", async () => {
  await withEnv(undefined, async () => {
    const r = await harness(admin, state).GET(req());
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.operator_enabled, true);
    assert.equal(b.enabled, false);
    assert.equal(b.environment_enabled, false);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });
  await withEnv("true", async () => {
    assert.equal(
      (await (await harness(admin, state).GET(req())).json()).enabled,
      true,
    );
    assert.equal(
      (
        await (
          await harness(admin, { ...state, operator_enabled: false }).GET(req())
        ).json()
      ).enabled,
      false,
    );
  });
});
test("operator commands are strict and bind stable ID, expected version and published version", async () => {
  const h = harness(admin, { version: 4, action: "enable", replayed: false });
  const r = await h.POST(
    post({
      action: "enable",
      command_id: id,
      expected_version: 3,
      published_version: 2,
    }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), [
    "write_warranty_policy",
    {
      p_command_id: id,
      p_expected_version: 3,
      p_action: "enable",
      p_title: null,
      p_body: null,
      p_published_version: 2,
    },
  ]);
  for (const body of [
    { action: "enable", command_id: id, expected_version: 3 },
    {
      action: "publish",
      command_id: id,
      expected_version: 3,
      body: "unexpected",
    },
    {
      action: "save",
      command_id: id,
      expected_version: 3,
      title: "QA",
      body: "a".repeat(20001),
    },
  ]) {
    const bad = harness(admin, null);
    assert.equal((await bad.POST(post(body))).status, 422);
    assert.equal(bad.calls.length, 0);
  }
});
test("operator auth, origin, stale commands and malformed receipts fail closed", async () => {
  const body = { action: "disable", command_id: id, expected_version: 3 };
  for (const [h, status] of [
    [harness(admin, null, null, false), 401],
    [harness(admin, null, "42501"), 403],
    [harness(admin, null, "P0001"), 409],
    [harness(admin, { version: 5, action: "disable", replayed: false }), 503],
    [harness(admin, { version: 4, action: "enable", replayed: false }), 503],
  ] as const)
    assert.equal((await h.POST(post(body))).status, status);
  const h = harness(admin, null);
  assert.equal(
    (await h.POST(post(body, "https://foreign.example"))).status,
    403,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await harness(admin, { ...state, published: null }).GET(req())).status,
    503,
  );
});
test("public current and historical conditions expose only validated publication, no drafts or actors", async () => {
  for (const suffix of ["", "?version=2"]) {
    const h = harness(pub, publication);
    const r = await h.GET(req("/api/public/warranty-terms" + suffix));
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).published, publication);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(
    (
      await (
        await harness(pub, null).GET(req("/api/public/warranty-terms"))
      ).json()
    ).published,
    null,
  );
  for (const data of [
    { ...publication, actor_id: id },
    { ...publication, version: 3 },
    { ...publication, body: "" },
  ])
    assert.equal(
      (
        await harness(pub, data).GET(
          req("/api/public/warranty-terms?version=2"),
        )
      ).status,
      503,
    );
  for (const q of [
    "?version=0",
    "?version=2&version=2",
    "?version=2147483648",
    "?draft=true",
  ]) {
    const h = harness(pub, null);
    assert.equal(
      (await h.GET(req("/api/public/warranty-terms" + q))).status,
      422,
    );
    assert.equal(h.calls.length, 0);
  }
});
test("existing intake keeps environment guard and historical resolution works with environment disabled", async () => {
  await withEnv("false", async () => {
    const h = harness(warranty, {});
    assert.equal(
      (
        await h.POST(
          post({
            action: "request",
            intervention_id: id,
            description: "Synthetic warranty QA issue",
          }),
        )
      ).status,
      503,
    );
    assert.equal(h.calls.length, 0);
    const resolve = harness(warranty, { id });
    assert.equal(
      (
        await resolve.POST(
          post({
            action: "resolve",
            case_id: id,
            expected_version: "2026-11-07T12:00:00.123456Z",
            status: "declined",
            resolution: "Synthetic documented QA resolution",
          }),
        )
      ).status,
      200,
    );
    assert.equal(resolve.calls[0][0], "resolve_warranty");
    assert.equal(resolve.calls[0][1].p_expected_version, "2026-11-07T12:00:00.123456Z");
  });
  await withEnv("true", async () => {
    assert.equal(
      (
        await harness(warranty, null, "P0001").POST(
          post({
            action: "request",
            intervention_id: id,
            description: "Synthetic warranty QA issue",
          }),
        )
      ).status,
      409,
    );
  });
});
test("existing intake GET accepts only real boolean gate and combines both switches", async () => {
  await withEnv("true", async () => {
    assert.equal((await harness(warranty, "true").GET(req("/api/warranty"))).status, 503);
    assert.equal(
      (await (await harness(warranty, false).GET(req("/api/warranty"))).json()).enabled,
      false,
    );
    assert.equal(
      (await (await harness(warranty, true).GET(req("/api/warranty"))).json()).enabled,
      true,
    );
  });
});

const corrective = "app/api/warranty/[id]/corrective/route.ts";
const correctiveId = "10000000-0000-4000-8000-000000000002";
const correctiveJob = {
  id: correctiveId,
  category: "socket",
  status: "requested",
  created_at: "2026-11-07T12:00:00+00:00",
};
const correctiveContext = { params: Promise.resolve({ id }) };

test("corrective GET returns the scoped projection without caching", async () => {
  const payload = { link: null, candidates: [correctiveJob], has_more: false };
  const h = harness(corrective, payload);
  const response = await h.GET(req(), correctiveContext);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), payload);
  assert.deepEqual(structuredClone(h.calls), [["read_warranty_corrective_intervention", { p_case_id: id }]]);
});

test("corrective POST validates origin, payload and exact linked dossier", async () => {
  const payload = { link: correctiveJob, replayed: true };
  const h = harness(corrective, payload);
  const body = { intervention_id: correctiveId };
  assert.equal((await h.POST(post(body, "https://other.example"), correctiveContext)).status, 403);
  assert.equal((await h.POST(post({ ...body, charged: true }), correctiveContext)).status, 422);
  assert.deepEqual(h.calls, []);
  const response = await h.POST(post(body), correctiveContext);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.deepEqual(structuredClone(h.calls), [["link_warranty_corrective_intervention", {
    p_case_id: id, p_intervention_id: correctiveId,
  }]]);
  const malformed = harness(corrective, { ...payload, link: { ...correctiveJob, id } });
  assert.equal((await malformed.POST(post(body), correctiveContext)).status, 503);
});
