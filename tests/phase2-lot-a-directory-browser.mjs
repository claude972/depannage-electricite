import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { serveLiveAdmin } from "./ui/admin-live-space-harness.ts";
import { actor, assignee, requester, asUser, freshDatabase, withNext } from "./phase2-lot-a-http-harness.mjs";

const searchPath = "/api/admin/directory";
const canonical = "Élodie";
const decomposed = canonical.normalize("NFD");
const family = "Recette Accent";

function profileGateway(db) {
  return async (request, response, { user, send }) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/rest/v1/profiles") return false;
    if (url.searchParams.get("select") === "role") {
      assert.equal(url.searchParams.get("id"), `eq.${user.id}`);
      const row = await asUser(db, user, "select jsonb_build_object('role',role) v from public.profiles where id=$1", [user.id]);
      send(200, row);
      return true;
    }
    assert.equal(url.searchParams.get("role"), "in.(client,manager)");
    assert.equal(url.searchParams.get("select"), "id,full_name,phone,role,created_at");
    const raw = url.searchParams.get("full_name");
    const computed = url.searchParams.get("directory_profile_name");
    assert.ok(!(raw && computed));
    const filter = raw ?? computed;
    if (filter !== null) assert.ok(filter.startsWith("ilike.%") && filter.endsWith("%"));
    const nameExpression = computed ? "public.directory_profile_name(p)" : "p.full_name";
    const rows = await asUser(db, user, `select coalesce(jsonb_agg(to_jsonb(r)), '[]') v from (
      select id,full_name,phone,role,created_at from public.profiles p
      where role in ('client','manager') and ($1::text is null or ${nameExpression} ilike $1)
      order by created_at desc, id desc) r`, [filter?.slice(6) ?? null]);
    response.setHeader("Content-Range", `0-${rows.length - 1}/${rows.length}`);
    send(200, rows);
    return true;
  };
}

test("E33 — Chromium searches an accent composed either way in the mounted client directory", async () => {
  assert.ok(process.env.QA_PLAYWRIGHT_PATH && process.env.QA_CHROMIUM_PATH, "Provide installed Playwright and Chromium paths");
  const { chromium } = await import(pathToFileURL(resolve(process.env.QA_PLAYWRIGHT_PATH, "index.mjs")).href);
  const db = await freshDatabase();
  let browser, fixture;
  try {
    for (const account of [actor, assignee, requester]) {
      await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [account.id, account.email, { role: "client", full_name: "Compte QA" }]);
    }
    await db.query("update public.profiles set role='admin' where id=$1", [actor.id]);
    await withNext(db, async http => {
      for (const [name, account] of [[canonical, requester], [decomposed, assignee]]) {
        const result = await http("/api/profile", { method: "PATCH", body: JSON.stringify({
          first_name: name, last_name: family, full_name: `${name} ${family}`, phone: "",
        }) }, account);
        assert.equal(result.status, 200);
        assert.equal((await result.json()).profile.first_name, name);
      }
      const stored = await db.query("select id,full_name from public.profiles where id=any($1::uuid[])", [[requester.id, assignee.id]]);
      assert.equal(new Map(stored.rows.map(row => [row.id, row.full_name])).get(assignee.id), `${decomposed} ${family}`);
      const forbidden = await http(`${searchPath}?kind=clients&q=${encodeURIComponent(`${canonical} ${family}`)}`, {}, requester);
      assert.equal(forbidden.status, 403);
      fixture = await serveLiveAdmin(`window.view = "admin-clients"; window.seed = { session: {
        loadAdminDirectory: (kind, filters) => window.directoryLookup(kind, filters),
      } };`);
      browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM_PATH });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const lookups = [];
      await page.exposeFunction("directoryLookup", async (kind, filters) => {
        if (kind !== "clients") return null;
        const query = new URLSearchParams({ kind, limit: String(filters.limit) });
        if (filters.q) query.set("q", filters.q);
        const response = await http(`${searchPath}?${query}`);
        const data = await response.json();
        if (filters.q) lookups.push({ q: filters.q, status: response.status, ids: data.items?.map(row => row.id), total: data.page?.total });
        return response.ok ? data : null;
      });
      await page.route("**/*", route => new URL(route.request().url()).origin === new URL(fixture.url).origin ? route.continue() : route.abort());
      await page.goto(fixture.url);
      const table = page.getByRole("table", { name: "Annuaire des clients" });
      const input = page.locator("#admin-client-search");
      await table.waitFor();
      const expected = [requester.id, assignee.id].sort();
      for (const [index, name] of [decomposed, canonical].entries()) {
        await input.fill(`${name} ${family}`);
        await input.press("Enter");
        await page.waitForFunction(() => Boolean(document.querySelector("table")));
        const start = Date.now();
        while (lookups.length <= index && Date.now() - start < 8000) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(lookups[index]?.status, 200);
        assert.deepEqual([lookups[index].total, [...lookups[index].ids].sort()], [2, expected]);
        await table.getByRole("row").nth(2).waitFor();
        assert.equal(await table.getByRole("row").count(), 3);
      }
    }, {}, { users: [actor, assignee, requester], rpcAllowlist: new Set(["update_profile_name"]), handle: profileGateway(db) });
  } finally {
    await browser?.close();
    if (fixture) await new Promise(resolve => fixture.server.close(resolve));
    await db.close();
  }
});
