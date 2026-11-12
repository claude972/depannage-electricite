import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor as artisan, assignee as outsider, requester as client, asUser, freshDatabase } from "./phase2-lot-a-http-harness.mjs";

const requestId = (n) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");

test("personal location export covers pending reservations and excludes foreign and organization dossiers", async () => {
  const db = await freshDatabase();
  try {
    const operator = { id: randomUUID(), email: "operator-location-export@example.test" };
    const people = [[client, "client"], [outsider, "client"], [artisan, "artisan"], [operator, "client"]];
    for (const [person, role] of people)
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [person.id, person.email, { role, full_name: "Personne de recette" }]);
    await db.query("update public.profiles set role='admin' where id=$1", [operator.id]);

    const org = randomUUID(), site = randomUUID();
    await db.query("insert into public.organizations(id,name,owner_id) values($1,'Organisation de recette',$2)", [org, client.id]);
    await db.query("insert into public.sites(id,organization_id,name,type,address) values($1,$2,'Site de recette','office','Adresse du site de recette')", [site, org]);

    const personal = randomUUID(), corporate = randomUUID(), foreign = randomUUID();
    for (const [job, owner, siteId] of [[personal, client, null], [corporate, client, site], [foreign, outsider, null]]) {
      await db.query(`insert into public.interventions(id,client_id,category,description,address,postal_code,
        city,urgency,status,estimate_min_cents,estimate_max_cents,site_id)
        values($1,$2,'panel','Demande de recette','Adresse de recette','97200','Fort-de-France','scheduled','requested',10000,20000,$3)`,
        [job, owner.id, siteId]);
    }
    await db.query("update public.interventions set artisan_id=$2,status='assigned' where id=$1", [personal, artisan.id]);

    for (const [owner, n, job] of [[client, 1, null], [client, 2, personal], [client, 3, corporate], [client, 4, foreign], [outsider, 1, null]]) {
      const id = requestId(n);
      await db.query(`insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,
        expected_min_cents,expected_max_cents,indicative_price_version,phone_verified,status,intervention_id)
        values($1,$2,'{}','{}','on_site',10000,20000,1,false,$3,$4)`,
        [owner.id, id, job ? "confirmed" : "prepared", job]);
      await db.query(`insert into public.booking_locations(actor_id,request_id,latitude,longitude,access_details)
        values($1,$2,$3,$4,$5)`, [owner.id, id, job ? 14.605 : null, job ? -61.07 : null, owner === outsider ? "Lieu tiers" : `Entrée ${n}`]);
    }

    const read = (person, after = null) => asUser(db, person, "select public.export_personal_booking_locations($1) as v", [after]);
    const pending = {
      id: requestId(1), actor_id: client.id, intervention_id: null,
      location: { latitude: null, longitude: null, access_details: "Entrée 1" },
    };
    const confirmed = {
      id: requestId(2), actor_id: client.id, intervention_id: personal,
      location: { latitude: 14.605, longitude: -61.07, access_details: "Entrée 2" },
    };
    assert.deepEqual(await read(client), [pending, confirmed]);
    assert.deepEqual(await read(client, requestId(1)), [confirmed]);
    assert.deepEqual(await read(client, requestId(2)), []);
    assert.deepEqual((await read(outsider)).map(({ actor_id, location }) => [actor_id, location.access_details]), [[outsider.id, "Lieu tiers"]]);
    assert.deepEqual(await read(artisan), [], "an assigned artisan can read the dossier but cannot export the client's location");
    assert.deepEqual(await read(operator), [], "an admin's role does not broaden the personal export");
    assert.equal(await asUser(db, artisan, "select count(*)::int as v from public.booking_locations"), 0);
    assert.equal(await asUser(db, operator, "select count(*)::int as v from public.booking_locations"), 0);

    const { rows } = await db.query(`select
      has_function_privilege('anon','public.export_personal_booking_locations(uuid)','EXECUTE') as anon,
      has_function_privilege('service_role','public.export_personal_booking_locations(uuid)','EXECUTE') as service`);
    assert.deepEqual(rows, [{ anon: false, service: false }]);
    await assert.rejects(asUser(db, { id: "" }, "select public.export_personal_booking_locations() as v"), { code: "42501" });
  } finally {
    await db.close();
  }
});
