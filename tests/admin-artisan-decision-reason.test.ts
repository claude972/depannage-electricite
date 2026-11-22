// ADM-02 — application-level decisions: a negative decision (corrections, refusal, suspension,
// reopening) is refused with 422 before any SQL command when its reason is missing or too short;
// with a reason the decision runs and the reason is written once to the artisan's decision log.
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(options: { role?: string; last?: unknown; status?: string } = {}) {
  const calls: { table: string; method: string; body: unknown }[] = [];
  const db = createClient("https://example.supabase.co", "fake-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), table = url.pathname.split("/").at(-1)!;
    let body: unknown = null; try { body = JSON.parse(String(init?.body)); } catch {}
    calls.push({ table, method: init?.method ?? "GET", body });
    if (table === "decide_artisan_application") return Response.json(null);
    if (table === "profiles") return Response.json({ role: options.role ?? "admin" });
    if (table === "artisan_profiles") return Response.json({ application_status: options.status ?? "changes_requested", application_version: 4 });
    if (table === "notifications") return init?.method === "POST" ? Response.json(null, { status: 201 }) : Response.json(options.last === undefined ? [] : [{ payload: options.last }]);
    return Response.json([]);
  } } });
  const mod = loadModule("app/api/admin/artisans/route.ts", { "@/lib/supabase/server": { ...fakeServerHelpers({ db }), adminClient: () => db } });
  const post = (body: Record<string, unknown>) => (mod.POST as (r: Request) => Promise<Response>)(new Request("https://app.example.test/api/admin/artisans", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example.test" }, body: JSON.stringify({ user_id: id(1), command_id: id(99), expected_version: 4, ...body }) }));
  return { calls, post };
}
const rpcCalls = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.table === "decide_artisan_application");
const logWrites = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c.table === "notifications" && c.method === "POST");

test("negative decisions without a sufficient reason are 422 and reach neither the SQL command nor the log", async () => {
  for (const body of [{ action: "request_changes" }, { action: "suspend" }, { action: "request_changes", definitive: true }, { action: "suspend", reason: "court" }, { action: "request_changes", reason: "   " }, { action: "reopen" }, { action: "reopen", reason: "court" }]) {
    const f = fixture(); const r = await f.post(body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.match((await r.json()).error, /motif/i, JSON.stringify(body));
    assert.equal(rpcCalls(f).length, 0); assert.equal(logWrites(f).length, 0);
  }
});

test("a reasoned negative decision runs once and records its reason for the artisan; a refusal is marked definitive", async () => {
  const f = fixture(); const r = await f.post({ action: "request_changes", definitive: true, reason: "Activité hors périmètre, candidature non retenue." });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { success: true, reason_recorded: true });
  assert.equal((rpcCalls(f)[0].body as { p_action: string }).p_action, "request_changes");
  const written = logWrites(f)[0].body as { recipient_id: string; title: string; payload: Record<string, unknown>; dedupe_key: string };
  assert.equal(written.recipient_id, id(1)); assert.equal(written.title, "Candidature refusée");
  assert.deepEqual(written.payload, { application_decision: "request_changes", reason: "Activité hors périmètre, candidature non retenue.", application_version: 4, definitive: true });
  assert.equal(written.dedupe_key, `application-decision:${id(99)}`);
  const g = fixture(); assert.equal((await g.post({ action: "suspend", definitive: true, reason: "Motif suffisamment long." })).status, 422);
  assert.equal(rpcCalls(g).length, 0);
});

test("approval and reactivation keep an optional reason", async () => {
  for (const action of ["approve", "reinstate"]) { const f = fixture(); assert.equal((await f.post({ action })).status, 200); assert.equal(rpcCalls(f).length, 1); assert.equal(logWrites(f).length, 0); }
});

test("reopen: administrators only, only for a refused application, never through the SQL decision command", async () => {
  const reason = "Pièces reçues par l’assistance, dossier rouvert.";
  const refused = fixture({ last: { application_decision: "request_changes", definitive: true } });
  assert.equal((await refused.post({ action: "reopen", reason })).status, 200);
  assert.equal(rpcCalls(refused).length, 0);
  assert.equal((logWrites(refused)[0].body as { payload: { reopened: boolean } }).payload.reopened, true);
  assert.equal((await fixture({ last: { application_decision: "request_changes" } }).post({ action: "reopen", reason })).status, 409);
  assert.equal((await fixture({ last: { application_decision: "request_changes", definitive: true }, status: "submitted" }).post({ action: "reopen", reason })).status, 409);
  const outsider = fixture({ role: "artisan", last: { application_decision: "request_changes", definitive: true } });
  assert.equal((await outsider.post({ action: "reopen", reason })).status, 403); assert.equal(logWrites(outsider).length, 0);
});
