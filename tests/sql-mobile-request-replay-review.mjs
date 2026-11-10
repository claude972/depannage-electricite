import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { requester, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("mobile Bearer route: a lost response and three exact replays yield one intervention", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
      requester.id, requester.email, { role: "client", full_name: "Client de recette" },
    ]);
    const payload = {
      category: "socket", description: "Plusieurs prises sans courant",
      address: "Adresse de recette", postal_code: "97200", city: "Fort-de-France",
      urgency: "scheduled", reviewed_estimate_version: 1,
    };
    const requestId = randomUUID();
    const body = JSON.stringify({ ...payload, request_id: requestId });
    await withNext(db, async http => {
      const route = "/api/interventions";
      const post = body => http(route, { method: "POST", body }, requester, "bearer");
      assert.equal((await post(JSON.stringify(payload))).status, 422);
      const initial = [];
      const relay = createServer(async (request, response) => {
        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const received = Buffer.concat(chunks).toString("utf8");
          const upstream = await post(received);
          initial.push({ status: upstream.status, data: await upstream.json(), body: received });
        } catch (error) {
          initial.push({ error });
        } finally {
          response.destroy();
        }
      });
      try {
        relay.listen(0, "127.0.0.1");
        await once(relay, "listening");
        const url = `http://127.0.0.1:${relay.address().port}${route}`;
        await assert.rejects(fetch(url, { method: "POST", body, signal: AbortSignal.timeout(20_000) }), { message: "fetch failed" });
        assert.equal(initial.length, 1);
        assert.equal(initial[0].status, 201, String(initial[0].error ?? ""));
        assert.equal(initial[0].body, body);
        const id = initial[0].data.intervention.id;
        for (let attempt = 0; attempt < 3; attempt++) {
          const replay = await post(body);
          assert.equal(replay.status, 201);
          assert.equal((await replay.json()).intervention.id, id);
        }
        const conflict = await post(JSON.stringify({ ...payload, request_id: requestId, address: "Autre adresse de recette" }));
        assert.equal(conflict.status, 409);
      } finally {
        relay.closeAllConnections();
        await new Promise(resolve => relay.close(resolve));
      }
    }, {}, { users: [requester], rpcAllowlist: new Set(["create_intervention_once_reviewed"]) });
    const jobs = await db.query("select count(*)::int as count from public.interventions where client_id=$1", [requester.id]);
    const key = await db.query("select count(*)::int as count from public.intervention_request_keys where actor_id=$1 and request_id=$2", [requester.id, requestId]);
    assert.equal(jobs.rows[0].count, 1);
    assert.equal(key.rows[0].count, 1);
  } finally { await db.close(); }
});
