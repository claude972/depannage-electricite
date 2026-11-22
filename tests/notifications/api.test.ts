import test from "node:test";
import assert from "node:assert/strict";
import { harness, uuid, type Handler, type Row } from "../planning/harness";
const me = uuid(1), other = uuid(2);
const rows: Row[] = Array.from({ length: 147 }, (_, i) => ({
  id: uuid(i + 1, "60000000"), recipient_id: i < 131 ? me : other, kind: i % 2 ? "message_received" : "quote_received", title: "Titre", body: "Corps",
  intervention_id: i % 3 ? uuid(1, "70000000") : null, organization_id: null, site_id: null, payload: {}, read_at: i % 4 ? null : "2026-10-30T12:00:00Z",
  created_at: `2026-10-30T10:00:00.${String(123000 + Math.floor(i / 3)).padStart(6, "0")}+00:00`,
}));
function routes(options: Parameters<typeof harness>[0] = {}) {
  const h = harness({ role: "client", tables: { notifications: rows }, ...options });
  const list = h.load("app/api/notifications/route.ts"), summary = h.load("app/api/notifications/summary/route.ts"), preferences = h.load("app/api/notifications/preferences/route.ts");
  return {
    ...h,
    list: (params: URLSearchParams | string = "") => (list.GET as Handler)(h.request(`/api/notifications?${params}`)),
    mark: (body: unknown, origin?: string) => (list.POST as Handler)(h.request("/api/notifications", body, origin)),
    summary: (query = "") => (summary.GET as Handler)(h.request(`/api/notifications/summary${query}`)),
    preferences: () => (preferences.GET as Handler)(h.request("/api/notifications/preferences")),
    save: (body: unknown, origin?: string) => (preferences.POST as Handler)(h.request("/api/notifications/preferences", body, origin)),
  };
}
test("list pages the recipient's own notifications beyond 100 rows with exact totals and unread counts", async () => {
  const h = routes(); const seen: string[] = []; let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "17" }); if (cursor) params.set("cursor", cursor);
    const response = await h.list(params); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json(); assert.equal(body.page.total, 131); assert.equal(body.unread_count, rows.filter(r => r.recipient_id === me && !r.read_at).length); assert.equal(body.filters.unread, false);
    seen.push(...body.notifications.map((n: Row) => String(n.id))); cursor = body.page.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 131); assert.equal(new Set(seen).size, 131);
  assert.ok(seen.every(id => rows.some(r => r.id === id && r.recipient_id === me)));
  assert.ok(h.requests.filter(r => r.table === "notifications").every(r => r.url.searchParams.get("recipient_id") === `eq.${me}`));
});
test("unread filter binds the cursor; malformed parameters and missing counts fail closed", async () => {
  const h = routes(); const first = await (await h.list("unread=1&limit=5")).json();
  assert.equal(first.page.total, rows.filter(r => r.recipient_id === me && !r.read_at).length); assert.ok(first.notifications.every((n: Row) => n.read_at === null));
  assert.ok(first.page.next_cursor);
  assert.equal((await h.list(`cursor=${first.page.next_cursor}&limit=5`)).status, 422);
  assert.equal((await h.list(`unread=1&cursor=${first.page.next_cursor}&limit=5`)).status, 200);
  for (const query of ["limit=0", "limit=101", "unread=yes", "recipient_id=x", "cursor=e30", "limit=5&limit=6", "kind=quote_received"]) assert.equal((await routes().list(query)).status, 422, query);
  assert.equal((await routes({ missingCount: true }).list()).status, 503);
  assert.equal((await routes({ role: null }).list()).status, 401);
});
test("marking read/unread/all forwards exact identity-free commands and surfaces refusals", async () => {
  const ids = [uuid(1, "60000000"), uuid(2, "60000000"), uuid(1, "60000000")];
  const h = routes({ rpcData: { updated: 2, unread_count: 3 } });
  const response = await h.mark({ action: "mark_read", ids }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { updated: 2, unread_count: 3 });
  assert.deepEqual(h.requests.find(r => r.table === "mark_notifications")!.args, { p_action: "read", p_ids: [ids[0], ids[1]], p_before: null });
  const unread = routes({ rpcData: { updated: 1, unread_count: 4 } }); await unread.mark({ action: "mark_unread", ids: [ids[0]] });
  assert.deepEqual(unread.requests.find(r => r.table === "mark_notifications")!.args, { p_action: "unread", p_ids: [ids[0]], p_before: null });
  const all = routes({ rpcData: { updated: 9, unread_count: 0 } }); await all.mark({ action: "mark_all_read", before: "2026-10-30T12:00:00Z" });
  assert.deepEqual(all.requests.find(r => r.table === "mark_notifications")!.args, { p_action: "read_all", p_ids: null, p_before: "2026-10-30T12:00:00Z" });
  const bare = routes({ rpcData: { updated: 0, unread_count: 0 } }); await bare.mark({ action: "mark_all_read" });
  assert.equal(bare.requests.find(r => r.table === "mark_notifications")!.args!.p_before, null);
  for (const body of [{ action: "mark_read", ids: [] }, { action: "mark_read", ids: Array.from({ length: 101 }, (_, i) => uuid(i + 1)) }, { action: "mark_read", ids: ["x"] }, { action: "mark_read", ids, recipient_id: other }, { action: "mark_all_read", before: "2026-10-30" }, { action: "delete", ids }]) {
    const invalid = routes(); assert.equal((await invalid.mark(body)).status, 422, JSON.stringify(body)); assert.equal(invalid.requests.some(r => r.args), false);
  }
  const foreign = routes(); assert.equal((await foreign.mark({ action: "mark_read", ids }, "https://foreign.example.test")).status, 403); assert.equal(foreign.requests.length, 0);
  assert.equal((await routes({ rpcError: "53300" }).mark({ action: "mark_read", ids })).status, 429);
  assert.equal((await routes({ rpcData: null }).mark({ action: "mark_read", ids })).status, 503);
});
test("summary returns server counts only and never fabricates a number", async () => {
  const h = routes({ rpcData: { unread_count: 4, latest_created_at: "2026-10-30T12:00:00+00:00" } });
  const response = await h.summary(); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { unread_count: 4, latest_created_at: "2026-10-30T12:00:00+00:00" });
  assert.equal((await routes({ rpcData: { unread_count: 0, latest_created_at: null } }).summary()).status, 200);
  assert.equal((await routes({ rpcData: { unread_count: -1 } }).summary()).status, 503);
  assert.equal((await routes({ rpcData: null }).summary()).status, 503);
  assert.equal((await routes().summary("?x=1")).status, 422);
  assert.equal((await routes({ role: null }).summary()).status, 401);
});
test("preferences expose defaults, honest channel availability and strict saves", async () => {
  const h = routes({ tables: { notifications: rows, notification_preferences: [] } });
  const response = await h.preferences(); assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.preferences, { user_id: me, muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, version: 0 });
  assert.equal(body.channels.in_app, "available");
  for (const channel of ["email", "sms", "push"]) { assert.equal(body.channels[channel], "unavailable", channel); assert.match(body.channels.reasons[channel], /aucun fournisseur configuré/i); }
  assert.ok(body.kinds.length >= 10 && body.kinds.every((k: Row) => typeof k.label === "string" && !/_/.test(String(k.label))));
  // The list is filtered by the caller's role, server-side: a client never sees artisan / organisation events.
  const kindsOf = async (role: string) => (await (await routes({ role, tables: { notifications: rows, notification_preferences: [] } }).preferences()).json()).kinds.map((k: Row) => k.kind) as string[];
  const clientKinds = body.kinds.map((k: Row) => k.kind) as string[];
  for (const foreign of ["mission_received", "mission_reassigned", "account_approved", "account_suspended", "approval_requested", "member_joined", "credential_reminder"]) assert.equal(clientKinds.includes(foreign), false, foreign);
  for (const own of ["quote_received", "mission_assigned", "message_received", "payment_confirmed", "appointment_saved", "support_replied"]) assert.ok(clientKinds.includes(own), own);
  const artisanKinds = await kindsOf("artisan");
  assert.ok(artisanKinds.includes("mission_received") && artisanKinds.includes("account_suspended") && !artisanKinds.includes("quote_received") && !artisanKinds.includes("member_joined"));
  const managerKinds = await kindsOf("manager");
  assert.ok(managerKinds.includes("approval_requested") && managerKinds.includes("member_joined") && !managerKinds.includes("mission_received"));
  assert.equal((await kindsOf("admin")).length, 24);
  assert.match(body.channels_note, /Aucun e-mail, SMS ni notification push/);
  const saved = routes({ rpcData: { preferences: { user_id: me, muted_kinds: ["message_received"], email_enabled: true, sms_enabled: false, push_enabled: false, version: 1 } } });
  const save = await saved.save({ muted_kinds: ["message_received", "message_received"], email_enabled: true, sms_enabled: false, push_enabled: false, expected_version: 0 });
  assert.equal(save.status, 200);
  assert.deepEqual(saved.requests.find(r => r.table === "save_notification_preferences")!.args, { p_muted_kinds: ["message_received"], p_email: true, p_sms: false, p_push: false, p_expected_version: 0 });
  const saveBody = await save.json(); assert.equal(saveBody.preferences.version, 1); assert.equal(saveBody.channels.email, "unavailable");
  for (const invalid of [{ muted_kinds: ["unknown"], email_enabled: false, sms_enabled: false, push_enabled: false, expected_version: 0 }, { muted_kinds: [], email_enabled: "yes", sms_enabled: false, push_enabled: false, expected_version: 0 }, { muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false }, { muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, expected_version: 0, user_id: other }]) {
    const r = routes(); assert.equal((await r.save(invalid)).status, 422, JSON.stringify(invalid)); assert.equal(r.requests.some(x => x.args), false);
  }
  assert.equal((await routes({ rpcError: "P0001" }).save({ muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, expected_version: 0 })).status, 409);
  assert.equal((await routes({ rpcData: {} }).save({ muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, expected_version: 0 })).status, 503);
  const foreign = routes(); assert.equal((await foreign.save({ muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, expected_version: 0 }, "https://foreign.example.test")).status, 403);
});

