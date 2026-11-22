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
      address, postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents, report_evidence_required)
      values($1,$2,$3,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','in_progress',10000,20000,false)`, [
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

test("E36 — an exact suspension retry succeeds after response loss with just one audit", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email) values($1,$2)", [actor.id, actor.email]);
    await db.query("update public.profiles set role='admin' where id=$1", [actor.id]);
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
      requester.id, requester.email, { role: "artisan", full_name: "Artisan de recette" },
    ]);
    await asUser(db, requester, "select public.save_artisan_profile('Electricité QA','12345678901234','EI',0,'12 rue de test QA',array['97200'],array['panel']) v");
    await asUser(db, requester, "select public.submit_artisan_application() v");
    const revision = async () => (await db.query(
      "select application_version from public.artisan_profiles where user_id=$1", [requester.id],
    )).rows[0].application_version;
    await withNext(db, async http => {
      const post = command => http("/api/admin/artisans", {
        method: "POST", body: JSON.stringify({ user_id: requester.id, ...command }),
      });
      const approval = { action: "approve", expected_version: await revision() };
      const keyed = await post({ ...approval, command_id: randomUUID() });
      assert.equal((keyed.ok ? keyed : await post(approval)).status, 200);
      const suspension = { action: "suspend", expected_version: await revision() };
      const body = keyed.ok ? { ...suspension, command_id: randomUUID() } : suspension;
      const first = await post(body);
      const firstResult = await first.json();
      assert.equal(first.status, 200);
      const afterFirst = await revision();
      const retry = await post(body); // first response deliberately not used to change the command
      const count = (await db.query("select count(*)::int n from public.audit_log where action=$1", [
        `artisan_approval:${requester.id}:false`,
      ])).rows[0].n;
      assert.deepEqual([keyed.status, retry.status, await revision(), count], [200, 200, afterFirst, 1]);
      assert.deepEqual(await retry.json(), firstResult);
      assert.equal((await post({ ...body, expected_version: afterFirst })).status, 409);
      assert.equal((await post(suspension)).status, 422);
    }, {}, { rpcAllowlist: new Set(["decide_artisan_application"]) });
  } finally {
    await db.close();
  }
});

test("E41 — an exact message retry delivers one message and one notification", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)", [
      actor.id, actor.email, { role: "artisan", full_name: "Artisan de recette" },
      requester.id, requester.email, { role: "client", full_name: "Client de recette" },
    ]);
    const id = randomUUID();
    await db.query(`insert into public.interventions(id, client_id, artisan_id, category, description,
      address, postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents)
      values($1,$2,$3,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','assigned',10000,20000)`, [
      id, requester.id, actor.id,
    ]);
    await withNext(db, async http => {
      const post = body => http("/api/messages", { method: "POST", body: JSON.stringify(body) });
      const fields = { intervention_id: id, body: "Message de recette à envoyer une fois" };
      const command = { ...fields, command_id: randomUUID() };
      const keyed = await post(command);
      const first = keyed.ok ? keyed : await post(fields);
      assert.equal(first.status, 201);
      const initial = await first.json(); // proxy drops the first response from the sender
      const retry = await post(keyed.ok ? command : fields);
      assert.equal(retry.status, 201);
      const counts = (await db.query(`select
        (select count(*)::int from public.messages where intervention_id=$1) messages,
        (select count(*)::int from public.notifications where intervention_id=$1 and recipient_id=$2 and kind='message_received') notices`, [id, requester.id])).rows[0];
      assert.deepEqual([keyed.status, counts], [201, { messages: 1, notices: 1 }]);
      assert.deepEqual(await retry.json(), initial);
      assert.equal(initial.message.id, command.command_id);
      assert.equal((await post({ ...command, body: "Autre texte sous la même clé" })).status, 409);
      assert.equal((await post(fields)).status, 422);
    }, {}, { rpcAllowlist: new Set(["send_message"]) });
  } finally {
    await db.close();
  }
});

test("E19 — an assigned artisan cannot store a blank declarant name through the route or RPC", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)", [
      actor.id, actor.email, { role: "artisan", full_name: "Artisan de recette" },
      requester.id, requester.email, { role: "client", full_name: "Client de recette" },
    ]);
    await db.query("update public.profiles set artisan_approved=true where id=$1", [actor.id]);
    const id = randomUUID();
    await db.query(`insert into public.interventions(id, client_id, artisan_id, category, description,
      address, postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents, report_evidence_required)
      values($1,$2,$3,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','in_progress',10000,20000,false)`, [
      id, requester.id, actor.id,
    ]);
    const report = { action: "save_report", summary: "Contrôle électrique synthétique", checks: [] };
    await withNext(db, async http => {
      const save = signature_name => http(`/api/interventions/${id}/operations`, {
        method: "POST", body: JSON.stringify({ ...report, signature_name, command_id: randomUUID() }),
      });
      const result = await save("   ");
      const stored = (await db.query("select signature_name from public.intervention_reports where intervention_id=$1", [id])).rows;
      assert.deepEqual([result.status, stored], [422, []]);
      assert.match((await result.json()).error, /nom du déclarant/);
      await assert.rejects(asUser(db, actor, "select public.save_intervention_report($1,$2,'[]'::jsonb,$3,$4) v", [
        id, report.summary, "\t ", randomUUID(),
      ]), error => error.code === "23514");
      assert.equal((await save(" Déclarant de recette ")).status, 200);
      assert.equal((await db.query("select signature_name from public.intervention_reports where intervention_id=$1", [id])).rows[0].signature_name, "Déclarant de recette");
    }, {}, { rpcAllowlist: new Set(["save_intervention_report"]) });
  } finally {
    await db.close();
  }
});
