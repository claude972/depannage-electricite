import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const origin = "https://app.test";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const filters = { organization_id: id(100), site_id: id(101), category: "panel", status: null, search: " Ampère ", sort: "recent" };
const row = (n: number, created_at = "2026-11-07T12:00:00.123456Z") => ({
  id: id(n), site_id: id(101), site_name: "=private", artisan_assigned: false,
  category: "panel", address: "Adresse QA privée", city: "Ville QA", postal_code: "97200",
  urgency: "scheduled", status: "requested", estimate_min_cents: 100, estimate_max_cents: 200, created_at,
});

function setup(data: unknown, error: { code: string } | null = null) {
  const calls: Record<string, unknown>[] = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "enterprise_intervention_search");
    calls.push(args);
    return { data, error };
  } };
  const { POST } = loadModule("app/api/enterprise/interventions/search/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({ db }),
  });
  const post = (body: unknown, from = origin, query = "") => POST(new Request(`${origin}/api/enterprise/interventions/search${query}`, {
    method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body),
  })) as Promise<Response>;
  return { post, calls };
}

test("enterprise search preserves filters, precise ordering and the exact scoped count", async () => {
  const body = { ...filters, action: "list", page: 14 };
  const items = [row(1), row(2, "2026-11-07T12:00:00.123455Z")];
  const list = setup({ items, total: 132 });
  const response = await list.post(body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { items, total: 132, page: { number: 14, limit: 10, pages: 14 } });
  assert.deepEqual({ ...list.calls[0] }, {
    p_organization: id(100), p_site: id(101), p_category: "panel", p_status: null,
    p_search: "ampère", p_sort: "recent", p_page: 14, p_export: false,
  });
  for (const bad of [items.toReversed(), [items[0], items[0]], [items[0]], [{ ...items[0], site_id: id(102) }, items[1]]]) {
    assert.equal((await setup({ items: bad, total: 132 }).post(body)).status, 503);
  }
  const blocked = setup(null, { code: "P0002" });
  assert.equal((await blocked.post(body, "https://foreign.test")).status, 403);
  assert.equal((await blocked.post(body, origin, "?address=private")).status, 422);
  assert.equal(blocked.calls.length, 0);
  assert.equal((await blocked.post(body)).status, 404);
});

test("enterprise CSV is private and protected from formula injection, and never a truncated success", async () => {
  const body = { ...filters, action: "export", sort: "oldest" };
  const ready = setup({ items: [row(1), row(2)], total: 2 });
  const response = await ready.post(body);
  assert.equal(response.status, 200);
  assert.equal(ready.calls[0].p_export, true);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition")!, /attachment.*interventions\.csv/);
  assert.match(await response.text(), /'=private/);
  assert.equal((await setup({ items: [], total: 5001 }).post(body)).status, 409);
  assert.equal((await setup({ items: [row(1)], total: 2 }).post(body)).status, 503);
});
