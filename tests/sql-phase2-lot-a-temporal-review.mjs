import assert from "node:assert/strict";
import test from "node:test";
import { actor, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

async function siteFixture(db) {
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
    actor.id, actor.email, { role: "manager", full_name: "Gestionnaire de recette" },
  ]);
  return asUser(db, actor, "select to_jsonb(public.create_site('Site QA','office','12 rue du Test',0,null)) v");
}

test("E21 — future opening, response and resolution are refused in HTTP and SQL", async () => {
  const db = await freshDatabase();
  try {
    const site = await siteFixture(db);
    const policy = await asUser(db, actor, "select public.save_sla_policy($1,$2) v", [
      site.id, { name: "Politique QA", status: "active", calendar_id: null, urgency: null, response_target_minutes: 60, resolution_target_minutes: 120 },
    ]);
    const date = (delta) => new Date(Date.now() + delta * 3_600_000).toISOString();
    const future = {
      policy_id: policy.id, intervention_id: null, reference: "Reproduction E21", notes: "",
      opened_at: date(24), responded_at: date(25), resolved_at: date(26),
    };
    const present = { ...future, opened_at: date(-3), responded_at: date(-2), resolved_at: date(-1) };
    await withNext(db, async http => {
      const post = payload => http("/api/site-operations", { method: "POST", body: JSON.stringify({
        action: "save_sla_case", site_id: site.id, payload,
      }) });
      const statuses = [];
      for (const payload of [future, { ...present, responded_at: date(25), resolved_at: null }, { ...present, resolved_at: date(26) }])
        statuses.push((await post(payload)).status);
      assert.deepEqual(statuses, [422, 422, 422]);
      assert.equal((await db.query("select count(*)::int n from public.site_sla_cases")).rows[0].n, 0);
      await assert.rejects(asUser(db, actor, "select public.save_sla_case($1,$2) v", [site.id, future]), error => error.code === "22023");
      assert.equal((await post(present)).status, 200);
    }, {}, { rpcAllowlist: new Set(["save_sla_case"]) });
  } finally {
    await db.close();
  }
});

test("E24 — closing a reserve before the checklist date or in the future is refused", async () => {
  const db = await freshDatabase();
  try {
    const site = await siteFixture(db);
    const day = (delta) => new Date(Date.now() + delta * 86_400_000).toISOString().slice(0, 10);
    const payload = {
      title: "Contrôle QA", description: "", performed_on: day(-7), performed_by_label: "Contrôleur test",
      status: "completed", items: [{ key: "reserve", label: "Terre", state: "reserve", note: "À vérifier", reserve_resolved_on: null }],
    };
    const opened = await asUser(db, actor, "select public.save_erp_checklist($1,$2) v", [site.id, payload]);
    const close = (when) => ({ ...payload, items: [{ ...payload.items[0], reserve_resolved_on: when }] });
    await withNext(db, async http => {
      const post = async (when) => {
        const current = (await db.query("select version from public.site_erp_checklists where id=$1", [opened.id])).rows[0].version;
        return http("/api/site-operations", { method: "POST", body: JSON.stringify({
          action: "save_erp_checklist", site_id: site.id, id: opened.id, expected_version: current, payload: close(when),
        }) });
      };
      const statuses = [(await post(day(-8))).status, (await post(day(7))).status];
      const preserved = (await db.query("select version,items from public.site_erp_checklists where id=$1", [opened.id])).rows[0];
      assert.deepEqual([statuses, preserved.version, preserved.items[0].reserve_resolved_on], [[422, 422], 1, null]);
      await assert.rejects(asUser(db, actor, "select public.save_erp_checklist($1,$2,$3,1) v", [site.id, close(day(7)), opened.id]), error => error.code === "22023");
      assert.equal((await post(day(-5))).status, 200);
    }, {}, { rpcAllowlist: new Set(["save_erp_checklist"]) });
  } finally {
    await db.close();
  }
});
