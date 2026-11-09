import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

const path = "/api/public/callback";
const command = number => ({ request_id: randomUUID(), phone: `+120255501${String(number).padStart(2, "0")}`, reason: "other", consent: true });

async function withIntake(check) {
  const db = await freshDatabase();
  try {
    await withNext(db, async http => {
      const available = await http(path);
      assert.deepEqual(await available.json(), { available: true });
      const host = new URL(available.url);
      host.hostname = "localhost";
      const submit = (input, ip = "192.0.2.11") => http(path, { method: "POST", headers: {
        cookie: "", origin: host.origin, "x-vercel-forwarded-for": ip,
      }, body: JSON.stringify(input) });
      await check(submit, db);
    }, { SUPABASE_SERVICE_ROLE_KEY: serviceKey, PUBLIC_CALLBACK_INTAKE_ENABLED: "true", VERCEL: "1" }, {
      serviceRpcAllowlist: new Set(["submit_public_callback"]),
    });
  } finally {
    await db.close();
  }
}

test("E76 — one network can reach its quota without blocking a separate caller", async () => {
  await withIntake(async (submit, db) => {
    const first = command(0);
    const responses = [(await submit(first)).status];
    for (let number = 1; number < 30; number++) responses.push((await submit(command(number))).status);
    assert.deepEqual(responses, Array(30).fill(200));
    assert.equal((await submit(first)).status, 200, "the same request can be replayed at quota");
    const atLimit = await submit(command(30));
    const other = await submit(command(31), "198.51.100.27");
    assert.deepEqual([atLimit.status, other.status], [429, 200]);
    const retry = Number(atLimit.headers.get("retry-after"));
    assert.ok(retry >= 1 && retry <= 60);
    assert.equal((await db.query("select count(*)::int n from public.public_callback_requests")).rows[0].n, 31);
  });
});

test("E77 — Retry-After follows the rolling phone window across network changes", async () => {
  await withIntake(async (submit, db) => {
    const first = command(52);
    for (const input of [first, command(52), command(52)]) assert.equal((await submit(input)).status, 200);
    const blocked = await submit(command(52), "198.51.100.27");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 3595, "a newly saturated number must wait approximately one hour");
    await db.query("update public.public_callback_requests set created_at=clock_timestamp()-interval '62 seconds' where request_id=$1", [first.request_id]);
    const stillBlocked = await submit(command(52));
    assert.equal(stillBlocked.status, 429);
    assert.ok(Number(stillBlocked.headers.get("retry-after")) <= 3538 && Number(stillBlocked.headers.get("retry-after")) >= 3534);
    assert.equal((await submit(command(53))).status, 200);
    await db.query("update public.public_callback_requests set created_at=clock_timestamp()-interval '1 hour 1 second' where request_id=$1", [first.request_id]);
    assert.equal((await submit(command(52))).status, 200);
  });
});
