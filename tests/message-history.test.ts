import test from "node:test";
import assert from "node:assert/strict";
import { harness, uuid, type Handler, type Row } from "./planning/harness";
const job = uuid(1, "70000000"), foreign = uuid(2, "70000000");
const messages: Row[] = Array.from({ length: 237 }, (_, i) => ({
  id: uuid(i + 1, "60000000"), intervention_id: job, author_id: uuid(i % 2 + 1), body: `Message ${i}`,
  created_at: `2026-10-31T12:00:00.${String(123000 + Math.floor(i / 4)).padStart(6, "0")}+00:00`,
}));
function routes(options: Parameters<typeof harness>[0] = {}) {
  const h = harness({ role: "client", tables: { interventions: [{ id: job }], messages }, ...options });
  const mod = h.load("app/api/messages/route.ts");
  return { ...h, get: (query = `intervention_id=${job}`) => (mod.GET as Handler)(h.request(`/api/messages?${query}`)),
    post: (body: unknown) => (mod.POST as Handler)(h.request("/api/messages", body)) };
}
const privateResponse = (r: Response) => assert.equal(r.headers.get("Cache-Control"), "private, no-store");

test("conversation pages beyond200 with exact ties and microseconds; rows stay scoped and projections closed", async () => {
  const h = routes({ tables: { interventions: [{ id: job }], messages: [...messages, { ...messages[0], id: uuid(999), intervention_id: foreign, body: "private-other" }] } });
  let cursor: string | null = null; const seen: string[] = [];
  do {
    const params = new URLSearchParams({ intervention_id: job, limit: "17" }); if (cursor) params.set("cursor", cursor);
    const r = await h.get(params.toString()); assert.equal(r.status, 200); privateResponse(r);
    const body = await r.json(); assert.equal(body.page.limit, 17);
    assert.equal(body.page.has_more, body.page.next_cursor !== null);
    for (const row of body.messages) {
      assert.deepEqual(Object.keys(row).sort(), ["id", "intervention_id", "author_id", "body", "created_at"].sort());
      assert.equal(row.intervention_id, job); assert.notEqual(row.body, "private-other");
    }
    seen.push(...body.messages.map((row: Row) => String(row.id))); cursor = body.page.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 237); assert.equal(new Set(seen).size, 237);
  assert.deepEqual(seen, [...messages].reverse().map(row => row.id));
  assert.ok(h.requests.filter(r => r.table === "messages").every(r => r.url.searchParams.get("intervention_id") === `eq.${job}` && r.url.searchParams.get("limit") === "18"));
});

test("cursor is independent of deleting its boundary row and newer inserts do not disturb older traversal", async () => {
  const first = await (await routes().get(`intervention_id=${job}&limit=100`)).json();
  const boundary = first.messages.at(-1).id;
  const remaining = messages.filter(row => row.id !== boundary);
  const newer = { ...messages[0], id: uuid(900), created_at: "2026-11-01T00:00:00.000000+00:00" };
  const h = routes({ tables: { interventions: [{ id: job }], messages: [...remaining, newer] } });
  const next = await (await h.get(new URLSearchParams({ intervention_id: job, limit: "100", cursor: first.page.next_cursor }).toString())).json();
  assert.deepEqual(next.messages.map((r: Row) => r.id), [...messages].reverse().slice(100, 200).map(row => row.id));
});

test("empty visible conversation succeeds; hidden/missing parent are identical404 without messages probe", async () => {
  const empty = routes({ tables: { interventions: [{ id: job }], messages: [] } });
  const r = await empty.get(); assert.equal(r.status, 200); privateResponse(r);
  assert.deepEqual(await r.json(), { messages: [], page: { limit: 25, has_more: false, next_cursor: null } });
  const hidden = routes({ tables: { interventions: [], messages } });
  const missing = routes({ tables: { interventions: [], messages: [] } });
  const a = await hidden.get(), b = await missing.get(); assert.equal(a.status, 404); assert.equal(b.status, 404); privateResponse(a); privateResponse(b);
  assert.equal(await a.text(), await b.text()); assert.equal(hidden.requests.length, 1); assert.equal(hidden.requests[0].table, "interventions");
});

test("authentication precedes validation; strict filters/cursor reject duplicate, injected and foreign context", async () => {
  const anon = routes({ role: null }); const r = await anon.get("limit=broken"); assert.equal(r.status, 401); privateResponse(r); assert.equal(anon.requests.length, 0);
  const first = await (await routes().get(`intervention_id=${job}&limit=1`)).json();
  const badCursor = (patch: Row) => Buffer.from(JSON.stringify({ v: 1, intervention_id: job, id: uuid(1), created_at: "2026-10-31T12:00:00Z", ...patch })).toString("base64url");
  const invalid = ["", "intervention_id=broken", `intervention_id=${job}&limit=0`, `intervention_id=${job}&limit=101`, `intervention_id=${job}&limit=01`, `intervention_id=${job}&limit=2&limit=3`, `intervention_id=${job}&author_id=${uuid(1)}`, `intervention_id=${job}&intervention_id=${job}`, `intervention_id=${foreign}&cursor=${first.page.next_cursor}`, ...["", "e30", "garbage=", badCursor({ v: 2 }), badCursor({ id: "x),id.gt.0" }), badCursor({ created_at: '2026-10-31T12:00:00Z",id.gt.0' }), badCursor({ extra: "private" })].map(cursor => `intervention_id=${job}&cursor=${cursor}`)];
  for (const q of invalid) { const h = routes(); const response = await h.get(q); assert.equal(response.status, 422, q); privateResponse(response); assert.equal(h.requests.length, 0); }
  assert.equal((await routes().get(`intervention_id=${job.toUpperCase()}`)).status, 200);
});

test("malformed database responses and transport failures return503 with retry and no raw details", async () => {
  for (const row of [{ ...messages[0], intervention_id: foreign }, { ...messages[0], created_at: "broken" }, { ...messages[0], author_id: null }]) {
    // A wrong-parent fixture is filtered by PostgREST normally; force its result below to test fail-closed handling.
    const h = routes(); const original = h.db.from.bind(h.db);
    h.db.from = ((table: string) => {
      if (table !== "messages") return original(table);
      const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [row], error: null }) }; return q;
    }) as typeof h.db.from;
    const r = await h.get(); assert.equal(r.status, 503); privateResponse(r); assert.equal(r.headers.get("Retry-After"), "2");
  }
  for (const table of ["interventions", "messages"]) {
    const h = routes(); const original = h.db.from.bind(h.db);
    h.db.from = ((name: string) => { if (name === table) throw new Error("private-db-details"); return original(name); }) as typeof h.db.from;
    const r = await h.get(); assert.equal(r.status, 503); privateResponse(r); assert.ok(!(await r.text()).includes("private-db-details"));
  }
});

test("existing POST keeps exact identity-free send_message command and refuses invalid inputs", async () => {
  const h = routes({ rpcData: messages[0] }); const r = await h.post({ intervention_id: job, body: "Bonjour" });
  assert.equal(r.status, 201); assert.deepEqual(h.requests[0].args, { p_intervention_id: job, p_body: "Bonjour" });
  assert.equal((await routes().post({ intervention_id: job, body: "Bonjour", author_id: uuid(2) })).status, 422);
});
