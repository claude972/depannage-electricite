import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E67 — reserve lift accepts no proof or a private same-site document", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, assignee]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        user.id, user.email, { role: "manager", full_name: "Gestionnaire de recette" },
      ]);
    }
    const site = await asUser(db, actor, "select to_jsonb(public.create_site('Site QA','office','Adresse QA',0,null)) v");
    const other = await asUser(db, assignee, "select to_jsonb(public.create_site('Autre site','office','Autre adresse',0,null)) v");
    async function document(owner, siteId, withObject = true) {
      const id = randomUUID(), path = `sites/${siteId}/${owner.id}/${id}`;
      await db.query(`insert into public.site_documents(id,site_id,owner_id,name,mime_type,kind,path)
        values($1,$2,$3,'Justificatif QA','image/png','compliance',$4)`, [id, siteId, owner.id, path]);
      if (withObject) await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents',$1)", [path]);
      return id;
    }
    const proof = await document(actor, site.id), foreign = await document(assignee, other.id), orphan = await document(actor, site.id, false);
    const item = { key: "reserve", label: "Éclairage de secours", state: "reserve", note: "", reserve_resolved_on: "2026-01-04" };
    const payload = {
      title: "Contrôle QA", description: "", performed_on: "2026-01-03", performed_by_label: "", status: "completed", items: [item],
    };
    const command = (fields, row) => ({
      action: "save_erp_checklist", site_id: site.id,
      ...(row ? { id: row.id, expected_version: row.version } : {}),
      payload: { ...payload, items: [{ ...item, ...fields }] },
    });
    await withNext(db, async http => {
      const post = (data, user = actor) => http("/api/site-operations", { method: "POST", body: JSON.stringify(data) }, user);
      const without = await post(command({}));
      assert.equal(without.status, 200);
      const row = (await without.json()).result;
      assert.equal(row.items[0].reserve_document_id, undefined);
      for (const id of [foreign, orphan, randomUUID()]) {
        const refused = await post(command({ reserve_document_id: id }, row));
        assert.equal(refused.status, 422);
        assert.match((await refused.json()).error, /document disponible/);
      }
      assert.equal((await post(command({ reserve_document_id: proof }, row), assignee)).status, 403);
      assert.equal((await post(command({ reserve_document_id: proof, reserve_resolved_on: null }, row))).status, 422);
      const linked = await post(command({ reserve_document_id: proof }, row));
      assert.equal(linked.status, 200);
      const updated = (await linked.json()).result;
      assert.equal(updated.items[0].reserve_document_id, proof);
      assert.equal((await post(command({ reserve_document_id: null }, row))).status, 409);
      const legacy = (await (await post(command({}, updated))).json()).result;
      assert.equal(legacy.items[0].reserve_document_id, proof, "older clients preserve attached proof");
      const cleared = await post(command({ reserve_document_id: null }, legacy));
      assert.equal(cleared.status, 200);
      assert.equal((await cleared.json()).result.items[0].reserve_document_id, null);
      assert.equal(await asUser(db, assignee, "select count(*)::int v from public.site_documents where id=$1", [proof]), 0);
    }, {}, { users: [actor, assignee], rpcAllowlist: new Set(["save_erp_checklist"]), sqlMessageAllowlist: new Set(["erp_reserve_document_invalid"]) });
  } finally {
    await db.close();
  }
});
