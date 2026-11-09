import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E25 — a future publication keeps the previously effective quote grid available until its date", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)", [
      actor.id, actor.email, { role: "manager", full_name: "Gestionnaire de recette" },
      assignee.id, assignee.email, { role: "artisan", full_name: "Artisan de recette" },
    ]);
    await db.query("update public.profiles set artisan_approved=true where id=$1", [assignee.id]);
    await db.query("insert into public.artisan_profiles(user_id,application_status) values($1,'approved')", [assignee.id]);
    const site = await asUser(db, actor, "select to_jsonb(public.create_site('Site QA','office','12 rue du Test',0,null)) v");
    const id = randomUUID(), lineage = randomUUID(), current = randomUUID(), scheduled = randomUUID();
    await db.query(`insert into public.interventions(id, client_id, artisan_id, site_id, category, description,
      address, postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents)
      values($1,$2,$3,$4,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','assigned',10000,20000)`, [
      id, actor.id, assignee.id, site.id,
    ]);
    await db.query(`insert into public.organization_contract_grids
      (id,organization_id,lineage_id,version_number,label,effective_from,status,published_at,lines,created_by)
      values($1,$2,$3,2,'Grille actuelle',current_date-2,'published',now(),$4,$5),
            ($6,$2,$3,3,'Grille future',current_date+40,'draft',null,$4,$5)`, [
      current, site.organization_id, lineage, JSON.stringify([{ label: "Déplacement", unit: "visit", amount_cents: 4200 }]), actor.id, scheduled,
    ]);
    await asUser(db, actor, "select public.write_quote_grid_access($1,$2,$3,null) v", [id, randomUUID(), current]);
    const artisanRoute = `/api/interventions/${id}/quote-grid`;
    const ownerRoute = artisanRoute + "/access";
    await withNext(db, async http => {
      async function grids(route, user) {
        const response = await http(route, {}, user);
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
        return (await response.json()).grids.map(row => row.id);
      }
      assert.deepEqual(await grids(artisanRoute, assignee), [current]);
      const publish = await http("/api/site-operations", { method: "POST", body: JSON.stringify({
        action: "publish_contract_grid", id: scheduled, expected_version: 1,
      }) });
      assert.equal(publish.status, 200, JSON.stringify(await publish.clone().json()));
      assert.deepEqual([await grids(ownerRoute, actor), await grids(artisanRoute, assignee)], [[current], [current]]);
      // Model the effective day without waiting or rewriting the older revision.
      await db.query("update public.organization_contract_grids set effective_from=current_date where id=$1", [scheduled]);
      assert.deepEqual(await grids(ownerRoute, actor), [scheduled]);
      assert.deepEqual(await grids(artisanRoute, assignee), []); // access remains scoped to the explicit revision
      await asUser(db, actor, "select public.write_quote_grid_access($1,$2,$3,1) v", [id, randomUUID(), scheduled]);
      assert.deepEqual(await grids(artisanRoute, assignee), [scheduled]);
    }, {}, { users: [actor, assignee], rpcAllowlist: new Set([
      "publish_contract_grid", "read_quote_grid_access", "read_quote_grid_options",
    ]) });
  } finally {
    await db.close();
  }
});
