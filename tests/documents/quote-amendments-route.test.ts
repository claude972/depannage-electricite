import test from "node:test";
import assert from "node:assert/strict";
import { IDS, fakeServerHelpers, loadModule } from "./harness";

type Handler = (request: Request) => Promise<Response>;
const AMENDMENT = { id: IDS.amendment, version: 1, status: "proposed", total_cents: 14400 };
function harness(options: { authenticated?: boolean; data?: unknown; error?: { code: string } | null } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return { data: "data" in options ? options.data : AMENDMENT, error: options.error ?? null };
    },
  };
  const route = loadModule("app/api/quote-amendments/route.ts", { "@/lib/supabase/server": fakeServerHelpers({ authenticated: options.authenticated, db }) });
  const origin = "https://app.example.test";
  return {
    calls,
    post: (body: unknown, from = origin, query = "") => (route.POST as Handler)(new Request(`${origin}/api/quote-amendments${query}`, { method: "POST", headers: { "Content-Type": "application/json", origin: from }, body: JSON.stringify(body) })),
  };
}
const lines = [{ label: "Disjoncteur", quantity: 2, unit_price_cents: 6000 }];
const propose = { action: "propose", base_quote_id: IDS.quote, lines, tax_rate: 20, reason: "Travaux supplémentaires", valid_until: null };

test("propose forwards validated lines, rate, reason and validity; the server computes every amount", async () => {
  const h = harness();
  const response = await h.post({ ...propose, valid_until: "2999-12-31" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(h.calls, [{ name: "propose_quote_amendment", args: { p_base_quote_id: IDS.quote, p_lines: lines, p_tax_rate: 20, p_reason: "Travaux supplémentaires", p_valid_until: "2999-12-31" } }]);
  assert.deepEqual(await response.json(), { action: "propose", amendment: AMENDMENT });
  for (const patch of [
    { lines: [] },
    { lines: [{ label: "", quantity: 1, unit_price_cents: 100 }] },
    { lines: [{ label: "x", quantity: 0, unit_price_cents: 100 }] },
    { lines: [{ label: "x", quantity: 1.5, unit_price_cents: 100 }] },
    { lines: [{ label: "x", quantity: 1, unit_price_cents: -1 }] },
    { lines: [{ label: "x", quantity: 1, unit_price_cents: 100, total_cents: 100 }] },
    { lines: [{ label: "x", quantity: 1, unit_price_cents: 0 }] },
    { tax_rate: 7 },
    { reason: "" },
    { reason: "x".repeat(2001) },
    { valid_until: "2000-01-01" },
    { valid_until: "demain" },
    { total_cents: 14400 },
    { artisan_id: IDS.quote },
  ]) {
    const invalid = harness();
    assert.equal((await invalid.post({ ...propose, ...patch })).status, 422, JSON.stringify(patch));
    assert.equal(invalid.calls.length, 0);
  }
  const { valid_until: _omitted, ...withoutValidity } = propose;
  const missing = harness();
  assert.equal((await missing.post(withoutValidity)).status, 422);
  assert.equal(missing.calls.length, 0);
});
test("accept and reject send only the exact amendment id (and the rejection note); withdraw too", async () => {
  const accept = harness();
  assert.equal((await accept.post({ action: "accept", amendment_id: IDS.amendment })).status, 200);
  assert.deepEqual(accept.calls, [{ name: "decide_quote_amendment", args: { p_id: IDS.amendment, p_decision: "accepted", p_note: "" } }]);
  const reject = harness();
  assert.equal((await reject.post({ action: "reject", amendment_id: IDS.amendment, note: " Trop cher " })).status, 200);
  assert.deepEqual(reject.calls[0].args, { p_id: IDS.amendment, p_decision: "rejected", p_note: "Trop cher" });
  const withdraw = harness();
  assert.equal((await withdraw.post({ action: "withdraw", amendment_id: IDS.amendment })).status, 200);
  assert.deepEqual(withdraw.calls, [{ name: "withdraw_quote_amendment", args: { p_id: IDS.amendment } }]);
  for (const body of [
    { action: "accept", amendment_id: IDS.amendment, total_cents: 1 },
    { action: "accept", amendment_id: IDS.amendment, note: "x" },
    { action: "accept", amendment_id: "bad" },
    { action: "reject", amendment_id: IDS.amendment },
    { action: "reject", amendment_id: IDS.amendment, note: "x".repeat(2001) },
    { action: "withdraw" },
  ]) {
    const invalid = harness();
    assert.equal((await invalid.post(body)).status, 422, JSON.stringify(body));
    assert.equal(invalid.calls.length, 0);
  }
});
test("origin, session, query parameters and server refusals are handled before or as the server says", async () => {
  const foreign = harness();
  assert.equal((await foreign.post({ action: "accept", amendment_id: IDS.amendment }, "https://foreign.example.test")).status, 403);
  assert.equal(foreign.calls.length, 0);
  const query = harness();
  assert.equal((await query.post({ action: "accept", amendment_id: IDS.amendment }, undefined, "?x=1")).status, 422);
  assert.equal(query.calls.length, 0);
  assert.equal((await harness({ authenticated: false }).post({ action: "accept", amendment_id: IDS.amendment })).status, 401);
  for (const [code, status] of [["P0001", 409], ["23505", 409], ["42501", 403], ["P0002", 404], ["22023", 422], ["53300", 429]] as const) {
    const response = await harness({ error: { code } }).post({ action: "accept", amendment_id: IDS.amendment });
    assert.equal(response.status, status, code);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal((await harness({ data: null }).post({ action: "accept", amendment_id: IDS.amendment })).status, 503);
});
