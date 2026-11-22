import assert from "node:assert/strict";
import test from "node:test";
import { actor, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

function reportGateway(db, pages, state) {
  return async (request, response, { user, send }) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/rest/v1/rpc/professional_report" || request.method !== "POST") return false;
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const args = JSON.parse(raw);
    assert.match(request.headers.prefer, /count=exact/);
    const limit = Number(url.searchParams.get("limit"));
    assert.ok([1000, 1001].includes(limit));
    const after = url.searchParams.get("site_id");
    if (after) assert.match(after, /^gt\.[0-9a-f-]+$/);
    if (url.searchParams.has("order")) assert.equal(url.searchParams.get("order"), "site_id.asc");
    const rows = await asUser(db, user, `select coalesce(jsonb_agg(to_jsonb(r) order by r.site_id),'[]') v
      from public.professional_report($1,$2) r where $3::uuid is null or r.site_id > $3::uuid`, [args.p_site_id, args.p_organization_id, after?.slice(3) ?? null]);
    pages.push({ limit, after: after?.slice(3) ?? null, total: rows.length });
    // Match the hosting provider's standard max-rows cap independently of the route limit.
    const items = state.truncateTail && after ? [] : rows.slice(0, Math.min(limit, 1000));
    response.setHeader("Content-Range", items.length ? `0-${items.length - 1}/${rows.length}` : "*/0");
    send(200, items);
    return true;
  };
}

test("E61 — real report and CSV cover 1001 visible sites without duplicate or unscoped rows", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, requester]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [user.id, user.email, { role: "manager", full_name: "Compte de recette" }]);
    }
    const org = (await db.query("insert into public.organizations(name,owner_id) values('Organisation QA',$1) returning id", [actor.id])).rows[0].id;
    await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')", [org, actor.id]);
    const sites = (await db.query(`insert into public.sites(id,organization_id,name,type,address,budget_cents)
      select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Site QA '||n,'office','Adresse fictive',100
      from generate_series(1,1001) n returning id`, [org])).rows.map(row => row.id).sort();
    const pages = [];
    const state = { truncateTail: false };
    await withNext(db, async http => {
      const path = `/api/reports?organization_id=${org}`;
      const first = await http(path);
      const second = await http(`${path}&after=${sites[999]}`);
      const csv = await http(`${path}&format=csv`);
      assert.deepEqual([first.status, second.status, csv.status], [200, 200, 200]);
      const [initial, next] = await Promise.all([first.json(), second.json()]);
      assert.deepEqual([initial.scope.complete, next.scope.complete], [false, false]);
      assert.deepEqual(initial.page, { limit: 1000, has_more: true, next_after: sites[999] });
      assert.deepEqual(next.page, { limit: 1000, has_more: false, next_after: null });
      assert.deepEqual([...initial.sites, ...next.sites].map(row => row.site_id), sites);
      assert.deepEqual([initial.totals.budget_cents, next.totals.budget_cents], [100000, 100]);
      assert.match(csv.headers.get("content-type"), /^text\/csv/);
      const lines = (await csv.text()).split("\r\n");
      assert.equal(lines.length, 1002);
      assert.match(lines[1], /^"Site QA 1";/);
      assert.match(lines.at(-1), /^"Site QA 1001";/);
      assert.equal((await http(`${path}&site_id=${sites[1000]}`)).status, 200);
      assert.equal((await http(path, {}, requester)).status, 404);
      assert.equal((await http(`${path}&format=csv&after=${sites[999]}`)).status, 422);
      assert.ok(pages.filter(page => page.after === sites[999]).length >= 2, "both JSON and CSV advance using the SQL cursor");
      state.truncateTail = true;
      await assert.rejects(async () => (await http(`${path}&format=csv`)).arrayBuffer(),
        "a truncated later page must abort the download, never finish a partial file");
    }, {}, { users: [actor, requester], handle: reportGateway(db, pages, state) });
  } finally {
    await db.close();
  }
});
