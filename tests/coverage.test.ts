import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";

const admin = "app/api/admin/coverage/route.ts";
const pub = "app/api/public/coverage/route.ts";
const url = "https://app.example/api/admin/coverage";
const commandId = "10000000-0000-4000-8000-000000000001";
function harness(path: string, data: unknown, error?: string) {
  const calls: unknown[][] = [];
  const db = { rpc: async (name: string, args?: unknown) => {
    calls.push([name, args]);
    return { data, error: error ? { code: error } : null };
  } };
  const handlers = loadModule(path, {
    "@/lib/supabase/server": { ...fakeServerHelpers({ db }), serverClient: async () => db },
  }) as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };
  return { ...handlers, calls };
}
const post = (payload: unknown, origin = "https://app.example") =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(payload) });

test("public lookup validates one exact postal code, keeps unknown distinct and excludes internal values", async () => {
  const endpoint = "https://app.example/api/public/coverage?postal_code=";
  const h = harness(pub, { status: "unknown", version: null });
  assert.equal((await h.GET(new Request(endpoint + "97200&postal_code=97201"))).status, 422);
  assert.equal((await h.GET(new Request(endpoint + "972"))).status, 422);
  assert.equal(h.calls.length, 0);
  const r = await h.GET(new Request(endpoint + "97200"));
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { status: "unknown", version: null });
  assert.deepEqual(structuredClone(h.calls), [["read_public_coverage", { p_postal_code: "97200" }]]);
  assert.equal((await harness(pub, { status: "covered", version: null }).GET(new Request(endpoint + "97200"))).status, 503);
});

test("admin publication checks origin, validates codes and reads back the exact version", async () => {
  const payload = { action: "publish", expected_version: 1, command_id: commandId, postal_codes: ["97202", "97200"] };
  const h = harness(admin, { version: 2, postal_codes: ["97200", "97202"], replayed: true });
  assert.equal((await h.POST(post(payload, "https://other.example"))).status, 403);
  assert.equal((await h.POST(post({ ...payload, postal_codes: ["97200", "97200"] }))).status, 422);
  assert.equal(h.calls.length, 0);
  const response = await h.POST(post(payload));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).replayed, true);
  assert.deepEqual(structuredClone(h.calls), [["write_coverage", {
    p_command_id: commandId, p_expected_version: 1, p_action: "publish", p_postal_codes: ["97200", "97202"],
  }]]);
  const wrong = harness(admin, { version: 2, postal_codes: ["97200"], replayed: true });
  assert.equal((await wrong.POST(post(payload))).status, 503);
  assert.equal((await harness(admin, null, "42501").GET(new Request(url))).status, 403);
});
