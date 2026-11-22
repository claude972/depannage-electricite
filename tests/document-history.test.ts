import test from "node:test";
import assert from "node:assert/strict";
import { harness, uuid, type Handler, type Row } from "./planning/harness";
const job = uuid(1, "70000000"), otherJob = uuid(2, "70000000"), user = uuid(1), otherUser = uuid(2);
const documents: Row[] = Array.from({ length: 237 }, (_, i) => ({
  id: uuid(i + 1, "60000000"), intervention_id: i % 3 === 0 ? null : i % 3 === 1 ? job : otherJob,
  owner_id: i % 2 ? user : otherUser, name: `Document ${i}`, mime_type: "image/png",
  created_at: `2026-10-31T12:00:00.${String(123000 + Math.floor(i / 4)).padStart(6, "0")}+00:00`,
  path: `private-storage/${i}`, service_key: "must-never-leave-server", url: "private-signed-url",
}));
function routes(options: Parameters<typeof harness>[0] = {}) {
  const h = harness({ role: "client", userId: user, tables: { interventions: [{ id: job }, { id: otherJob }], documents }, ...options });
  const mod = h.load("app/api/documents/history/route.ts");
  return { ...h, get: (query = "") => (mod.GET as Handler)(h.request(`/api/documents/history?${query}`)) };
}
const privateResponse = (r: Response) => assert.equal(r.headers.get("Cache-Control"), "private, no-store");

test("global history traverses237 RLS-visible documents, including shared and standalone, without private paths or lost ties", async () => {
  const h = routes(); let cursor: string | null = null; const seen: string[] = [];
  do {
    const params = new URLSearchParams({ limit: "17" }); if (cursor) params.set("cursor", cursor);
    const r = await h.get(params.toString()); assert.equal(r.status, 200); privateResponse(r);
    const body = await r.json(); assert.equal(body.page.limit, 17); assert.equal(body.page.has_more, body.page.next_cursor !== null);
    for (const row of body.documents) assert.deepEqual(Object.keys(row).sort(), ["id", "intervention_id", "owner_id", "name", "mime_type", "created_at"].sort());
    const text = JSON.stringify(body); for (const hidden of ["private-storage", "service_key", "private-signed-url"]) assert.ok(!text.includes(hidden));
    seen.push(...body.documents.map((row: Row) => String(row.id))); cursor = body.page.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 237); assert.equal(new Set(seen).size, 237); assert.deepEqual(seen, [...documents].reverse().map(row => row.id));
  assert.equal(h.requests.some(r => r.table === "interventions"), false, "global history does not enumerate or require a parent");
  assert.ok(h.requests.every(r => r.table === "documents" && !r.url.searchParams.has("owner_id") && !r.url.searchParams.has("intervention_id") && r.url.searchParams.get("limit") === "18"));
});

test("job-filtered pages contain only that parent; boundary deletion and new inserts preserve older traversal", async () => {
  const h = routes(); let cursor: string | null = null; const ids: string[] = [];
  do { const q = new URLSearchParams({ intervention_id: job, limit: "13" }); if (cursor) q.set("cursor", cursor);
    const r = await h.get(q.toString()); assert.equal(r.status, 200); const body = await r.json();
    assert.ok(body.documents.every((row: Row) => row.intervention_id === job)); ids.push(...body.documents.map((row: Row) => String(row.id))); cursor = body.page.next_cursor;
  } while (cursor);
  assert.deepEqual(ids, [...documents].reverse().filter(row => row.intervention_id === job).map(row => row.id));
  assert.ok(h.requests.filter(r => r.table === "documents").every(r => r.url.searchParams.get("intervention_id") === `eq.${job}`));
  const first = await (await routes().get("limit=100")).json();
  const rows = documents.filter(row => row.id !== first.documents.at(-1).id);
  rows.push({ ...documents[0], id: uuid(999), created_at: "2026-11-01T00:00:00Z" });
  const next = await (await routes({ tables: { documents: rows } }).get(new URLSearchParams({ limit: "100", cursor: first.page.next_cursor }).toString())).json();
  assert.deepEqual(next.documents.map((row: Row) => row.id), [...documents].reverse().slice(100, 200).map(row => row.id));
});

