import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E07 — a manager with retained access cannot write equipment or a visit on an archived site", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, requester]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        user.id, user.email, { role: "manager", full_name: "Gestionnaire de recette" },
      ]);
    }
    const site = await asUser(db, actor, "select to_jsonb(public.create_site('Site QA','office','12 rue du Test',0,null)) v");
    await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'manager')", [site.organization_id, requester.id]);
    const plan = await asUser(db, requester, "select public.save_maintenance_plan($1,$2) v", [
      site.id, { equipment_id: null, title: "Visite QA", frequency_kind: "none", frequency_value: null,
        next_due_on: null, last_done_on: null, status: "active", notes: "" },
    ]);
    await asUser(db, actor, "select public.write_site_settings($1,$2,1,'archive',null) v", [site.id, randomUUID()]);
    assert.equal(await asUser(db, requester, "select public.can_manage_site($1) v", [site.id]), true);
    const payload = { name: "Tableau QA", category: "panel", criticality: "medium", location: "", reference: "",
      installed_on: null, status: "in_service", notes: "" };
    const day = new Date().toISOString().slice(0, 10);
    await withNext(db, async http => {
      const post = body => http("/api/site-operations", { method: "POST", body: JSON.stringify(body) });
      const equipment = await post({ action: "save_equipment", site_id: site.id, payload });
      const visit = await post({ action: "record_maintenance_visit", plan_id: plan.id, done_on: day, summary: "Recette", intervention_id: null });
      const counts = (await db.query(`select
        (select count(*)::int from public.site_equipment where site_id=$1) equipment,
        (select count(*)::int from public.site_maintenance_visits where site_id=$1) visits,
        (select count(*)::int from public.site_operations_events where site_id=$1 and entity in ('equipment','maintenance_visit')) events`, [site.id])).rows[0];
      assert.deepEqual([equipment.status, visit.status, counts], [409, 409, { equipment: 0, visits: 0, events: 0 }]);
      await assert.rejects(asUser(db, requester, "select public.save_site_equipment($1,$2) v", [site.id, payload]), error => error.code === "P0001");
      await assert.rejects(asUser(db, requester, "select public.record_maintenance_visit($1,$2,'Recette',null) v", [plan.id, day]), error => error.code === "P0001");
    }, {}, { users: [requester], rpcAllowlist: new Set(["save_site_equipment", "record_maintenance_visit"]) });
  } finally {
    await db.close();
  }
});
