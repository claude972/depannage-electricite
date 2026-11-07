import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, fakeServerHelpers } from "./documents/harness";

const id = "10000000-0000-4000-8000-000000000001";
const grid = "10000000-0000-4000-8000-000000000002";
const actor = "10000000-0000-4000-8000-000000000009";
const token = "a".repeat(64);
const context = { params: Promise.resolve({ id }) };
const url = "https://app.example/api/interventions/" + id + "/quote-grid";
const input = {
  grid_id: grid, grid_version: 2, selection: [{ index: 0, quantity: 3 }],
  expected_version: 0, assignment_token: token, base_quote_id: null, tax_rate: 8.5,
};
function harness(data: unknown) {
  const calls: unknown[][] = [];
  const db = { rpc: async (name: string, args: unknown) => {
    calls.push([name, args]); return { data, error: null };
  } };
  const handlers = loadModule("app/api/interventions/[id]/quote-grid/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({ db }),
  }) as {
    GET: (request: Request, c: typeof context) => Promise<Response>;
    POST: (request: Request, c: typeof context) => Promise<Response>;
  };
  return { ...handlers, calls };
}
const post = (body: unknown) => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("grid options expose only the scoped projection and validate the cursor", async () => {
  const h = harness({ current: null, grids: [], next_cursor: null });
  assert.equal((await h.GET(new Request(url + "?after=x"), context)).status, 422);
  assert.equal(h.calls.length, 0);
  const response = await h.GET(new Request(url + "?after=" + grid), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(structuredClone(h.calls), [["read_quote_grid_options", { p_id: id, p_after: grid }]]);
});

test("applying a grid accepts quantities only and binds the returned draft to the actor and revision", async () => {
  const result = { version: 1, assignment_token: token, current_quote_id: null, draft: {
    intervention_id: id, artisan_id: actor, version: 1, assignment_token: token, base_quote_id: null,
    lines: [{ label: "Forfait", quantity: 3, unit_price_cents: 15000 }],
    tax_rate: 8.5, updated_at: "2026-11-07T00:00:00Z",
  } };
  const h = harness(result);
  const fakePrice = { ...input, selection: [{ ...input.selection[0], unit_price_cents: 1 }] };
  assert.equal((await h.POST(post(fakePrice), context)).status, 422);
  assert.equal(h.calls.length, 0);
  const response = await h.POST(post(input), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(structuredClone(h.calls), [["apply_quote_contract_grid", {
    p_id: id, p_grid_id: grid, p_grid_version: 2, p_selection: input.selection,
    p_expected_version: 0, p_assignment_token: token, p_base_quote_id: null, p_tax_rate: 8.5,
  }]]);
  const foreign = harness({ ...result, draft: { ...result.draft, artisan_id: grid } });
  assert.equal((await foreign.POST(post(input), context)).status, 503);
});
