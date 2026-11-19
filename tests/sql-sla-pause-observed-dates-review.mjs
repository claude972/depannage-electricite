// D21 (O9) : début et fin de pause d'un dossier de délai refusés dans le futur (SQL isolé, PGlite).
import assert from "node:assert/strict";
import test from "node:test";
import { actor, asUser, freshDatabase } from "./phase2-lot-a-http-harness.mjs";

const date = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function openCase(db) {
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
    actor.id, actor.email, { role: "manager", full_name: "Gestionnaire de recette" },
  ]);
  const site = await asUser(db, actor, "select to_jsonb(public.create_site('Site QA','restaurant','12 rue du Test',0,null)) v");
  const policy = await asUser(db, actor, "select public.save_sla_policy($1,$2) v", [
    site.id, { name: "Politique QA", status: "active", calendar_id: null, urgency: null, response_target_minutes: 60, resolution_target_minutes: 240 },
  ]);
  const created = await asUser(db, actor, "select public.save_sla_case($1,$2) v", [
    site.id, { policy_id: policy.id, intervention_id: null, reference: "D21", notes: "", opened_at: date(-48), responded_at: null, resolved_at: null },
  ]);
  return created;
}
const version = async (db, id) => (await db.query("select version from public.site_sla_cases where id=$1", [id])).rows[0].version;
const pauses = async (db, id) => (await db.query("select started_at, ended_at from public.site_sla_pauses where case_id=$1 order by started_at", [id])).rows;

test("D21 — future pause start is refused (22023), nothing written", async () => {
  const db = await freshDatabase();
  try {
    const c = await openCase(db);
    const v = await version(db, c.id);
    await assert.rejects(asUser(db, actor, "select public.pause_sla_case($1,$2,$3,$4) v", [c.id, date(24), "futur", v]), (e) => e.code === "22023");
    assert.equal((await pauses(db, c.id)).length, 0);
    assert.equal(await version(db, c.id), v);
  } finally { await db.close(); }
});

test("D21 — future resume is refused (22023), the pause stays open; past resume accepted", async () => {
  const db = await freshDatabase();
  try {
    const c = await openCase(db);
    let v = await version(db, c.id);
    await asUser(db, actor, "select public.pause_sla_case($1,$2,$3,$4) v", [c.id, date(-24), "attente accès", v]);
    v = await version(db, c.id);
    await assert.rejects(asUser(db, actor, "select public.resume_sla_case($1,$2,$3) v", [c.id, date(72), v]), (e) => e.code === "22023");
    let rows = await pauses(db, c.id);
    assert.equal(rows.length, 1); assert.equal(rows[0].ended_at, null);
    assert.equal(await version(db, c.id), v);
    await asUser(db, actor, "select public.resume_sla_case($1,$2,$3) v", [c.id, date(-1), v]);
    rows = await pauses(db, c.id);
    assert.notEqual(rows[0].ended_at, null);
  } finally { await db.close(); }
});

test("D21 — pause start and resume at present instant are accepted (no regression)", async () => {
  const db = await freshDatabase();
  try {
    const c = await openCase(db);
    let v = await version(db, c.id);
    await asUser(db, actor, "select public.pause_sla_case($1,$2,$3,$4) v", [c.id, date(-2), "ok", v]);
    v = await version(db, c.id);
    await asUser(db, actor, "select public.resume_sla_case($1,$2,$3) v", [c.id, new Date(Date.now() - 1000).toISOString(), v]);
    assert.equal((await pauses(db, c.id)).filter((p) => p.ended_at).length, 1);
  } finally { await db.close(); }
});
