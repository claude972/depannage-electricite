// CLI-10: POST /api/reviews answers an invalid body with a French message, never raw validator text.
import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";

const JOB = "20000000-0000-4000-8000-000000000001";
test("reviews: missing or invalid rating ⇒ 422 with a French message and no RPC; a valid review is forwarded", async () => {
  const calls: unknown[] = [];
  const server = fakeServerHelpers({ db: { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: { id: "r" }, error: null }; } } });
  const POST = loadModule("app/api/reviews/route.ts", { "@/lib/supabase/server": server }).POST as (r: Request) => Promise<Response>;
  const post = (body: unknown) => POST(new Request("https://app.example/api/reviews", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" }, body: JSON.stringify(body) }));
  for (const body of [{ intervention_id: JOB, body: "Bien" }, { intervention_id: JOB, rating: 6, body: "" }, { intervention_id: JOB, rating: "5", body: "" }]) {
    const r = await post(body);
    assert.equal(r.status, 422);
    const { error } = await r.json();
    assert.match(error, /note \(de 1 à 5\)/);
    assert.doesNotMatch(error, /Invalid|expected|received/);
  }
  assert.equal(calls.length, 0);
  assert.equal((await post({ intervention_id: JOB, rating: 5, body: "Bien" })).status, 201);
  assert.equal(JSON.stringify(calls), JSON.stringify([["submit_review", { p_intervention_id: JOB, p_rating: 5, p_body: "Bien" }]]));
});