test("empty global and visible job histories succeed; hidden/missing parent give identical404 without child lookup", async () => {
  const h = routes({ tables: { interventions: [{ id: job }], documents: [] } });
  for (const q of ["", `intervention_id=${job}`]) { const r = await h.get(q); assert.equal(r.status, 200); privateResponse(r); assert.deepEqual(await r.json(), { documents: [], page: { limit: 25, has_more: false, next_cursor: null } }); }
  const hidden = routes({ tables: { interventions: [], documents } }), missing = routes({ tables: { interventions: [], documents: [] } });
  const a = await hidden.get(`intervention_id=${job}`), b = await missing.get(`intervention_id=${otherJob}`);
  assert.equal(a.status, 404); assert.equal(b.status, 404); privateResponse(a); privateResponse(b); assert.equal(await a.text(), await b.text());
  assert.equal(hidden.requests.length, 1); assert.equal(hidden.requests[0].table, "interventions");
});

test("cursor is bound to verified user and global/job scope; malformed/injected/duplicate filters are rejected before reads", async () => {
  const global = await (await routes().get("limit=1")).json();
  const scoped = await (await routes().get(`intervention_id=${job}&limit=1`)).json();
  const q = (cursor: string, id?: string) => new URLSearchParams({ cursor, ...(id ? { intervention_id: id } : {}) }).toString();
  const invalid = [q(global.page.next_cursor, job), q(scoped.page.next_cursor), q(scoped.page.next_cursor, otherJob), "limit=0", "limit=101", "limit=01", "limit=2&limit=3", "intervention_id=", "intervention_id=broken", `intervention_id=${job}&intervention_id=${job}`, `owner_id=${otherUser}`, "path=private", "cursor=", "cursor=e30", "cursor=bad=", "x="+"a".repeat(4096)];
  const cursor = (patch: Row) => Buffer.from(JSON.stringify({ v: 1, user_id: user, intervention_id: null, id: uuid(1), created_at: "2026-10-31T12:00:00Z", ...patch })).toString("base64url");
  invalid.push(...[cursor({ user_id: otherUser }), cursor({ extra: "x" }), cursor({ created_at: '2026-10-31T12:00:00Z",id.gt.0' }), cursor({ id: "x),id.gt.0" }), cursor({ v: 2 })].map(c => q(c)));
  for (const query of invalid) { const h = routes(); const r = await h.get(query); assert.equal(r.status, 422, query); privateResponse(r); assert.equal(h.requests.length, 0); }
  const switched = routes({ userId: otherUser }); assert.equal((await switched.get(q(global.page.next_cursor))).status, 422); assert.equal(switched.requests.length, 0);
  assert.equal((await routes().get(`intervention_id=${job.toUpperCase()}`)).status, 200);
});

test("authentication precedes filter validation and every response is private", async () => {
  const h = routes({ role: null }); const r = await h.get("limit=bad&owner_id=x"); assert.equal(r.status, 401); privateResponse(r); assert.equal(h.requests.length, 0);
});

test("malformed rows, oversized results, SQL and transport errors fail503 with retry instead of exposing partial data", async () => {
  for (const data of [null, [{ ...documents[0], created_at: "bad" }], [{ ...documents[0], owner_id: null }], [{ ...documents[0], intervention_id: "bad" }], [{ ...documents[0], unknown_private: "secret" }], Array(27).fill(documents[0])]) {
    const h = routes(); const original = h.db.from.bind(h.db);
    h.db.from = ((table: string) => { if (table !== "documents") return original(table); const query = { select: () => query, order: () => query, limit: async () => ({ data, error: null }) }; return query; }) as typeof h.db.from;
    const r = await h.get(); assert.equal(r.status, 503); privateResponse(r); assert.equal(r.headers.get("Retry-After"), "2"); assert.ok(!(await r.text()).includes("secret"));
  }
  for (const table of ["documents", "interventions"]) for (const mode of ["transport", "sql", "malformed-parent"]) {
    const h = routes(); const original = h.db.from.bind(h.db);
    h.db.from = ((name: string) => { if (name !== table) return original(name); if (mode === "transport") throw Error("private-db-details"); const query = { select: () => query, eq: () => query, order: () => query, limit: async () => mode === "sql" ? ({ data: null, error: { code: "42501", message: "private-db-details" } }) : ({ data: [{ id: otherJob }], error: null }) }; return query; }) as typeof h.db.from;
    const r = await h.get(`intervention_id=${job}`); assert.equal(r.status, 503); privateResponse(r); assert.equal(r.headers.get("Retry-After"), "2"); assert.ok(!(await r.text()).includes("private-db-details"));
  }
});
