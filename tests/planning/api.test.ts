import test from "node:test";
import assert from "node:assert/strict";
import { harness, uuid, type Handler } from "./harness";
const JOB = uuid(7, "70000000");
function routes(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  const planning = h.load("app/api/planning/route.ts"), slots = h.load("app/api/planning/slots/route.ts");
  return {
    ...h,
    get: (query = "") => (planning.GET as Handler)(h.request(`/api/planning${query ? `?${query}` : ""}`)),
    post: (body: unknown, origin?: string) => (planning.POST as Handler)(h.request("/api/planning", body, origin)),
    slots: (query: string) => (slots.GET as Handler)(h.request(`/api/planning/slots?${query}`)),
  };
}
const rule = { action: "save_rule", request_id: uuid(1, "90000000"), weekday: 1, start_minute: 480, end_minute: 720 };
const entry = { action: "save_entry", request_id: uuid(2, "90000000"), kind: "busy", starts_at: "2026-11-02T08:00:00-04:00", ends_at: "2026-11-02T09:30:00-04:00", title: "Fournisseur", note: "" };

test("GET planning defaults to the current Martinique week with explicit offsets and forwards explicit ranges", async () => {
  const h = routes({ rpcData: { range: {}, rules: [], entries: [], appointments: [], free: [], limits: {}, permissions: { can_edit: true, reason: null } } });
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const call = h.requests.find(r => r.table === "artisan_planning")!;
  assert.match(String(call.args!.p_from), /T00:00:00-04:00$/);
  assert.match(String(call.args!.p_to), /T00:00:00-04:00$/);
  assert.equal(Date.parse(String(call.args!.p_to)) - Date.parse(String(call.args!.p_from)), 7 * 86400000);
  assert.equal((await response.json()).permissions.can_edit, true);
  const explicit = routes({ rpcData: { ok: true } });
  assert.equal((await explicit.get("from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z")).status, 200);
  assert.deepEqual(explicit.requests.find(r => r.table === "artisan_planning")!.args, { p_from: "2026-11-02T04:00:00Z", p_to: "2026-11-09T04:00:00Z" });
});
test("GET planning fails closed on bad ranges, unknown parameters, roles and empty answers", async () => {
  for (const query of ["from=2026-11-02T04:00:00Z", "from=2026-11-02T04:00:00Z&to=2027-01-04T04:00:00Z", "from=2026-11-09T04:00:00Z&to=2026-11-02T04:00:00Z", "from=2026-11-02T04:00:00&to=2026-11-09T04:00:00", "from=2026-11-02&to=2026-11-09", "week=1", "from=2026-11-02T04:00:00Z&from=2026-11-03T04:00:00Z&to=2026-11-09T04:00:00Z"]) {
    const h = routes(); assert.equal((await h.get(query)).status, 422, query); assert.equal(h.requests.some(r => r.table === "artisan_planning"), false, query);
  }
  for (const role of ["client", "manager", "admin"]) { const h = routes({ role }); assert.equal((await h.get()).status, 403, role); assert.equal(h.requests.some(r => r.table === "artisan_planning"), false); }
  assert.equal((await routes({ role: null }).get()).status, 401);
  assert.equal((await routes({ rpcData: null }).get()).status, 503);
  assert.equal((await routes({ rpcError: "42501" }).get()).status, 403);
});
test("POST planning forwards strict commands with server-only defaults and rejects malformed or spoofed bodies", async () => {
  const h = routes({ rpcData: { rule: { id: uuid(3) }, replayed: false } });
  assert.equal((await h.post(rule)).status, 200);
  assert.deepEqual(h.requests.find(r => r.table === "save_availability_rule")!.args, { p_request_id: rule.request_id, p_id: null, p_weekday: 1, p_start_minute: 480, p_end_minute: 720, p_time_zone: "America/Martinique", p_valid_from: null, p_valid_until: null, p_expected_version: null });
  const update = routes({ rpcData: { rule: {}, replayed: false } });
  assert.equal((await update.post({ ...rule, id: uuid(3), expected_version: 2, time_zone: "Europe/Paris", valid_from: "2026-11-01", valid_until: null })).status, 200);
  assert.equal(update.requests.find(r => r.table === "save_availability_rule")!.args!.p_expected_version, 2);
  assert.equal(update.requests.find(r => r.table === "save_availability_rule")!.args!.p_time_zone, "Europe/Paris");
  const entries = routes({ rpcData: { entry: {}, replayed: false } });
  assert.equal((await entries.post(entry)).status, 200);
  assert.deepEqual(entries.requests.find(r => r.table === "save_planning_entry")!.args, { p_request_id: entry.request_id, p_id: null, p_kind: "busy", p_starts_at: entry.starts_at, p_ends_at: entry.ends_at, p_title: "Fournisseur", p_note: "", p_expected_version: null });
  const removal = routes({ rpcData: { deleted: true, id: uuid(4) } });
  assert.equal((await removal.post({ action: "delete_entry", id: uuid(4), expected_version: 1 })).status, 200);
  assert.deepEqual(removal.requests.find(r => r.table === "delete_planning_entry")!.args, { p_id: uuid(4), p_expected_version: 1 });
  assert.equal((await routes({ rpcData: { deleted: true } }).post({ action: "delete_rule", id: uuid(4), expected_version: 3 })).status, 200);
  for (const body of [
    { ...rule, artisan_id: uuid(9) }, { ...rule, weekday: 8 }, { ...rule, end_minute: 480 }, { ...rule, expected_version: 1 }, { ...rule, id: uuid(3) },
    { ...rule, valid_from: "2026-12-01", valid_until: "2026-11-01" }, { ...rule, time_zone: "Mars/Olympus; drop" }, { action: "save_rule" },
    { ...entry, kind: "holiday" }, { ...entry, ends_at: entry.starts_at }, { ...entry, ends_at: "2026-12-05T08:00:00-04:00" }, { ...entry, starts_at: "2026-11-02T08:00:00" }, { ...entry, title: "x".repeat(161) }, { ...entry, note: "a\u0000b" },
    { action: "delete_entry", id: uuid(4) }, { action: "delete_rule", id: "not-a-uuid", expected_version: 1 }, { action: "unknown" },
  ]) { const invalid = routes(); assert.equal((await invalid.post(body)).status, 422, JSON.stringify(body)); assert.equal(invalid.requests.some(r => r.args), false); }
  const foreign = routes(); assert.equal((await foreign.post(rule, "https://foreign.example.test")).status, 403); assert.equal(foreign.requests.length, 0);
  assert.equal((await routes().post(rule, undefined)).status, 200);
  const h2 = routes(); const withQuery = await (h2.load("app/api/planning/route.ts").POST as Handler)(h2.request("/api/planning?x=1", rule)); assert.equal(withQuery.status, 422);
});
test("SQL refusals keep their meaning (conflict, forbidden, quota, validation) and are never cached", async () => {
  for (const [code, expected] of [["P0001", 409], ["42501", 403], ["53300", 429], ["22023", 422], ["P0002", 404]] as const) {
    const response = await routes({ rpcError: code }).post(entry); assert.equal(response.status, expected, code); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal((await routes({ rpcData: null }).post(rule)).status, 503);
  assert.equal((await routes({ role: null }).post(rule)).status, 401);
});
test("free slots are requested per dossier with a bounded range and surface SQL refusals", async () => {
  const h = routes({ rpcData: { intervention_id: JOB, slots: [], availability_declared: false } });
  const response = await h.slots(`intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z`);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(h.requests.find(r => r.table === "intervention_free_slots")!.args, { p_intervention_id: JOB, p_from: "2026-11-02T04:00:00Z", p_to: "2026-11-09T04:00:00Z" });
  for (const query of ["from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z", `intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-12-05T04:00:00Z`, `intervention_id=bad&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z`, `intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z&artisan_id=${uuid(2)}`]) {
    const invalid = routes(); assert.equal((await invalid.slots(query)).status, 422, query); assert.equal(invalid.requests.some(r => r.args), false);
  }
  assert.equal((await routes({ rpcError: "P0001" }).slots(`intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z`)).status, 409);
  assert.equal((await routes({ rpcError: "42501" }).slots(`intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z`)).status, 403);
  assert.equal((await routes({ role: "client", rpcData: null }).slots(`intervention_id=${JOB}&from=2026-11-02T04:00:00Z&to=2026-11-09T04:00:00Z`)).status, 503);
});
