import assert from "node:assert/strict";
import test from "node:test";
import { actor, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E69 — the actual SDK's missing-session error asks the user to sign in again", async () => {
  let upstream = "session_not_found";
  let revocations = 0;
  async function handle(request, _response, { user, send }) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/auth/v1/logout") return false;
    assert.equal(user.id, actor.id);
    assert.equal(request.method, "POST");
    assert.equal(url.searchParams.get("scope"), "others");
    revocations++;
    if (upstream === "ok") send(204, null);
    else if (upstream === "temporary") send(503, { code: 503, error_code: "unexpected_failure", msg: "Fixture failure" });
    else send(403, { code: 403, error_code: upstream, msg: "Fixture refusal" });
    return true;
  }
  await withNext(null, async http => {
    const revoke = () => http("/api/profile/sessions", {
      method: "POST", body: JSON.stringify({ action: "revoke_others", user_id: actor.id }),
    });
    const missing = await revoke();
    assert.equal(missing.status, 401, JSON.stringify(await missing.clone().json()));
    assert.match((await missing.json()).error, /Reconnectez-vous/);
    assert.equal(missing.headers.get("cache-control"), "private, no-store");
    upstream = "bad_jwt";
    assert.equal((await revoke()).status, 401);
    upstream = "temporary";
    assert.equal((await revoke()).status, 503);
    upstream = "ok";
    assert.deepEqual(await (await revoke()).json(), { revoked_other_sessions: true });
    assert.equal(revocations, 4);
  }, {}, { handle });
});
