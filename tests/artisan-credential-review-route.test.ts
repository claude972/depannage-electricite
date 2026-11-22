import assert from "node:assert/strict";
import test from "node:test";
import { fakeServerHelpers, loadModule } from "./documents/harness";

const id = "36e427ac-298d-4df0-9d50-f837c3bbdf66";
const key = "6cc0193c-29a1-4dd5-b256-08c4fb4d36ee";
const path = "https://app.test/api/artisan/credentials/" + id + "/reviews";
const globalContext = { params: Promise.resolve({ id }) };
const reason = "Justificatif d’assurance illisible";
const entry = (version: number) => ({ version, reason, decision: "changes_requested", reviewed_at: "2026-11-07T12:00:00Z" });
const header = { credential_id: id, kind: "liability", expires_on: null, can_review: true };
const command = { command_id: key, expected_version: 0, decision: "changes_requested", reason };
const body = (value: unknown) => new Request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

function route(data: unknown, error: null | { code: string } = null) {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data, error }; } };
  const handlers = loadModule("app/api/artisan/credentials/[id]/reviews/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({ authenticated: true, db }),
  });
  type Handler = (request: Request, context: typeof globalContext) => Promise<Response>;
  return { GET: handlers.GET as Handler, POST: handlers.POST as Handler, calls };
}

test("history is private, paged and bound to the selected credential", async () => {
  const first = route({ ...header, current_version: 51, reviews: Array.from({ length: 51 }, (_, i) => entry(51 - i)) });
  const response = await first.GET(new Request(path), globalContext);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.reviews.length, 50);
  assert.equal(result.next_before, 2);
  const next = route({ ...header, current_version: 52, reviews: [entry(1)] });
  assert.equal((await next.GET(new Request(path + "?before=2"), globalContext)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(next.calls)), [{ name: "read_artisan_credential_reviews", args: { p_credential_id: id, p_before_version: 2 } }]);
});

test("a truncated or cross-dossier result fails rather than appearing as empty", async () => {
  for (const result of [
    { ...header, current_version: 1, reviews: [] },
    { ...header, credential_id: key, current_version: 0, reviews: [] },
    { ...header, current_version: 2, reviews: [entry(2), entry(2)] },
  ]) {
    const response = await route(result).GET(new Request(path), globalContext);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "2");
  }
  const denied = await route(null, { code: "P0002" }).GET(new Request(path), globalContext);
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
});

test("a decision forwards only its versioned command and validates the returned review", async () => {
  const payload = { credential_id: id, ...entry(1) };
  const server = route(payload);
  const response = await server.POST(body(command), globalContext);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { review: payload });
  assert.deepEqual(JSON.parse(JSON.stringify(server.calls)), [{ name: "review_artisan_credential", args: {
    p_credential_id: id, p_command_id: key, p_expected_version: 0,
    p_decision: command.decision, p_reason: reason,
  } }]);
  const forged = route(payload);
  assert.equal((await forged.POST(body({ ...command, reviewer_id: id }), globalContext)).status, 422);
  assert.equal(forged.calls.length, 0);
  assert.equal((await route({ ...payload, version: 2 }).POST(body(command), globalContext)).status, 503);
  assert.equal((await route(null, { code: "P0001" }).POST(body(command), globalContext)).status, 409);
});
