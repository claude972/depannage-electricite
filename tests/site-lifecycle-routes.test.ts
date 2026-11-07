import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const organization = "1f3ba36d-c370-4725-a150-1028eff421f3";
const id = "2346e5ab-4f0a-445f-b209-a21c00f86ab2";
const key = "6f716c08-d6ef-4437-a1db-5d63f9336463";
const settingsPath = "https://app.test/api/sites/" + id + "/settings";
const listPath = "https://app.test/api/organizations/" + organization + "/sites";
const values = { name: "Site QA", address: "Adresse de test", access_notes: "", opening_hours: [
  { day: 1, opens: "09:00", closes: "12:00" },
] };
const row = {
  ...values, id, organization_id: organization, type: "office", budget_cents: 10000,
  settings_version: 2, archived_at: null, created_at: "2026-11-07T12:00:00Z",
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cmd = { command_id: key, expected_version: 1, action: "save", values };
const post = (payload: unknown) => new Request(settingsPath, { method: "POST", body: JSON.stringify(payload) });

function load(path: string, db: object) {
  return loadModule(path, { "@/lib/supabase/server": fakeServerHelpers({ authenticated: true, db }) });
}

test("site settings saves exact expected version and rejects an incomplete or overlapping write", async () => {
  const requests: string[] = [];
  const db = { rpc: async (name: string) => { requests.push(name); return { error: null, data: row }; } };
  const { POST } = load("app/api/sites/[id]/settings/route.ts", db);
  const invalid = { ...cmd, values: { ...values, opening_hours: [...values.opening_hours, { day: 1, opens: "11:00", closes: "14:00" }] } };
  assert.equal((await POST(post(invalid), ctx(id))).status, 422);
  assert.deepEqual(requests, []);
  assert.equal((await POST(post(cmd), ctx(id))).status, 200);
  assert.deepEqual(requests, ["write_site_settings"]);
  const wrong = load("app/api/sites/[id]/settings/route.ts", { rpc: async () => ({ error: null, data: { ...row, settings_version: 3 } }) });
  assert.equal((await wrong.POST(post(cmd), ctx(id))).status, 503);
});

test("organization portfolio pages enforce scope and private cache policy", async () => {
  function stub(records: unknown[], count: number) {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q, not: () => q, gt: () => q,
      maybeSingle: async () => ({ error: null, data: { id: organization } }),
      then: (resolve: (r: unknown) => void) => resolve({ error: null, data: records, count }),
    };
    return load("app/api/organizations/[id]/sites/route.ts", { from: () => q });
  }
  const records = Array.from({ length: 51 }, (_, i) => ({ ...row, id: "2346e5ab-4f0a-445f-b209-" + String(i + 1).padStart(12, "0") }));
  const result = await stub(records, 51).GET(new Request(listPath), ctx(organization));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  const data = await result.json();
  assert.equal(data.sites.length, 50);
  assert.equal(data.next_after, records[49].id);
  assert.equal((await stub([], 1).GET(new Request(listPath), ctx(organization))).status, 503);
  assert.equal((await stub([{ ...row, organization_id: key }], 1).GET(new Request(listPath), ctx(organization))).status, 503);
});
