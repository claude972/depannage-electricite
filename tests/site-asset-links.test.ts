import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const S = "10000000-0000-4000-8000-000000000001",
  A = "20000000-0000-4000-8000-000000000001",
  J = "30000000-0000-4000-8000-000000000001",
  C = "40000000-0000-4000-8000-000000000001";
const row = (n = 1) => ({
  id: `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  site_id: S,
  intervention_id: J,
  kind: "equipment",
  asset_id: A,
  active: true,
  version: 1,
  created_at: "2026-11-07T14:00:00Z",
  updated_at: "2026-11-07T14:00:00Z",
  detached_at: null,
});
const history = (n = 1) => ({
  ...row(n),
  intervention: {
    id: J,
    category: "socket",
    status: "completed",
    created_at: "2026-11-06T14:00:00Z",
  },
  asset_archived: false,
});
function fixture(
  opts: {
    records?: any[];
    error?: string;
    auth?: boolean;
    write?: any;
    canWrite?: boolean;
    archived?: boolean;
  } = {},
) {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, p: any) => {
      calls.push({ name, p });
      return {
        error: opts.error ? { code: opts.error } : null,
        data:
          name === "site_asset_link_page"
            ? {
                records: opts.records ?? [],
                can_write: opts.canWrite ?? true,
                site_archived: opts.archived ?? false,
              }
            : (opts.write ?? { record: row(), replayed: false }),
      };
    },
  };
  const m = loadModule("app/api/sites/[id]/asset-links/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({
      db,
      authenticated: opts.auth,
    }),
  });
  const ctx = { params: Promise.resolve({ id: S }) };
  return {
    calls,
    get: (q = `?kind=equipment&asset_id=${A}`) =>
      (m.GET as any)(
        new Request(
          "https://preview.example.test/api/sites/" + S + "/asset-links" + q,
        ),
        ctx,
      ),
    post: (
      body: any = {
        command_id: C,
        intervention_id: J,
        kind: "equipment",
        asset_id: A,
        action: "link",
        expected_version: null,
      },
      origin = "https://preview.example.test",
    ) =>
      (m.POST as any)(
        new Request(
          "https://preview.example.test/api/sites/" + S + "/asset-links",
          { method: "POST", headers: { origin }, body: JSON.stringify(body) },
        ),
        ctx,
      ),
  };
}
async function result(r: Response, status: number) {
  assert.equal(r.status, status, await r.clone().text());
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  return r.json();
}
test("real GET returns honest empty state and current permissions without fabricated totals", async () => {
  const f = fixture({ canWrite: false });
  const b = await result(await f.get(), 200);
  assert.deepEqual(b.records, []);
  assert.equal(b.page.complete, true);
  assert.equal(b.page.has_more, false);
  assert.equal(b.permissions.can_write, false);
  assert.equal(b.page.total, undefined);
  assert.equal(f.calls[0].p.p_asset_id, A);
});
test("51 candidates expose50 with caller/filter-bound cursor, subsequent page is explicitly partial", async () => {
  const f = fixture({
    records: Array.from({ length: 51 }, (_, i) => history(i + 1)),
  });
  const b = await result(await f.get(), 200);
  assert.equal(b.records.length, 50);
  assert.equal(b.page.has_more, true);
  const g = fixture({ records: [history(51)] });
  const next = await result(
    await g.get(`?kind=equipment&asset_id=${A}&cursor=${b.page.next_cursor}`),
    200,
  );
  assert.equal(next.page.complete, false);
  assert.equal(next.page.has_more, false);
  assert.equal(g.calls[0].p.p_after_id, row(50).id);
  await result(
    await fixture().get(
      `?kind=area&asset_id=${A}&cursor=${b.page.next_cursor}`,
    ),
    422,
  );
  const parsed = JSON.parse(
    Buffer.from(b.page.next_cursor, "base64url").toString(),
  );
  parsed.actor_id = C;
  await result(
    await fixture().get(
      `?kind=equipment&asset_id=${A}&cursor=${Buffer.from(JSON.stringify(parsed)).toString("base64url")}`,
    ),
    422,
  );
});
test("strict filter, duplicate query and invalid cursors rejected before RPC", async () => {
  for (const q of [
    "",
    `?kind=equipment&asset_id=${A}&intervention_id=${J}`,
    `?kind=equipment&asset_id=${A}&asset_id=${A}`,
    `?kind=equipment&asset_id=${A}&cursor=!!`,
    "?kind=unknown&asset_id=" + A,
  ]) {
    const f = fixture();
    await result(await f.get(q), 422);
    assert.equal(f.calls.length, 0);
  }
});
test("dossier projection is supported, malformed/foreign/PII rows are never forwarded", async () => {
  const f = fixture({ records: [history()] });
  await result(await f.get("?intervention_id=" + J), 200);
  assert.equal(f.calls[0].p.p_kind, null);
  for (const records of [
    [{ ...history(), site_id: C }],
    [{ ...history(), asset_id: C }],
    [history(), history()],
    [
      {
        ...history(),
        intervention: { ...history().intervention, address: "PRIVATE" },
      },
    ],
    [{ ...history(), active: false }],
  ])
    await result(await fixture({ records }).get(), 503);
  await result(await fixture({ archived: true, canWrite: true }).get(), 503);
});
test("real POST persists stable command and expected version; receipt projection confirmed", async () => {
  const f = fixture();
  const b = await result(await f.post(), 200);
  assert.equal(b.record.id, row().id);
  assert.equal(f.calls[0].p.p_command_id, C);
  assert.equal(f.calls[0].p.p_expected_version, null);
  const g = fixture({
    write: {
      record: {
        ...row(),
        active: false,
        version: 2,
        detached_at: "2026-11-07T15:00:00Z",
      },
      replayed: true,
    },
  });
  const out = await result(
    await g.post({
      command_id: C,
      intervention_id: J,
      kind: "equipment",
      asset_id: A,
      action: "unlink",
      expected_version: 1,
    }),
    200,
  );
  assert.equal(out.replayed, true);
  assert.equal(out.record.version, 2);
});
test("strict command/origin/auth and permission failures never turn into empty or successful result", async () => {
  for (const body of [
    {
      command_id: C,
      intervention_id: J,
      kind: "equipment",
      asset_id: A,
      action: "link",
      expected_version: null,
      actor_id: C,
    },
    {
      command_id: C,
      intervention_id: J,
      kind: "equipment",
      asset_id: A,
      action: "unlink",
      expected_version: null,
    },
  ]) {
    const f = fixture();
    await result(await f.post(body), 422);
    assert.equal(f.calls.length, 0);
  }
  await result(await fixture().post(undefined, "https://evil.example"), 403);
  await result(await fixture({ auth: false }).get(), 401);
  for (const [code, status] of [
    ["42501", 403],
    ["P0002", 404],
    ["P0001", 409],
    ["23505", 409],
    ["XX000", 503],
  ] as const)
    await result(await fixture({ error: code }).post(), status);
});
test("archived asset/site and detached links remain visible; unsuccessful write projection refused", async () => {
  const b = await result(
    await fixture({
      records: [
        {
          ...history(),
          active: false,
          detached_at: "2026-11-07T15:00:00Z",
          asset_archived: true,
        },
      ],
      archived: true,
      canWrite: false,
    }).get(),
    200,
  );
  assert.equal(b.records[0].asset_archived, true);
  assert.equal(b.site_archived, true);
  for (const record of [
    { ...row(), version: 2 },
    { ...row(), site_id: C },
    { ...row(), asset_id: C },
  ])
    await result(
      await fixture({ write: { record, replayed: false } }).post(),
      503,
    );
});
