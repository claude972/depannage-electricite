import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const site = "2346e5ab-4f0a-445f-b209-a21c00f86ab2";
const approval = "6f716c08-d6ef-4437-a1db-5d63f9336463";
const post = (payload: unknown) => new Request("https://app.test/api/professional", { method: "POST", body: JSON.stringify(payload) });

function load(archivedAt: string | null) {
  const calls: string[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: null, data: { id: site, archived_at: archivedAt } }) }) }) }),
    rpc: async (name: string) => { calls.push(name); return { error: null, data: null }; },
  };
  const handlers = loadModule("app/api/professional/route.ts", { "@/lib/supabase/server": fakeServerHelpers({ authenticated: true, db }) });
  return { POST: handlers.POST as (request: Request) => Promise<Response>, calls };
}

test("ENT-12 : un refus d’approbation sans commentaire est refusé (422) avant tout appel", async () => {
  const { POST, calls } = load(null);
  const blank = await POST(post({ action: "decide_approval", approval_id: approval, decision: "rejected", note: "   " }));
  assert.equal(blank.status, 422);
  assert.match((await blank.json()).error, /commentaire est obligatoire/);
  assert.equal((await POST(post({ action: "decide_approval", approval_id: approval, decision: "rejected" }))).status, 422);
  assert.deepEqual(calls, []);
  assert.equal((await POST(post({ action: "decide_approval", approval_id: approval, decision: "rejected", note: "Hors budget" }))).status, 200);
  assert.equal((await POST(post({ action: "decide_approval", approval_id: approval, decision: "approved" }))).status, 200);
  assert.deepEqual(calls, ["decide_approval", "decide_approval"]);
});

test("ENT-03 : un site archivé refuse budget, échéance et règle d’approbation (409)", async () => {
  const commands = [
    { action: "set_site_budget", site_id: site, budget_cents: 7 },
    { action: "save_compliance", site_id: site, title: "Audit", kind: "audit", due_on: "2027-01-01", status: "pending" },
    { action: "set_approval_rule", site_id: site, threshold_cents: 1000, required_role: "owner", enabled: true },
  ];
  const archived = load("2026-11-20T10:00:00Z");
  for (const command of commands) {
    const response = await archived.POST(post(command));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /archivé/);
  }
  assert.deepEqual(archived.calls, []);
  const active = load(null);
  for (const command of commands) assert.equal((await active.POST(post(command))).status, 200);
  assert.deepEqual(active.calls, ["set_site_budget", "save_compliance", "set_approval_rule"]);
});
