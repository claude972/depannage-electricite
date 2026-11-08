import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E18 — retrying the same work report after response loss returns the original without duplicate evidence", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)", [
      actor.id, actor.email, { role: "artisan", full_name: "Artisan de recette" },
      requester.id, requester.email, { role: "client", full_name: "Client de recette" },
    ]);
    await db.query("update public.profiles set artisan_approved=true where id=$1", [actor.id]);
    const id = randomUUID();
    await db.query(`insert into public.interventions(id, client_id, artisan_id, category, description,
      address, postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents)
      values($1,$2,$3,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','in_progress',10000,20000)`, [
      id, requester.id, actor.id,
    ]);
    const fields = { action: "save_report", summary: "Contrôle électrique synthétique", checks: [], signature_name: "Déclarant de recette" };
    const command = { ...fields, command_id: randomUUID() };
    const route = `/api/interventions/${id}/operations`;
    await withNext(db, async http => {
      const post = body => http(route, { method: "POST", body: JSON.stringify(body) });
      const keyed = await post(command);
      const first = keyed.ok ? keyed : await post(fields);
      assert.equal(first.status, 200);
      const initial = await first.json(); // held by the fixture, never used to decide the retry
      const second = await post(keyed.ok ? command : fields);
      assert.equal(second.status, 200);
      const counts = (await db.query(`select
        (select count(*)::int from public.audit_log where intervention_id=$1 and action='report_saved') audits,
        (select count(*)::int from public.intervention_operation_events where intervention_id=$1 and kind='report') snapshots`, [id])).rows[0];
      assert.deepEqual([keyed.status, counts], [200, { audits: 1, snapshots: 1 }]);
      assert.deepEqual(await second.json(), initial);
      assert.equal((await post({ ...command, summary: "Contenu différent pour la même intention" })).status, 409);
      assert.equal((await post(fields)).status, 422);
      await assert.rejects(asUser(db, actor, "select public.save_intervention_report($1,$2,'[]'::jsonb,$3) v", [
        id, fields.summary, fields.signature_name,
      ]), error => error.code === "42501");
    }, {}, { rpcAllowlist: new Set(["save_intervention_report"]) });
  } finally {
    await db.close();
  }
});
