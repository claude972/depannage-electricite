import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, loadModule } from "./documents/harness";

const uid = (n: number) => `13000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uid(1);
const organization = uid(2);
const other = uid(3);
const createdAt = "2026-11-07T09:00:00.123456-04:00";

function row(n: number) {
  return {
    id: uid(n), organization_id: organization, title: "Contrat synthétique", reference: "QA",
    starts_on: "2026-11-07", ends_on: null, status: "active", created_at: createdAt,
    terms: "Conditions privées", created_by: actor,
  };
}

type Options = {
  rows?: unknown[];
  actor?: string;
  role?: string;
  access?: unknown;
  deniedAfterRead?: boolean;
  failRead?: boolean;
  anonymous?: boolean;
};

function setup(options: Options = {}) {
  const calls: unknown[][] = [];
  let queried = false;
  const db = {
    from(table: string) {
      calls.push(["from", table]);
      const chain: Record<string, (...args: never[]) => unknown> = {};
      for (const name of ["select", "eq", "or", "order"]) {
        chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
      }
      chain.maybeSingle = async () => ({ data: { role: options.role ?? "manager" }, error: null });
      chain.limit = async (...args: unknown[]) => {
        calls.push(["limit", ...args]);
        queried = true;
        return { data: options.rows ?? [], error: options.failRead ? { code: "XX000" } : null };
      };
      return chain;
    },
    async rpc(name: string, args: unknown) {
      calls.push(["rpc", name, structuredClone(args)]);
      return { data: queried && options.deniedAfterRead ? false : options.access ?? true, error: null };
    },
  };
  const handler = loadModule("lib/features/enterprise-contracts/handler.ts", {
    "@/lib/supabase/server": {
      ApiError,
      authenticatedClient: async () => {
        if (options.anonymous) throw new ApiError(401, "Connexion requise.");
        return { db, user: { id: options.actor ?? actor } };
      },
      dbError(error: unknown) { if (error) throw new Error("Read failed"); },
    },
  }) as unknown as typeof import("@/lib/features/enterprise-contracts/handler");
  const base = "http://localhost/api/enterprise/contracts";
  return {
    calls,
    list: (extra = "", org = organization) => handler.GET(new Request(`${base}?organization_id=${org}${extra}`)),
    detail: (id = uid(101), org = organization) => handler.GET_DETAIL(
      new Request(`${base}/${id}?organization_id=${org}`), { params: Promise.resolve({ id }) },
    ),
  };
}

test("stable 50-item pages beyond 100 contracts, without contract terms in list", async () => {
  const all = Array.from({ length: 101 }, (_, index) => row(301 - index));
  const found = [];
  let cursor = "";
  for (const [index, expectedSize] of [50, 50, 1].entries()) {
    const harness = setup({ rows: all.slice(index * 50, index * 50 + 51) });
    const response = await harness.list(cursor ? "&cursor=" + cursor : "");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.items.length, expectedSize);
    assert.equal(result.page.limit, 50);
    assert.equal(result.page.has_more, index < 2);
    assert.ok(result.items.every((item: object) => !("terms" in item) && !("created_by" in item)));
    assert.ok(harness.calls.some((call) => call[0] === "eq" && call[1] === "organization_id" && call[2] === organization));
    if (cursor) assert.ok(harness.calls.some((call) => call[0] === "or"));
    cursor = result.page.next_cursor;
    found.push(...result.items.map((item: { id: string }) => item.id));
  }
  assert.deepEqual(found, all.map((item) => item.id));
  assert.equal(cursor, null);
});

test("exact contract details and empty states, with no cross-organization data", async () => {
  const harness = setup({ rows: [row(101)] });
  const response = await harness.detail();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { contract } = await response.json();
  assert.equal(contract.terms, "Conditions privées");
  assert.equal(contract.created_by, undefined);
  assert.ok(harness.calls.some((call) => call[0] === "eq" && call[1] === "id" && call[2] === uid(101)));
  assert.equal((await setup().detail()).status, 404);
  assert.equal((await setup({ rows: [row(102)] }).detail()).status, 503);
  assert.equal((await setup({ rows: [row(101)] }).detail(uid(101), other)).status, 503);
  assert.deepEqual(await (await setup().list()).json(), {
    items: [], page: { limit: 50, has_more: false, next_cursor: null },
  });
});

test("current organization-wide permission, role, and valid cursor are required", async () => {
  const denied = setup({ access: false });
  const response = await denied.list();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(!denied.calls.some((call) => call[0] === "from" && call[1] === "contracts"));
  assert.deepEqual(denied.calls.find((call) => call[0] === "rpc"), [
    "rpc", "can_access_organization_wide", { p_organization_id: organization, p_write: false },
  ]);
  assert.equal((await setup({ rows: [row(101)], deniedAfterRead: true }).detail()).status, 404);
  assert.equal((await setup({ rows: [row(101)], deniedAfterRead: true }).list()).status, 404);
  assert.equal((await setup({ role: "artisan" }).list()).status, 403);
  assert.equal((await setup({ anonymous: true }).list()).status, 401);
  const firstPage = await setup({ rows: Array.from({ length: 51 }, (_, n) => row(101 - n)) }).list();
  assert.equal(firstPage.status, 200);
  const { page } = await firstPage.json();
  const extra = "&cursor=" + page.next_cursor;
  assert.equal((await setup().list(extra, other)).status, 422);
  assert.equal((await setup({ actor: uid(4) }).list(extra)).status, 422);
  for (const invalid of ["&cursor=", "&cursor=!invalid", "&organization_id=" + organization, "&limit=4"]) {
    assert.equal((await setup().list(invalid)).status, 422);
  }
});

test("read failures and invalid rows cannot masquerade as an empty list", async () => {
  const response = await setup({ failRead: true }).list();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal((await setup({ rows: [row(101), row(101)] }).list()).status, 503);
  assert.equal((await setup({ rows: [row(101), row(102)] }).list()).status, 503);
  assert.equal((await setup({ rows: [{ ...row(101), organization_id: other }] }).list()).status, 503);
  assert.equal((await setup({ access: "true" }).list()).status, 503);
});
