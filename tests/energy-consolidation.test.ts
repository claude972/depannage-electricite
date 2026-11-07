import test from "node:test";
import assert from "node:assert/strict";
import {
  energyReport,
  selection,
} from "../lib/features/energy-consolidation/report";
import { loadModule, ApiError } from "./documents/harness";
const org = "10000000-0000-4000-8000-000000000001",
  site = "10000000-0000-4000-8000-000000000002",
  other = "10000000-0000-4000-8000-000000000003";
const scope = selection.parse({
  organization_id: org,
  site_ids: [site],
  from: "2026-01-01",
  to: "2026-01-31",
  previous_from: "2025-12-01",
  previous_to: "2025-12-31",
});
const period = (value = "0") => ({
  record_count: 1,
  crossing_count: 0,
  missing_cost_count: 0,
  consumption_wh: value,
  cost_cents: "0",
  coverage_complete: true,
});
const meter = () => ({
  site_id: site,
  meter_label: "main",
  current: period(),
  previous: period("25"),
});
const projection = (meters: unknown[] = [meter()], sites = [site]) => ({
  organization_id: org,
  site_ids: sites,
  meters,
});
test("declared zero is distinct from empty sites and has exact comparable delta, without invented physical completeness", () => {
  const r = energyReport(projection(), scope);
  assert.equal(r.current.recorded_consumption_wh, "0");
  assert.equal(r.current.recorded_coverage_complete, true);
  assert.equal(r.comparison.comparable, true);
  assert.equal(r.comparison.consumption_delta_wh, "-25");
  assert.equal(r.physical_scope_complete, false);
  assert.equal(r.current.actual_site_consumption_wh, null);
  const empty = energyReport(projection([]), scope);
  assert.equal(empty.current.recorded_consumption_wh, null);
  assert.equal(empty.current.recorded_cost_cents, null);
  assert.equal(empty.current.recorded_coverage_complete, false);
  assert.equal(empty.comparison.consumption_delta_wh, null);
});
test("partial sites, unknown costs, gaps and crossing ranges suppress completeness and comparisons", () => {
  const m = meter();
  m.current = {
    ...period("30"),
    missing_cost_count: 1,
    cost_cents: null as any,
    coverage_complete: false,
    crossing_count: 1,
  };
  const s = { ...scope, site_ids: [site, other] };
  const r = energyReport(projection([m], s.site_ids), s);
  assert.equal(r.current.recorded_consumption_wh, "30");
  assert.equal(r.current.recorded_coverage_complete, false);
  assert.equal(r.current.recorded_cost_cents, null);
  assert.equal(r.sites[1].current.recorded_consumption_wh, null);
  assert.equal(r.comparison.comparable, false);
});
test("comparison requires disjoint equal day counts; missing costs only suppress monetary delta", () => {
  for (const s of [
    { ...scope, previous_from: "2025-12-02" },
    { ...scope, previous_from: scope.from, previous_to: scope.to },
  ])
    assert.equal(energyReport(projection(), s).comparison.comparable, false);
  const m = meter();
  m.current.missing_cost_count = 1;
  m.current.cost_cents = null as any;
  const r = energyReport(projection([m]), scope);
  assert.equal(r.comparison.comparable, true);
  assert.equal(r.comparison.cost_delta_cents, null);
  assert.equal(r.current.cost_complete, false);
});
test("exact sums beyond JS safe integer do not round and scope/projection inconsistencies fail closed", () => {
  const a = meter(),
    b = { ...meter(), meter_label: "other" };
  a.current.consumption_wh = "9007199254740992";
  b.current.consumption_wh = "1";
  assert.equal(
    energyReport(projection([a, b]), scope).current.recorded_consumption_wh,
    "9007199254740993",
  );
  for (const bad of [
    projection([meter(), meter()]),
    projection([{ ...meter(), site_id: other }]),
    projection([{ ...meter(), note: "private" }]),
    projection([{ ...meter(), previous: null }]),
    projection([{ ...meter(), current: { ...period(), record_count: 0 } }]),
    projection([meter()], [other]),
  ])
    assert.throws(() => energyReport(bad, scope));
});
function harness(
  options: { data?: unknown; error?: string; unauth?: boolean } = {},
) {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return {
        data: options.data === undefined ? projection() : options.data,
        error: options.error ? { code: options.error } : null,
      };
    },
  };
  const server = {
    ApiError,
    authenticatedClient: async () => {
      if (options.unauth) throw new ApiError(401, "Connexion requise.");
      return { db, user: { id: org } };
    },
    dbError: (e: any) => {
      if (e)
        throw new ApiError(
          e.code === "P0002" ? 404 : e.code === "22023" ? 422 : 503,
          "Consolidation indisponible.",
        );
    },
  };
  return {
    ...(loadModule("app/api/organizations/[id]/energy/route.ts", {
      "@/lib/supabase/server": server,
    }) as any),
    calls,
  };
}
const context = { params: Promise.resolve({ id: org }) };
const query = `site_ids=${site}&from=2026-01-01&to=2026-01-31&previous_from=2025-12-01&previous_to=2025-12-31`;
const request = (q = query) =>
  new Request("https://app.example/api/organizations/" + org + "/energy?" + q);
test("real HTTP GET binds selected sites and periods to authenticated RPC, returns private exact report", async () => {
  const h = harness();
  const r = await h.GET(request(), context);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal((await r.json()).comparison.consumption_delta_wh, "-25");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), [
    "organization_energy_consolidation",
    {
      p_organization_id: org,
      p_site_ids: [site],
      p_from: "2026-01-01",
      p_to: "2026-01-31",
      p_previous_from: "2025-12-01",
      p_previous_to: "2025-12-31",
    },
  ]);
});
test("real HTTP rejects duplicate, unknown, missing, invalid, excessive filters before querying", async () => {
  for (const q of [
    query + "&from=2026-01-01",
    query + "&unexpected=1",
    query.replace(site, site + "," + site),
    query.replace("2026-01-31", "2026-02-30"),
    query.replace("previous_to=2025-12-31", "previous_to="),
    query.replace("2026-01-31", "2027-01-31"),
    "from=2026-01-01&to=2026-01-31",
    query.replace(site, Array(51).fill(site).join(",")),
  ]) {
    const h = harness();
    assert.equal((await h.GET(request(q), context)).status, 422, q);
    assert.equal(h.calls.length, 0);
  }
});
test("real HTTP auth, foreign scope, database failure and malformed projection never become empty success", async () => {
  for (const [options, status] of [
    [{ unauth: true }, 401],
    [{ error: "P0002" }, 404],
    [{ error: "22023" }, 422],
    [{ error: "unknown" }, 503],
    [{ data: null }, 503],
    [{ data: projection([{ ...meter(), site_id: other }]) }, 503],
  ] as const) {
    const r = await harness(options).GET(request(), context);
    assert.equal(r.status, status);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    if (status === 503) assert.equal(r.headers.get("retry-after"), "2");
  }
});

test("single range does not imply a comparison and missing period stays null", () => {
  const m = { ...meter(), previous: null };
  const r = energyReport(projection([m]), {
    ...scope,
    previous_from: null,
    previous_to: null,
  });
  assert.equal(r.previous, null);
  assert.equal(r.comparison.reason, "not_requested");
  assert.equal(
    selection.safeParse({ ...scope, from: "0000-01-01", to: "0000-01-31" })
      .success,
    false,
  );
});
