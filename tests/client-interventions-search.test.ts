import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const origin = "https://app.test";
const path = `${origin}/api/client/interventions/search`;
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, created_at = "2026-11-06T12:00:00.123456Z") => ({
  id: id(n), category: "socket", address: "Adresse QA privée", city: "Ville QA", postal_code: "97200",
  urgency: "scheduled", status: "assigned", estimate_min_cents: 100, estimate_max_cents: 200, created_at,
});
const request = (body: unknown, from = origin, url = path) => new Request(url, {
  method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const input = (cursor: string | null = null) => ({ filter: "active", search: "  Adresse QA ", cursor });

function setup(data: unknown, { actor = id(500), authenticated = true, error = null as { code: string } | null } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { data, error }; } };
  const helpers = fakeServerHelpers({ db, authenticated });
  const m = loadModule("app/api/client/interventions/search/route.ts", { "@/lib/supabase/server": {
    ...helpers, async authenticatedClient() { const result = await helpers.authenticatedClient(); return { ...result, user: { id: actor } }; },
  } });
  return { post: m.POST as (req: Request) => Promise<Response>, calls };
}

test("private client search returns 50 sorted results, an exact total and a filter-bound cursor", async () => {
  const first = setup({ total: 135, items: Array.from({ length: 51 }, (_, i) => row(135 - i)) });
  const response = await first.post(request(input()));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const page = await response.json();
  assert.equal(page.items.length, 50);
  assert.equal(page.total, 135);
  assert.equal(page.page.has_more, true);
  const cursor = page.page.next_cursor;
  assert.doesNotMatch(Buffer.from(cursor, "base64url").toString(), /adresse|search|client_id/i);
  assert.equal(first.calls[0].args.p_search, "adresse qa");
  const next = setup({ total: 135, items: [row(85), row(84)] });
  assert.equal((await next.post(request(input(cursor)))).status, 200);
  assert.equal(next.calls[0].args.p_after_id, id(86));
  assert.equal(next.calls[0].args.p_after_at, row(86).created_at);
  for (const body of [{ ...input(cursor), filter: "past" }, { ...input(cursor), search: "elsewhere" }, input(`${cursor}a`)]) {
    const invalid = setup(null);
    assert.equal((await invalid.post(request(body))).status, 422);
    assert.equal(invalid.calls.length, 0);
  }
  const foreign = setup(null, { actor: id(501) });
  assert.equal((await foreign.post(request(input(cursor)))).status, 422);
  assert.equal(foreign.calls.length, 0);
});

test("search rejects cross-origin or unreadable projections and preserves precise database ordering", async () => {
  const boundary = [row(1, "2026-11-06T12:00:00.123456Z"), row(2, "2026-11-06T12:00:00.123455Z")];
  assert.equal((await setup({ items: boundary, total: 2 }).post(request(input()))).status, 200);
  for (const data of [{ items: boundary.toReversed(), total: 2 }, { items: [{ ...row(1), description: "private" }], total: 1 }, { items: [row(1)], total: 135 }]) {
    assert.equal((await setup(data).post(request(input()))).status, 503);
  }
  const restricted = setup(null);
  assert.equal((await restricted.post(request(input(), "https://elsewhere.test"))).status, 403);
  assert.equal((await restricted.post(request(input(), origin, `${path}?search=private`))).status, 422);
  assert.equal(restricted.calls.length, 0);
  assert.equal((await setup(null, { authenticated: false }).post(request(input()))).status, 401);
  assert.equal((await setup(null, { error: { code: "42501" } }).post(request(input()))).status, 403);
});
