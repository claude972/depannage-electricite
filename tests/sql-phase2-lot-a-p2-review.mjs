import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E15 — a stale appointment form cannot overwrite another participant's change", async () => {
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
      values($1,$2,$3,'panel','Panne électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','assigned',10000,20000)`, [
      id, requester.id, actor.id,
    ]);
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const morning = { starts_at: day + "T09:00:00-04:00", ends_at: day + "T10:00:00-04:00" };
    const later = { starts_at: day + "T13:00:00-04:00", ends_at: day + "T14:00:00-04:00" };
    const route = `/api/interventions/${id}/operations`;
    const appoint = (slots, note, expected) => ({
      action: "save_appointment", ...slots, note,
      ...(expected === undefined ? {} : { expected_version: expected }),
    });
    await withNext(db, async http => {
      const post = async (user, body) => {
        const response = await http(route, { method: "POST", body: JSON.stringify(body) }, user);
        return { status: response.status, body: await response.json() };
      };
      // Exercise both the old and new contracts in the same fixture without
      // accepting the old contract as a successful regression outcome.
      const first = await post(requester, appoint(morning, "Premier créneau", 0));
      const versioned = first.status === 200;
      const created = versioned ? first : await post(requester, appoint(morning, "Premier créneau"));
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.result.reminder_version, 1);
      const moved = await post(actor, appoint(later, "Nouveau créneau", versioned ? 1 : undefined));
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      assert.equal(moved.body.result.reminder_version, 2);
      const stale = await post(requester, appoint(morning, "Note depuis l’ancien formulaire", versioned ? 1 : undefined));
      const saved = (await db.query(
        "select starts_at, note, reminder_version from public.intervention_appointments where intervention_id=$1", [id],
      )).rows[0];
      assert.deepEqual([first.status, stale.status, saved.starts_at.toISOString(), saved.note, saved.reminder_version],
        [200, 409, new Date(later.starts_at).toISOString(), "Nouveau créneau", 2]);
      assert.equal((await post(requester, appoint(later, "Version absente"))).status, 422);
      await assert.rejects(asUser(db, requester, "select public.save_intervention_appointment($1,$2,$3,$4) v", [
        id, morning.starts_at, morning.ends_at, "Appel SQL sans version",
      ]), error => error.code === "42501");
      assert.equal((await db.query(
        "select count(*)::int count from public.audit_log where intervention_id=$1 and action='appointment_saved'", [id],
      )).rows[0].count, 2);
    }, {}, { users: [requester, actor], rpcAllowlist: new Set(["save_intervention_appointment"]) });
  } finally {
    await db.close();
  }
});

test("E29 — a stale warranty decision cannot replace the resolution of another operator", async () => {
  const db = await freshDatabase();
  try {
    const otherAdmin = { ...actor, id: randomUUID(), email: "other-operator@example.test" };
    for (const user of [actor, otherAdmin, requester])
      await db.query("insert into auth.users(id,email) values($1,$2)", [user.id, user.email]);
    await db.query("update public.profiles set role='admin' where id in ($1,$2)", [actor.id, otherAdmin.id]);
    const job = randomUUID(), id = randomUUID();
    await db.query(`insert into public.interventions(id, client_id, category, description, address,
      postal_code, city, urgency, status, estimate_min_cents, estimate_max_cents)
      values($1,$2,'panel','Défaut électrique de recette','Adresse de test','97200','Fort-de-France','scheduled','paid',10000,20000)`, [
      job, requester.id,
    ]);
    const version = (await db.query(`insert into public.warranty_cases(id, intervention_id, client_id, description)
      values($1,$2,$3,'Demande de garantie de recette') returning to_jsonb(updated_at) as version`, [id, job, requester.id])).rows[0].version;
    const route = "/api/warranty";
    const resolve = (status, resolution, expected) => ({
      action: "resolve", case_id: id, status, resolution,
      ...(expected === undefined ? {} : { expected_version: expected }),
    });
    await withNext(db, async http => {
      const post = async (user, command) => {
        const response = await http(route, { method: "POST", body: JSON.stringify(command) }, user);
        return { status: response.status, body: await response.json() };
      };
      const first = await post(actor, resolve("resolved", "Résolution documentée par le premier opérateur.", version));
      const versioned = first.status === 200;
      const resolved = versioned ? first : await post(actor, resolve("resolved", "Résolution documentée par le premier opérateur."));
      assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
      const stale = await post(otherAdmin, resolve("reviewing", "Saisie ancienne du second opérateur.", versioned ? version : undefined));
      const current = (await db.query("select status,resolution,to_jsonb(updated_at) version from public.warranty_cases where id=$1", [id])).rows[0];
      assert.deepEqual([first.status, stale.status, current.status, current.resolution],
        [200, 409, "resolved", "Résolution documentée par le premier opérateur."]);
      assert.notEqual(current.version, version);
      assert.equal((await post(otherAdmin, resolve("reviewing", "Version absente à rejeter."))).status, 422);
      await assert.rejects(asUser(db, otherAdmin, "select public.resolve_warranty($1,'reviewing',$2) v", [
        id, "Appel SQL sans version",
      ]), error => error.code === "42501");
      assert.equal((await db.query(
        "select count(*)::int count from public.audit_log where intervention_id=$1 and action like 'warranty_%'", [job],
      )).rows[0].count, 1);
    }, {}, { users: [actor, otherAdmin], rpcAllowlist: new Set(["resolve_warranty"]) });
  } finally {
    await db.close();
  }
});

test("E34 — an old approval cannot undo a later suspension; reactivation is explicit", async () => {
  const db = await freshDatabase();
  try {
    const otherAdmin = { ...actor, id: randomUUID(), email: "other-operator@example.test" };
    for (const user of [actor, otherAdmin])
      await db.query("insert into auth.users(id,email) values($1,$2)", [user.id, user.email]);
    await db.query("update public.profiles set role='admin' where id in ($1,$2)", [actor.id, otherAdmin.id]);
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
      requester.id, requester.email, { role: "artisan", full_name: "Artisan de recette" },
    ]);
    await asUser(db, requester, "select public.save_artisan_profile('Electricité QA','12345678901234','EI',0,'12 rue de test QA',array['97200'],array['panel']) v");
    await asUser(db, requester, "select public.submit_artisan_application() v");
    const dossier = async () => (await db.query(`select a.application_status as status,
      (to_jsonb(a)->>'application_version')::integer version,p.artisan_approved,p.id
      from public.artisan_profiles a join public.profiles p on p.id=a.user_id where a.user_id=$1`, [requester.id])).rows[0];
    const old = await dossier();
    const route = "/api/admin/artisans";
    await withNext(db, async http => {
      const post = async (user, body) => {
        const response = await http(route, { method: "POST", body: JSON.stringify({ user_id: requester.id, ...body }) }, user);
        return { status: response.status, body: await response.json() };
      };
      const first = await post(actor, { action: "approve", expected_version: old.version ?? 1 });
      const versioned = first.status === 200;
      const approved = versioned ? first : await post(actor, { approved: true });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      const current = await dossier();
      assert.equal(current.status, "approved");
      const suspended = await post(actor, versioned ? { action: "suspend", expected_version: current.version } : { approved: false });
      assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
      const suspension = await dossier();
      assert.equal(suspension.status, "suspended");
      const stale = await post(otherAdmin, versioned ? { action: "approve", expected_version: old.version } : { approved: true });
      const after = await dossier();
      assert.deepEqual([first.status, stale.status, after.status, after.artisan_approved], [200, 409, "suspended", false]);
      assert.equal((await post(otherAdmin, { action: "approve", expected_version: suspension.version })).status, 409);
      assert.equal((await post(otherAdmin, { approved: true })).status, 422);
      await assert.rejects(asUser(db, otherAdmin, "select public.approve_artisan($1,true) v", [requester.id]), error => error.code === "42501");
      assert.equal((await post(actor, { action: "reinstate", expected_version: suspension.version })).status, 200);
      assert.equal((await dossier()).status, "approved");
    }, {}, { users: [actor, otherAdmin], rpcAllowlist: new Set(["approve_artisan", "decide_artisan_application"]) });
  } finally {
    await db.close();
  }
});
