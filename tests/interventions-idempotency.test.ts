import test from "node:test";
import assert from "node:assert/strict";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const ID = "10000000-0000-4000-8000-000000000001";
const payload = { category: "socket", description: "Une prise ne fonctionne plus", address: "Adresse de test", postal_code: "97200", city: "Commune", urgency: "scheduled" };
function setup({ authenticated = true, error = null as { code: string } | null } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { id: ID }, error }; } };
  const mod = loadModule("app/api/interventions/route.ts", { "@/lib/supabase/server": fakeServerHelpers({ db, authenticated }), "../workspace/route": { GET: () => "unchanged" } });
  const post = (value: unknown, origin = "https://preview.example.test") => (mod.POST as (r: Request) => Promise<Response>)(new Request("https://preview.example.test/api/interventions", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(value) }));
  return { calls, post };
}
test("omitted request_id preserves old RPC/payload/201; present UUID chooses once RPC only", async () => {
  for (const keyed of [false, true]) {
    const r = setup();
    const response = await r.post({ ...payload, description: "  " + payload.description + "  ", ...(keyed ? { request_id: ID } : {}) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { intervention: { id: ID } });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].name, keyed ? "create_intervention_once" : "create_intervention");
    assert.equal(JSON.stringify(r.calls[0].args), JSON.stringify({ ...(keyed ? { p_request_id: ID } : {}), p_category: payload.category, p_description: payload.description, p_address: payload.address, p_postal_code: payload.postal_code, p_city: payload.city, p_urgency: payload.urgency, p_site_id: null }));
  }
});
test("request_id is optional but never null/empty/malformed; unknown fields and Auth/origin refusals do not call RPC", async () => {
  for (const request_id of [null, "", "not-a-uuid", 4, {}, "../admin"]) {
    const r = setup(); assert.equal((await r.post({ ...payload, request_id })).status, 422); assert.equal(r.calls.length, 0);
  }
  const extra = setup(); assert.equal((await extra.post({ ...payload, request_id: ID, actor_id: ID })).status, 422); assert.equal(extra.calls.length, 0);
  const anon = setup({ authenticated: false }); assert.equal((await anon.post({ ...payload, request_id: ID })).status, 401); assert.equal(anon.calls.length, 0);
  const cross = setup(); assert.equal((await cross.post({ ...payload, request_id: ID }, "https://foreign.example.test")).status, 403); assert.equal(cross.calls.length, 0);
});
test("existing DB conflict/access/unavailable status mapping is retained for keyed calls", async () => {
  for (const [code, expected] of [["P0001", 409], ["42501", 403], ["XX000", 503]] as const) {
    // Use the actual shared error translator for this mapping, with only auth/client creation replaced.
    const helpers = loadModule("lib/supabase/server.ts", { "next/headers": { cookies: async () => ({ getAll: () => [], set: () => {} }) } });
    const stub = fakeServerHelpers({ db: { rpc: async () => ({ data: null, error: { code } }) } });
    const mod = loadModule("app/api/interventions/route.ts", { "@/lib/supabase/server": { ...helpers, authenticatedClient: stub.authenticatedClient }, "../workspace/route": { GET: () => null } });
    const response = await (mod.POST as (r: Request) => Promise<Response>)(new Request("https://preview.example.test/api/interventions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, request_id: ID }) }));
    assert.equal(response.status, expected);
  }
});
