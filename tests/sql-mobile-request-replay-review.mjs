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
      const changedEstimate = await post(JSON.stringify({ ...payload, request_id: requestId, reviewed_estimate_version: 2 }));
      assert.equal(changedEstimate.status, 409);
      assert.equal((await changedEstimate.json()).code, "estimate_review_required");
      await db.query(`insert into public.action_limits(actor_id,action,window_start,count)
        select $1,'create_intervention',date_trunc('minute',now()) + minute_offset * interval '1 minute',5
        from generate_series(0,1) minute_offset`, [requester.id]);
      assert.equal((await post(body)).status, 429);
      await db.query("update public.action_limits set count=0 where actor_id=$1 and action='create_intervention'", [requester.id]);

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
        const expired = await http(route, { method: "POST", body, headers: { authorization: "Bearer invalid.expired.token" } }, requester, "bearer");
        assert.equal(expired.status, 401);
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
    }, {}, {
      users: [requester],
      rpcAllowlist: new Set(["create_intervention_once_reviewed"]),
      sqlMessageAllowlist: new Set(["Estimate review required"]),
    });
    const jobs = await db.query("select count(*)::int as count from public.interventions where client_id=$1", [requester.id]);
    const key = await db.query("select count(*)::int as count from public.intervention_request_keys where actor_id=$1 and request_id=$2", [requester.id, requestId]);
    assert.equal(jobs.rows[0].count, 1);
    assert.equal(key.rows[0].count, 1);
  } finally { await db.close(); }
});