test("native notification routes forward the request to verified Bearer authentication", async () => {
  const cases: [string, string, unknown?][] = [
    ["app/api/notifications/route.ts", "GET"],
    ["app/api/notifications/route.ts", "POST", {action:"mark_read",ids:[uuid(1,"60000000")]}],
    ["app/api/notifications/preferences/route.ts", "GET"],
    ["app/api/notifications/preferences/route.ts", "POST", {muted_kinds:[],email_enabled:false,sms_enabled:false,push_enabled:false,expected_version:0}],
    ["app/api/notifications/summary/route.ts", "GET"],
  ];
  for (const [path, method, body] of cases) {
    const h = harness({role:"client",tables:{notifications:rows},rpcData:{updated:1,unread_count:0,latest_created_at:null,preferences:{user_id:me,muted_kinds:[],email_enabled:false,sms_enabled:false,push_enabled:false,version:1}}});
    const request = h.request('/api/notifications',body);
    request.headers.set('Authorization','Bearer head.payload.signature');
    const result = await (h.load(path)[method] as Handler)(request);
    assert.equal(result.status,200,path+' '+method);
    assert.equal(h.authenticationRequests.length,1);
    assert.equal(h.authenticationRequests[0],request,path+' '+method);
    assert.ok(h.requests.filter(r=>r.table==='notifications').every(r=>r.url.searchParams.get('recipient_id')===`eq.${me}`));
  }
});
