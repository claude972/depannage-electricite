import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, requester, asUser, freshDatabase } from "./phase2-lot-a-http-harness.mjs";

test("booking location is available to the client and current artisan, only on the confirmed dossier", async () => {
  const db = await freshDatabase();
  try {
    const operator = { id: randomUUID(), email: "admin-location@example.test" };
    const outsider = { id: randomUUID(), email: "client-location@example.test" };
    const people = [[requester, "client"], [actor, "artisan"], [assignee, "artisan"], [operator, "client"], [outsider, "client"]];
    for (const [person, role] of people)
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [person.id, person.email, { role, full_name: "Personne de recette" }]);
    await db.query("update public.profiles set role='admin' where id=$1", [operator.id]);

    const job = randomUUID(), intent = randomUUID(), pendingIntent = randomUUID(), unrelatedJob = randomUUID();
    for (const id of [job, unrelatedJob]) {
      await db.query(`insert into public.interventions(id,client_id,category,description,address,postal_code,
        city,urgency,status,estimate_min_cents,estimate_max_cents)
        values($1,$2,'panel','Demande de recette','Adresse de recette','97200','Fort-de-France','scheduled','requested',10000,20000)`, [id, requester.id]);
    }
    await db.query(`insert into public.phone_booking_requests(actor_id,request_id,payload,contact,method,
      expected_min_cents,expected_max_cents,indicative_price_version,phone_verified,status,intervention_id)
      values($1,$2,'{}','{}','on_site',10000,20000,1,false,'confirmed',$4),
            ($1,$3,'{}','{}','on_site',10000,20000,1,false,'prepared',null)`, [requester.id, intent, pendingIntent, job]);
    const location = { latitude: 14.6049, longitude: -61.0685, access_details: "Entrée de recette" };
    await db.query(`insert into public.booking_locations(actor_id,request_id,latitude,longitude,access_details)
      values($1,$2,$4,$5,$6),($1,$3,null,null,'Brouillon non confirmé')`,
      [requester.id, intent, pendingIntent, location.latitude, location.longitude, location.access_details]);

    const read = (person, id = job) => asUser(db, person, "select public.read_booking_location($1) as v", [id]);
    assert.deepEqual(await read(requester), location);
    assert.equal(await read(requester, unrelatedJob), null);
    assert.equal(await read(actor), null, "unassigned artisan");
    assert.equal(await read(operator), null, "general dossier visibility is not access to the precise location");
    assert.equal(await read(outsider), null);
    assert.equal(await read(outsider, randomUUID()), null);
    assert.equal(await asUser(db, actor, "select count(*)::int as v from public.booking_locations"), 0);

    await db.query("update public.interventions set artisan_id=$2,status='assigned' where id=$1", [job, actor.id]);
    assert.deepEqual(await read(actor), location);
    assert.equal(await read(assignee), null);
    assert.equal(await asUser(db, actor, "select count(*)::int as v from public.booking_locations"), 0);

    await db.query("update public.interventions set artisan_id=$2 where id=$1", [job, assignee.id]);
    assert.equal(await read(actor), null);
    assert.deepEqual(await read(assignee), location);
    assert.deepEqual(await read(requester), location);

    const { rows } = await db.query("select has_function_privilege('anon','public.read_booking_location(uuid)','EXECUTE') as anon");
    assert.equal(rows[0].anon, false);
  } finally {
    await db.close();
  }
});
