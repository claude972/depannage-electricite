import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

const operator = { id: randomUUID(), aud: "authenticated", role: "authenticated", email: "finance-dispute@example.test" };
const projection = {
  quotes: new Set(["id", "artisan_id", "status"]),
  payments: new Set(["quote_id", "status", "total_cents", "currency", "failure_code", "created_at", "updated_at", "paid_at", "method"]),
};

function readGateway(db) {
  return async (request, response, { user, send }) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const table = /^\/rest\/v1\/(quotes|payments|payment_attempts)$/.exec(url.pathname)?.[1];
    if (!table || request.method !== "GET") return false;
    if (table === "payment_attempts") {
      const rows = await asUser(db, user, `select coalesce(jsonb_agg(to_jsonb(r)), '[]') v from (
        select id,status,total_cents,currency,failure_code,created_at,updated_at,paid_at,method
        from public.payment_attempts where quote_id=$1) r`, [url.searchParams.get("quote_id").slice(3)]);
      response.setHeader("Content-Range", rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0");
      send(200, rows);
      return true;
    }
    const columns = url.searchParams.get("select").split(",");
    assert.ok(columns.every(column => projection[table].has(column)));
    const key = table === "quotes" ? "id" : "quote_id";
    const filter = url.searchParams.get(key);
    assert.match(filter, /^eq\./);
    const rows = await asUser(db, user, `select coalesce(jsonb_agg(to_jsonb(r)), '[]') v from (
      select ${columns.join(",")} from public.${table} where ${key}=$1) r`, [filter.slice(3)]);
    send(200, rows);
    return true;
  };
}

test("E80 — real payment status shows only the assigned artisan an independent dispute state", async () => {
  const db = await freshDatabase();
  try {
    for (const [user, role] of [[actor, "artisan"], [assignee, "artisan"], [requester, "client"], [operator, "client"]]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [user.id, user.email, { role, full_name: "Compte de recette" }]);
    }
    await db.query("update public.profiles set role='admin' where id=$1", [operator.id]);
    const job = (await db.query(`insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents,status,paid_at)
      values($1,$2,'socket','Intervention de recette','Adresse fictive','97200','Fort-de-France','scheduled',2000,5000,'paid',now()) returning id`, [requester.id, actor.id])).rows[0].id;
    const quote = (await db.query(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,accepted_at)
      values($1,$2,'[]',6510,0,0,6510,'accepted',now()) returning id`, [job, actor.id])).rows[0].id;
    const payment = (await db.query(`insert into public.payments(quote_id,session_id,total_cents,status,paid_at)
      values($1,'cs_test_dispute_fixture',6510,'paid',now()) returning id`, [quote])).rows[0].id;
    const opened = await asUser(db, operator, "select public.platform_open_dispute($1,$2,'platform','Sujet privé de recette','Description privée de recette') v", [randomUUID(), payment]);
    await asUser(db, operator, "select public.platform_decide_dispute($1,'review',1) v", [opened.dispute.id]);
    assert.equal(await asUser(db, operator, "select status v from public.platform_disputes where id=$1", [opened.dispute.id]), "under_review");
    assert.equal(await asUser(db, actor, "select count(*)::int v from public.platform_disputes where id=$1", [opened.dispute.id]), 0);
    await withNext(db, async http => {
      const path = `/api/payments/status?quote_id=${quote}`;
      const own = await http(path);
      assert.equal(own.status, 200);
      assert.equal(own.headers.get("cache-control"), "private, no-store");
      const body = await own.json();
      assert.deepEqual([body.payment.status, body.payment.total_cents, body.artisan_dispute], ["paid", 6510, "under_review"]);
      assert.doesNotMatch(JSON.stringify(body), /Sujet privé|Description privée|cs_test_|refund_request_id/);
      const client = await http(path, {}, requester);
      assert.equal(client.status, 200);
      assert.equal(Object.hasOwn(await client.json(), "artisan_dispute"), false);
      assert.equal((await http(path, {}, assignee)).status, 404);
      await db.query("update public.interventions set artisan_id=$1 where id=$2", [assignee.id, job]);
      assert.equal((await http(path)).status, 404);
      const replacement = await http(path, {}, assignee);
      assert.equal(replacement.status, 200);
      assert.equal(Object.hasOwn(await replacement.json(), "artisan_dispute"), false);
    }, {}, { users: [actor, assignee, requester], rpcAllowlist: new Set(["artisan_payment_dispute"]), handle: readGateway(db) });
  } finally {
    await db.close();
  }
});
