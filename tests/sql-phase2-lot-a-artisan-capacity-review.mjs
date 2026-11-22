import assert from "node:assert/strict";
import test from "node:test";
import { actor, assignee, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

function artisanGateway(db) {
  return async (request, _response, { user, send }) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET") return false;
    if (url.pathname === "/rest/v1/profiles") {
      send(200, await asUser(db, user, "select jsonb_build_object('role',role) v from public.profiles where id=$1", [user.id]));
      return true;
    }
    if (url.pathname === "/rest/v1/artisan_profiles") {
      const row = await asUser(db, user, "select to_jsonb(p) v from public.artisan_profiles p where user_id=$1", [url.searchParams.get("user_id").slice(3)]);
      send(200, row ? [row] : []);
      return true;
    }
    if (url.pathname === "/rest/v1/artisan_credentials") {
      send(200, []);
      return true;
    }
    return false;
  };
}

test("E75 — three active missions by default, four by choice, same limit for listing and assignment", async () => {
  const db = await freshDatabase();
  try {
    for (const [user, role] of [[actor, "artisan"], [assignee, "artisan"], [requester, "client"]]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [user.id, user.email, { role, full_name: "Compte QA" }]);
    }
    await db.query("update public.profiles set artisan_approved=true where id=$1", [actor.id]);
    await db.query(`insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available)
      values($1,'QA','00000000000000','Adresse QA',array['97200'],array['socket'],'approved',true)`, [actor.id]);
    const jobs = (await db.query(`insert into public.interventions(client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
      select $1,'socket','Intervention QA','Adresse fictive','97200','Fort-de-France','urgent',100,200 from generate_series(1,5)
      returning id`, [requester.id])).rows;
    await db.query(`insert into public.interventions(client_id,artisan_id,status,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents)
      values($1,$2,'completed','socket','Règlement à attendre','Adresse fictive','97200','Fort-de-France','urgent',100,200)`, [requester.id, actor.id]);
    await withNext(db, async http => {
      const path = "/api/artisan";
      const update = (value, expected, user = actor) => http(path, { method: "POST", body: JSON.stringify({
        action: "set_capacity_limit", capacity_limit: value, expected_version: expected,
      }) }, user);
      const initial = await http(path);
      assert.equal(initial.status, 200);
      const initialProfile = (await initial.json()).artisan_profile;
      const accept = job => http(`/api/interventions/${job.id}/actions`, {
        method: "POST", body: JSON.stringify({ action: "accept_mission" }),
      });
      const offers = async () => {
        const response = await http("/api/artisan/missions");
        assert.equal(response.status, 200);
        return (await response.json()).items.length;
      };
      assert.deepEqual([initialProfile.capacity_limit, initialProfile.capacity_version], [3, 0]);
      assert.equal(await offers(), 5);
      for (const job of jobs.slice(0, 3)) assert.equal((await accept(job)).status, 200);
      assert.equal(await offers(), 0);
      assert.equal((await accept(jobs[3])).status, 403);
      assert.equal((await update(5, 0)).status, 422);
      assert.equal((await update(4, 0, requester)).status, 403);
      assert.equal((await http(`${path}?user_id=${actor.id}`, {}, assignee)).status, 403);
      const changed = await update(4, 0);
      assert.equal(changed.status, 200);
      const profile = (await changed.json()).artisan_profile;
      assert.deepEqual([profile.capacity_limit, profile.capacity_version, profile.application_status], [4, 1, "approved"]);
      assert.equal(await offers(), 2);
      assert.equal((await accept(jobs[3])).status, 200);
      assert.equal(await offers(), 0);
      await db.query("update public.profiles set role='admin' where id=$1", [assignee.id]);
      await assert.rejects(
        asUser(db, assignee, "select public.reassign_intervention($1,$2,'Réaffectation QA') v", [jobs[4].id, actor.id]),
        error => error.code === "P0001" && error.message === "artisan_mission_capacity_reached",
      );
      assert.equal((await update(null, 0)).status, 409);
      assert.equal((await update(null, 1)).status, 200);
      assert.deepEqual(await asUser(db, actor, "select jsonb_build_array(capacity_limit,capacity_version) v from public.artisan_profiles where user_id=$1", [actor.id]), [null, 2]);
      await db.query("update public.interventions set status='cancelled' where id=any($1::uuid[])", [jobs.slice(0,2).map(j => j.id)]);
      assert.equal(await offers(), 1, "a closed mission frees a slot");
      assert.equal((await accept(jobs[4])).status, 200);
      await db.query("update public.artisan_profiles set application_status='suspended' where user_id=$1", [actor.id]);
      assert.equal((await update(4, 2)).status, 403);
    }, {}, { users: [actor, assignee, requester], rpcAllowlist: new Set(["set_artisan_capacity_limit", "available_missions_page", "intervention_action"]), handle: artisanGateway(db) });
  } finally {
    await db.close();
  }
});
