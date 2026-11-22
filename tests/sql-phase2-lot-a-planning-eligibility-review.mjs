import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, requester, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E37 — a current planned leave hides an urgent offer and refuses stale acceptance", async () => {
  const db = await freshDatabase();
  try {
    for (const [user, role] of [[actor, "artisan"], [requester, "client"]]) {
      await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)", [
        user.id, user.email, { role, full_name: "Compte de recette" },
      ]);
    }
    await db.query("update public.profiles set artisan_approved=true where id=$1", [actor.id]);
    await db.query(`insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)
      values($1,'Artisan QA','00000000000000','Adresse QA',array['97200'],array['socket'],'approved',true)`, [actor.id]);
    const jobs = await db.query(`insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
      values($1,'socket','Urgence fictive','Adresse privée','97200','Fort-de-France','urgent',100,200),
            ($1,'socket','Demande planifiable fictive','Adresse privée','97200','Fort-de-France','scheduled',100,200)
      returning id, urgency`, [requester.id]);
    const urgent = jobs.rows.find(job => job.urgency === "urgent").id;
    const scheduled = jobs.rows.find(job => job.urgency === "scheduled").id;
    const instant = Date.now();
    const time = minutes => new Date(instant + minutes * 60_000).toISOString();
    await withNext(db, async http => {
      const post = (path, body) => http(path, { method: "POST", body: JSON.stringify(body) });
      const plan = (kind, start, end) => post("/api/planning", {
        action: "save_entry", request_id: randomUUID(), kind, starts_at: time(start), ends_at: time(end), title: "Recette", note: "",
      });
      const feed = id => http(`/api/artisan/missions?id=${id}`);
      const accept = () => post(`/api/interventions/${urgent}/actions`, { action: "accept_mission" });
      assert.equal((await plan("available", -60, 180)).status, 200);
      assert.equal((await plan("unavailable", 181, 210)).status, 200);
      assert.equal((await feed(urgent)).status, 200, "future leave does not block immediate requests");
      const leave = await plan("unavailable", -60, 180);
      assert.equal(leave.status, 200);
      const { entry } = await leave.json();
      const response = await http(`/api/planning?${new URLSearchParams({ from: time(-30), to: time(120) })}`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).free, []);
      const statuses = [(await feed(urgent)).status, (await accept()).status, (await feed(scheduled)).status];
      const stored = (await db.query("select status,artisan_id from public.interventions where id=$1", [urgent])).rows[0];
      assert.deepEqual([statuses, stored], [[404, 403, 200], { status: "requested", artisan_id: null }]);
      assert.equal((await post("/api/planning", { action: "delete_entry", id: entry.id, expected_version: entry.version })).status, 200);
      assert.equal((await feed(urgent)).status, 200);
      assert.equal((await accept()).status, 200);
      assert.deepEqual((await db.query("select status,artisan_id from public.interventions where id=$1", [urgent])).rows[0],
        { status: "assigned", artisan_id: actor.id });
    }, {}, {
      rpcAllowlist: new Set(["save_planning_entry", "delete_planning_entry", "artisan_planning", "available_missions_page", "intervention_action"]),
      async handle(request, _response, { user, send }) {
        if (request.method !== "GET" || !request.url?.startsWith("/rest/v1/profiles?")) return false;
        const profile = (await db.query("select role from public.profiles where id=$1", [user.id])).rows[0];
        send(200, profile);
        return true;
      },
    });
  } finally {
    await db.close();
  }
});
