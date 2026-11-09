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

test("E23 — both real report routes classify a missing resolution target as indeterminate", async () => {
  const db = await freshDatabase();
  try {
    const site = await siteFixture(db);
    const opened = new Date(Date.now() - 24 * 60 * 60 * 1000);
    opened.setUTCHours(10, 0, 0, 0);
    const responded = new Date(opened.getTime() + 30 * 60 * 1000);
    const calendar = await asUser(db, actor, "select public.save_sla_calendar($1,$2) v", [
      site.organization_id, {
        name: "Calendrier QA", timezone: "UTC", closed_dates: [],
        windows: [{ weekday: opened.getUTCDay() || 7, start: "08:00", end: "17:00" }],
      },
    ]);
    const policy = await asUser(db, actor, "select public.save_sla_policy($1,$2) v", [
      site.id, { name: "Politique QA", status: "active", calendar_id: calendar.id, urgency: null,
        response_target_minutes: 60, resolution_target_minutes: null },
    ]);
    const item = await asUser(db, actor, "select public.save_sla_case($1,$2) v", [
      site.id, { policy_id: policy.id, intervention_id: null, reference: "Reproduction E23", notes: "",
        opened_at: opened.toISOString(), responded_at: responded.toISOString(), resolved_at: null },
    ]);
    await withNext(db, async http => {
      const siteResponse = await http(`/api/site-operations?site_id=${site.id}`);
      const organizationResponse = await http(`/api/organizations/${site.organization_id}/sla`);
      assert.deepEqual([siteResponse.status, organizationResponse.status], [200, 200]);
      const local = (await siteResponse.json()).sla;
      const consolidated = await organizationResponse.json();
      assert.equal(local.cases[0].case_id, item.id);
      assert.equal(local.cases[0].response.status, "met");
      assert.equal(local.cases[0].resolution.status, "not_measurable");
      assert.equal(consolidated.sites[0].cases[0].case_id, item.id);
      assert.equal(consolidated.summary.indeterminate, 1);
      assert.deepEqual([local.summary.met, local.summary.indeterminate], [0, 1]);
    }, {}, { rpcAllowlist: new Set(["site_operations_snapshot", "organization_sla_snapshot"]) });
  } finally {
    await db.close();
  }
});
