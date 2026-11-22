import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, fakeServerHelpers } from "./documents/harness";

const actor = "10000000-0000-4000-8000-000000000009";
const url = "https://app.example/api/profile/data";
const id = (n: number) => "20000000-0000-4000-8000-" + String(n).padStart(12, "0");
const row = (n: number) => ({
  id: id(n), author_id: actor, intervention_id: id(400), body: "Message personnel",
  created_at: "2026-11-07T00:00:00Z", unexpected_secret: "must not be exposed",
});
const requestRow=(owner=actor)=>({id:id(800),account_id:owner,ticket_id:id(300),state:'requested',execution_state:'not_started',version:1,created_at:'2026-11-07T00:00:00Z',updated_at:'2026-11-07T00:00:00Z'});
const receipt = (creator = actor) => ({request:requestRow(creator),ticket_id:id(300),status:'open',replayed:true});

function harness(data: unknown, authenticated = true) {
  const queries: unknown[][] = [];
  const chain = {
    select: (...params: unknown[]) => { queries.push(["select", ...params]); return chain; },
    eq: (...params: unknown[]) => { queries.push(["eq", ...params]); return chain; },
    is: (...params: unknown[]) => { queries.push(["is", ...params]); return chain; },
    gt: (...params: unknown[]) => { queries.push(["gt", ...params]); return chain; },
    order: (...params: unknown[]) => { queries.push(["order", ...params]); return chain; },
    limit: async (...params: unknown[]) => { queries.push(["limit", ...params]); return { data, error: null }; },
  };
  const db = {
    from: (table: string) => { queries.push(["from", table]); return chain; },
    rpc: async (name: string, params: unknown) => {
      queries.push(["rpc", name, params]); return { data, error: null };
    },
  };
  const route = loadModule("app/api/profile/data/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({ db, authenticated }),
  }) as { GET: (request: Request) => Promise<Response>; POST: (request: Request) => Promise<Response> };
  return { ...route, queries };
}

test("data export scopes a keyset page to the signed-in author and projects allowlisted fields", async () => {
  const h = harness(Array.from({ length: 101 }, (_, i) => row(i + 5)));
  const r = await h.GET(new Request(url + "?section=messages&after=" + id(4)));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  const page = await r.json();
  assert.equal(page.rows.length, 100);
  assert.equal(page.next_cursor, id(104));
  assert.equal(Object.hasOwn(page.rows[0], "unexpected_secret"), false);
  assert.deepEqual(h.queries.slice(2), [["eq", "author_id", actor], ["gt", "id", id(4)], ["order", "id"], ["limit", 101]]);
});

test("personal requests exclude organization rows and reject a response containing one", async () => {
  const empty = harness([]);
  assert.equal((await empty.GET(new Request(url + "?section=requests"))).status, 200);
  assert.deepEqual(empty.queries[3], ["is", "site_id", null]);
  const foreign = harness([{ id: id(1), client_id: id(999), site_id: id(2) }]);
  assert.equal((await foreign.GET(new Request(url + "?section=requests"))).status, 503);
  const authless = harness([], false);
  assert.equal((await authless.GET(new Request(url))).status, 401);
  assert.equal((await empty.GET(new Request(url + "?section=addresses&section=messages"))).status, 422);
});

test("erasure requires confirmation and records a single private support request on replay", async () => {
  const post = (confirmed: boolean, origin = "https://app.example") => new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ action: "request_erasure", request_id: id(2), confirmed }),
  });
  const h = harness(receipt());
  assert.equal((await h.POST(post(false))).status, 422);
  assert.equal((await h.POST(post(true, "https://another.example"))).status, 403);
  assert.equal(h.queries.length, 0);
  const response = await h.POST(post(true));
  const result=await response.json();assert.equal(result.ticket_id,id(300));assert.equal(result.status,'open');assert.equal(result.replayed,true);assert.equal(result.request.state,'requested');assert.equal(result.request.execution_state,'not_started');assert.equal(result.request.account_id,undefined);
  assert.equal(h.queries[0]?.[1], "create_data_erasure_request");
  assert.equal((h.queries[0]?.[2] as { p_request_id: string }).p_request_id, id(2));
  const wrongUser = harness(receipt(id(500)));
  assert.equal((await wrongUser.POST(post(true))).status, 503);
});

test('personal erasure list is account scoped and strips all ticket content',async()=>{
 const h=harness({rows:[{...requestRow(),subject:'SECRET',body:'SECRET'}],next_cursor:null});const r=await h.GET(new Request(url+'?section=erasure_requests'));assert.equal(r.status,200);const data=await r.json();assert.equal(data.rows[0].execution_state,'not_started');assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.deepEqual(JSON.parse(JSON.stringify(h.queries)),[['rpc','list_data_erasure_requests',{p_all:false,p_after:null,p_limit:100}]]);
 const other=harness({rows:[requestRow(id(500))],next_cursor:null});assert.equal((await other.GET(new Request(url+'?section=erasure_requests'))).status,503);
});

test("personal booking locations include pending and confirmed reservations and strip the account key", async () => {
  const point = { latitude: 14.605, longitude: -61.07, access_details: "Entrée côté jardin" };
  const manual = { latitude: null, longitude: null, access_details: "Code communiqué sur place" };
  const pending = { id: id(6), actor_id: actor, intervention_id: null, location: manual };
  const confirmed = { id: id(7), actor_id: actor, intervention_id: id(95), location: point };
  const h = harness([pending, confirmed]);
  const request = () => new Request(url + "?section=booking_locations&after=" + id(5));
  const response = await h.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    section: "booking_locations",
    rows: [
      { id: pending.id, intervention_id: null, location: manual },
      { id: confirmed.id, intervention_id: confirmed.intervention_id, location: point },
    ],
    next_cursor: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(h.queries)), [["rpc", "export_personal_booking_locations", { p_after: id(5) }]]);

  const foreign = { ...confirmed, actor_id: id(999) };
  assert.equal((await harness([pending, foreign]).GET(request())).status, 503);
  assert.equal((await harness([pending, { ...confirmed, location: { ...point, latitude: null } }]).GET(request())).status, 503);
  assert.equal((await harness([confirmed, pending]).GET(request())).status, 503);
  assert.equal((await harness([pending], false).GET(request())).status, 401);

  const many = Array.from({ length: 101 }, (_, i) => ({ ...confirmed, id: id(i + 6) }));
  const paged = await (await harness(many).GET(request())).json();
  assert.equal(paged.rows.length, 100);
  assert.equal(paged.next_cursor, id(105));
  const untrustedLookahead = [...many.slice(0, 100), { ...many[100], actor_id: foreign.actor_id }];
  assert.equal((await harness(untrustedLookahead).GET(request())).status, 503);
});
