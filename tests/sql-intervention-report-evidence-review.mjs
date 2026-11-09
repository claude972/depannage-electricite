import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("new report photos and the recipient's receipt are verified and tied to the same dossier and revision", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, requester, assignee]) {
      const role = user === actor ? "artisan" : "client";
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
        user.id, user.email, { role, full_name: "Personne de recette" },
      ]);
    }
    await db.query("update public.profiles set artisan_approved=true where id=$1", [actor.id]);
    const id = randomUUID(), otherJob = randomUUID(), legacy = randomUUID();
    for (const job of [id, otherJob, legacy]) {
      await db.query(`insert into public.interventions(id,client_id,artisan_id,category,description,
        address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)
        values($1,$2,$3,'panel','Recette du compte rendu','Adresse de test','97200','Fort-de-France','scheduled','in_progress',10000,20000)`, [
        job, requester.id, actor.id,
      ]);
    }
    // Simulate a dossier that already existed when the policy was installed.
    await db.query("update public.interventions set report_evidence_required=false where id=$1", [legacy]);
    async function document(job = id, mime = "image/jpeg", stored = true) {
      const photo = randomUUID(), path = `${actor.id}/${photo}`;
      await db.query("insert into public.documents(id,intervention_id,owner_id,name,path,mime_type) values($1,$2,$3,'Pièce de recette',$4,$5)", [
        photo, job, actor.id, path, mime,
      ]);
      if (stored) await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents',$1)", [path]);
      return photo;
    }
    const before = await document(), after = await document();
    const foreign = await document(otherJob), pdf = await document(id, "application/pdf"), orphan = await document(id, "image/jpeg", false);
    const command = {
      action: "save_report", command_id: randomUUID(), summary: "Contrôle et remise en service de recette",
      checks: [], signature_name: "Artisan de recette",
    };
    const reportRoute = `/api/interventions/${id}/operations`;
    const legacyRoute = `/api/interventions/${legacy}/operations`;
    await withNext(db, async http => {
      const post = (path, body, user = actor) => http(path, { method: "POST", body: JSON.stringify(body) }, user);
      const report = (body, user) => post(reportRoute, body, user);
      const finish = job => post(`/api/interventions/${job}/actions`, { action: "complete" });

      const blocked = await finish(id);
      assert.equal(blocked.status, 409);
      assert.match((await blocked.json()).error, /photos avant et après/);
      assert.equal((await post(legacyRoute, { ...command, command_id: randomUUID() })).status, 200);
      assert.equal((await finish(legacy)).status, 200);

      assert.equal((await report(command)).status, 422);
      for (const invalid of [before, foreign, pdf, orphan]) {
        assert.equal((await report({ ...command, before_photo_id: before, after_photo_id: invalid })).status, 422);
      }
      assert.equal((await report({ ...command, before_photo_id: before })).status, 422);
      const valid = { ...command, before_photo_id: before, after_photo_id: after };
      assert.equal((await report(valid, requester)).status, 403);
      const first = await report(valid);
      assert.equal(first.status, 200);
      const saved = (await first.json()).result;
      assert.equal(saved.before_photo_id, before);
      assert.equal(saved.after_photo_id, after);
      assert.equal((await report({ ...valid, after_photo_id: foreign })).status, 409, "different payload under the same command");
      assert.deepEqual((await (await report(valid)).json()).result, saved);
      assert.equal((await db.query("select count(*)::int n from public.intervention_operation_events where intervention_id=$1 and kind='report'", [id])).rows[0].n, 1);

      const sign = { action: "sign_report", report_revision: saved.report_revision, acknowledged: true, signature_name: "Client de recette" };
      assert.equal((await report(sign, requester)).status, 409, "receipt after completion only");
      const missingPath = `${actor.id}/${before}`;
      await db.query("delete from storage.objects where bucket_id='intervention-documents' and name=$1", [missingPath]);
      assert.equal((await finish(id)).status, 409, "the object still has to exist at completion");
      await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents',$1)", [missingPath]);
      assert.equal((await finish(id)).status, 200);
      assert.equal((await report(sign, actor)).status, 403);
      assert.equal((await report(sign, assignee)).status, 403);
      assert.equal((await report({ ...sign, acknowledged: false }, requester)).status, 422);
      assert.equal((await report({ ...sign, report_revision: randomUUID() }, requester)).status, 409);

      const accepted = await report(sign, requester);
      assert.equal(accepted.status, 200);
      assert.equal(accepted.headers.get("cache-control"), "private, no-store");
      const receipt = (await accepted.json()).result;
      assert.deepEqual(Object.keys(receipt).sort(), ["acknowledged_at", "report_revision", "signature_name", "signed_at"]);
      assert.equal(receipt.report_revision, saved.report_revision);
      assert.equal(receipt.acknowledged_at, receipt.signed_at);
      assert.deepEqual((await (await report(sign, requester)).json()).result, receipt);
      assert.equal((await report({ ...sign, signature_name: "Un autre nom" }, requester)).status, 409);
      const read = async user => (await (await http(reportRoute, {}, user)).json());
      assert.deepEqual((await read(requester)).report_receipt, receipt);
      assert.deepEqual((await read(actor)).report_receipt, receipt);
      assert.equal((await http(reportRoute, {}, assignee)).status, 404);

      const edit = await report({ ...valid, command_id: randomUUID(), summary: "Compte rendu de recette révisé" });
      assert.equal(edit.status, 200);
      const latest = (await edit.json()).result;
      assert.notEqual(latest.report_revision, saved.report_revision);
      assert.equal((await read(requester)).report_receipt, null);
      const stored = (await db.query("select report_snapshot from public.intervention_report_receipts where intervention_id=$1", [id])).rows;
      assert.equal(stored.length, 1);
      assert.equal(stored[0].report_snapshot.summary, saved.summary);
      assert.equal((await db.query("select count(*)::int n from public.audit_log where intervention_id=$1 and action='report_receipt_signed'", [id])).rows[0].n, 1);
      await assert.rejects(asUser(db, requester, "select report_snapshot v from public.intervention_report_receipts"), e => e.code === "42501");
      assert.equal(await asUser(db, assignee, "select count(intervention_id)::int v from public.intervention_report_receipts"), 0);

      const org = (await db.query("insert into public.organizations(name,owner_id) values('Entreprise de recette',$1) returning id", [assignee.id])).rows[0].id;
      const site = (await db.query("insert into public.sites(organization_id,name,type,address,budget_cents) values($1,'Site de recette','office','Adresse de recette',10000) returning id", [org])).rows[0].id;
      await db.query("insert into public.organization_members values($1,$2,'manager')", [org, requester.id]);
      await db.query("update public.interventions set site_id=$1 where id=$2", [site, id]);
      assert.equal((await http(reportRoute, {}, requester)).status, 200);
      await db.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [org, requester.id]);
      assert.equal((await http(reportRoute, {}, requester)).status, 404);
      assert.equal((await report({ ...sign, report_revision: latest.report_revision }, requester)).status, 403, "former member cannot sign a report directly");
      assert.equal((await report(sign, requester)).status, 403, "former member cannot replay an old signature");
      assert.equal((await db.query("select count(*)::int n from public.intervention_report_receipts where intervention_id=$1", [id])).rows[0].n, 1);
    }, {}, {
      users: [actor, requester, assignee],
      rpcAllowlist: new Set(["save_intervention_report", "sign_intervention_report", "intervention_action"]),
      sqlMessageAllowlist: new Set(["report_photos_required", "report_photos_invalid", "report_revision_changed"]),
      async handle(request, _response, { user, send }) {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname === "/rest/v1/rpc/intervention_participants") { send(200, []); return true; }
        if (request.method !== "GET") return false;
        const queries = {
          "/rest/v1/interventions": ["id", "id,travel_stage,report_evidence_required"],
          "/rest/v1/intervention_appointments": ["intervention_id", "*"],
          "/rest/v1/intervention_reports": ["intervention_id", "*"],
          "/rest/v1/intervention_operation_events": ["intervention_id", "*"],
          "/rest/v1/intervention_report_receipts": ["intervention_id", "report_revision,acknowledged_at,signed_at,signature_name"],
        };
        const query = queries[url.pathname];
        if (!query) return false;
        const [key, projection] = query;
        assert.equal(url.searchParams.get("select"), projection);
        const filter = url.searchParams.get(key)?.slice(3);
        const revision = url.searchParams.get("report_revision")?.slice(3);
        const result = await asUser(db, user, `select coalesce(jsonb_agg(r),'[]') v from (
          select ${projection} from public.${url.pathname.split("/").at(-1)} where ${key}=$1${revision ? " and report_revision=$2" : ""}
        ) r`, revision ? [filter, revision] : [filter]);
        send(200, result);
        return true;
      },
    });
  } finally {
    await db.close();
  }
});
