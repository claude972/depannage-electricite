import * as platformMfa from "../../shared/platform-mfa";
import { refundPolicy } from "../../lib/features/refund-execution/policy";
// HTTP-layer refusal matrix for app/api/platform-operations/** with a mocked PostgREST, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";
const require = createRequire(import.meta.url);
const uuid = (n: number, prefix = "50000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Row = Record<string, unknown>;
type Access = { super_admin: boolean; scopes: string[]; super_admin_count: number | null };
const ACCESS: Record<string, Access> = {
  none: { super_admin: false, scopes: [], super_admin_count: null },
  finRead: { super_admin: false, scopes: ["finance_read"], super_admin_count: null },
  finWrite: { super_admin: false, scopes: ["finance_read", "finance_write"], super_admin_count: null },
  moderator: { super_admin: false, scopes: ["reviews_moderate"], super_admin_count: null },
  admin: { super_admin: true, scopes: [], super_admin_count: 2 },
  supportRead: { super_admin: false, scopes: ["support_read"], super_admin_count: null },
  supportWriteOnly: { super_admin: false, scopes: ["support_reply", "support_status"], super_admin_count: null },
  supportFull: { super_admin: false, scopes: ["support_read", "support_reply", "support_status"], super_admin_count: null },
};
const audit: Row[] = Array.from({ length: 57 }, (_, i) => ({ id: 57 - i, actor_id: uuid(1), action: i % 2 ? "operator_scope_granted" : "refund_requested", target_kind: i % 2 ? "operator" : "refund_request", target_id: uuid(2), details: {}, created_at: "2026-10-30T10:00:00Z" }));
const refunds: Row[] = Array.from({ length: 31 }, (_, i) => ({ id: uuid(i + 1, "60000000"), request_id: uuid(i + 1, "61000000"), payment_id: uuid(1, "70000000"), amount_cents: 1000 + i, currency: "eur", reason: "Motif de démonstration suffisant.", status: ["requested", "approved", "settled"][i % 3], version: 1, requested_by: uuid(1), created_at: `2026-10-30T10:00:${String(59 - i).padStart(2, "0")}.000000+00:00`, updated_at: "2026-10-30T10:00:00Z", decided_by: null, decided_at: null, decision_note: "", provider_reference: null, settled_event_id: null, settled_at: null }));
const operatorGrants: Row[] = [21, 22, 23].map(n => ({ id: uuid(n + 100), user_id: uuid(n), scope: "finance_read", status: "active", note: "", granted_at: "2026-10-30T10:00:00Z" }));
const operatorProfiles: Row[] = [
  { id: uuid(21), full_name: "Artisan de test", role: "artisan" },
  { id: uuid(22), full_name: "Gestionnaire de test", role: "manager" },
];
function harness(actor: keyof typeof ACCESS | null, env: Record<string, string> = {}, rejectedRpc?: { name: string; code: string; message: string }, fixtures: Record<string, Row[]> = {}) {
  const calls: { rpc?: string; args?: Row; table?: string; url: URL; method: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); const table = url.pathname.split("/").at(-1)!; const method = init?.method ?? "GET";
    if (url.pathname.includes("/rpc/")) {
      const args = init?.body ? JSON.parse(String(init.body)) : {}; calls.push({ rpc: table, args, url, method });
      if (table === rejectedRpc?.name) return Response.json({ code: rejectedRpc.code, message: rejectedRpc.message }, { status: 403 });
      if (table === "platform_access") return Response.json(ACCESS[actor ?? "none"]);
      if (table === "platform_finance_report") return Response.json({ payments: {}, ledger: {}, refund_requests: {}, disputes: {}, invoices: {}, commission_setting: null, currency: "eur", generated_at: "2026-10-31T00:00:00Z" });
      return Response.json({ ok: true, rpc: table, args });
    }
    calls.push({ table, url, method });
    let rows: Row[] = table === "platform_audit" ? audit : table === "platform_refund_requests" ? refunds : table === "platform_settings" ? [{ key: "commission_bps", value: { bps: 1500 }, version: 2 }] : [];
    if (table === "platform_operator_grants") rows = operatorGrants;
    if (table === "profiles") rows = operatorProfiles;
    if (table in fixtures) rows = fixtures[table];
    for (const [key, value] of url.searchParams) {
      if (key === "or") { const m = /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([^)]+)\)\)$/.exec(value); assert.ok(m, value); rows = rows.filter((r) => String(r.created_at) < m[1] || (String(r.created_at) === m[2] && String(r.id) < m[3])); }
      else if (["select", "order", "limit"].includes(key)) continue;
      else { const [op, raw] = value.split(/\.(.*)/s); if (op === "eq") rows = rows.filter((r) => String(r[key]) === raw); else if (op === "lt") rows = rows.filter((r) => Number(r[key]) < Number(raw)); else if (op === "in") rows = rows.filter((r) => raw.slice(1, -1).split(",").includes(String(r[key]))); else assert.fail(`${key}=${value}`); }
    }
    const total = rows.length;
    for (const term of (url.searchParams.get("order") ?? "").split(",").filter(Boolean).reverse()) { const [field, dir] = term.split("."); rows = [...rows].sort((a, b) => { const av = a[field] as string | number, bv = b[field] as string | number; return av === bv ? 0 : (av < bv ? -1 : 1) * (dir === "desc" ? -1 : 1); }); }
    rows = rows.slice(0, Number(url.searchParams.get("limit") ?? Infinity));
    const headers = new Headers({ "Content-Type": "application/json", "Content-Range": `0-${Math.max(rows.length - 1, 0)}/${total}` });
    const singular = new Headers(init?.headers).get("Accept")?.includes("object");
    return new Response(method === "HEAD" ? null : JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers });
  };
  const db = createClient("https://platform.example.test", "public-test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async () => { if (actor === null) throw new ApiError(401, "Connectez-vous pour accéder à cet espace."); return { db, user: { id: uuid(1) } }; },
    assertOrigin: (request: Request) => { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine de la requête non autorisée."); },
    dbError: (error: { code: string } | null) => { if (error) throw new ApiError(({ P0001: 409, "42501": 403, "22023": 422, "53300": 429 } as Record<string, number>)[error.code] ?? 503, "Commande refusée"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
  function compile(path: string, imports: Record<string, unknown>) { const module: { exports: Record<string, unknown> } = { exports: {} }; const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code; vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => imports[name] ?? require(name), Buffer, URL, Response, Headers, Request, process: { env } }); return module.exports; }
  const validation = compile("../../lib/supabase/validation.ts", { "./server": helpers });
  const types = compile("../../lib/features/platform-operations/types.ts", {});
  const config = compile("../../lib/features/platform-operations/config.ts", { "./types": types });
  const mfa = compile("../../lib/features/platform-operations/mfa.ts", { "@/lib/supabase/server": helpers, "@/shared/platform-mfa": platformMfa });
  const http = compile("../../lib/features/platform-operations/http.ts", { "../refund-execution/policy": { refundPolicy }, "node:process": { env }, "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation, "./types": types, "./config": config, "./mfa": mfa });
  const document = compile("../../lib/features/platform-operations/invoice-document.ts", { "./types": types });
  const imports = { "@/lib/features/platform-operations/mfa": mfa, "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation, "@/lib/features/platform-operations/http": http, "@/lib/features/platform-operations/types": types, "@/lib/features/platform-operations/invoice-document": document, "@/lib/features/platform-operations/config": config };
  const route = (path: string) => compile(`../../app/api/platform-operations/${path}/route.ts`, imports) as Record<string, (r: Request, c?: { params: Promise<{ id: string }> }) => Promise<Response>>;
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST", origin: string | null = "https://app.example.test") => new Request(`https://app.example.test/api/platform-operations${path}`, body === undefined ? { method } : { method, headers: { ...(origin ? { origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { calls, route, request, ctx: (id: string) => ({ params: Promise.resolve({ id }) }) };
}
test("every route requires a session and the matching server-side scope; menus grant nothing", async () => {
  const anonymous = harness(null);
  assert.equal((await anonymous.route("me").GET(anonymous.request("/me"))).status, 401);
  assert.equal((await anonymous.route("finance").GET(anonymous.request("/finance"))).status, 401);
  const matrix: [string, string, string, unknown, (keyof typeof ACCESS)[], (keyof typeof ACCESS)[]][] = [
    ["operators", "GET", "/operators", undefined, ["admin"], ["none", "finWrite", "moderator"]],
    ["operators", "POST", "/operators", { action: "grant", user_id: uuid(9), scope: "finance_read", note: "" }, ["admin"], ["finWrite"]],
    ["super-admins", "POST", "/super-admins", { user_id: uuid(9), enabled: true, note: "" }, ["admin"], ["finWrite", "moderator"]],
    ["audit", "GET", "/audit", undefined, ["admin"], ["none", "finWrite", "moderator"]],
    ["settings", "PUT", "/settings", { key: "commission_bps", value: { bps: 100 }, expected_version: null }, ["admin"], ["finWrite"]],
    ["finance", "GET", "/finance", undefined, ["finRead", "finWrite", "admin"], ["none", "moderator"]],
    ["finance", "POST", "/finance", { action: "reconcile" }, ["finWrite", "admin"], ["finRead", "moderator"]],
    ["finance/ledger", "GET", "/finance/ledger", undefined, ["finRead"], ["none", "moderator"]],
    ["finance/invoices", "POST", "/finance/invoices", { action: "issue", request_id: uuid(3), basis: "service", payment_id: uuid(4) }, ["finWrite"], ["finRead", "moderator"]],
    ["finance/invoices", "POST", "/finance/invoices", { action: "readiness", basis: "service", payment_id: uuid(4) }, ["finRead", "finWrite"], ["none", "moderator"]],
    ["finance/refund-requests", "POST", "/finance/refund-requests", { request_id: uuid(3), payment_id: uuid(4), amount_cents: 500, reason: "Motif suffisamment long." }, ["finWrite"], ["finRead", "none"]],
    ["finance/disputes", "POST", "/finance/disputes", { request_id: uuid(3), payment_id: uuid(4), origin: "client", subject: "Objet", description: "Description suffisante." }, ["finWrite"], ["finRead"]],
    ["billing-contacts", "PUT", "/billing-contacts", { subject_kind: "profile", subject_id: uuid(4), legal_name: "Client", address: "4 rue des Tests", siret: null, vat_number: null, expected_version: null }, ["finWrite"], ["finRead"]],
    ["reviews", "GET", "/reviews", undefined, ["moderator", "admin"], ["none", "finWrite"]],
  ];
  for (const [file, method, path, body, allowed, denied] of matrix) {
    for (const actor of [...allowed, ...denied]) {
      const h = harness(actor); const response = await h.route(file)[method](h.request(path, body, method));
      assert.equal(response.status, allowed.includes(actor) ? (method === "POST" && (path.endsWith("refund-requests") || path.endsWith("disputes")) ? 201 : 200) : 403, `${method} ${path} as ${actor}`);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      if (!allowed.includes(actor)) assert.ok(!h.calls.some((c) => c.rpc && c.rpc !== "platform_access" || c.table), `${path} as ${actor} must not touch data`);
    }
  }
});
test("operator list returns the profile role and leaves absent profiles without a destination", async () => {
  const h = harness("admin");
  const response = await h.route("operators").GET(h.request("/operators"));
  assert.equal(response.status, 200);
  const result = await response.json() as { grants: { user_id: string; account_role: string | null }[] };
  assert.deepEqual(Object.fromEntries(result.grants.map(g => [g.user_id, g.account_role])), {
    [uuid(21)]: "artisan", [uuid(22)]: "manager", [uuid(23)]: null,
  });
  assert.equal(h.calls.find(c => c.table === "profiles")?.url.searchParams.get("select"), "id,full_name,role");
});
test("mutations enforce origin, strict bodies and never accept a commission rate or a refund execution", async () => {
  const h = harness("finWrite");
  assert.equal((await h.route("finance").POST(h.request("/finance", { action: "reconcile", commission_bps: 500 }))).status, 422);
  assert.equal((await h.route("finance").POST(h.request("/finance", { action: "reconcile", limit: 50 }, "POST", "https://evil.example"))).status, 403);
  assert.equal((await h.route("finance").POST(h.request("/finance", { action: "reconcile", limit: 50 }))).status, 200);
  assert.deepEqual(h.calls.filter((c) => c.rpc === "platform_reconcile").map((c) => c.args), [{ p_limit: 50 }]);
  const refund = h.route("finance/refund-requests/[id]");
  for (const action of ["execute", "settle", "pay"]) assert.equal((await refund.POST(h.request(`/finance/refund-requests/${uuid(1)}`, { action, expected_version: 1, note: "" }), h.ctx(uuid(1)))).status, 422);
  assert.equal((await refund.POST(h.request(`/finance/refund-requests/${uuid(1)}`, { action: "approve", expected_version: 1, note: "" }), h.ctx(uuid(1)))).status, 200);
  assert.equal((await refund.POST(h.request("/finance/refund-requests/not-a-uuid", { action: "approve", expected_version: 1, note: "" }), h.ctx("not-a-uuid"))).status, 404);
  assert.equal((await refund.POST(h.request(`/finance/refund-requests/${uuid(1)}`, { action: "approve", expected_version: 0, note: "" }), h.ctx(uuid(1)))).status, 422);
  assert.ok(!h.calls.some((c) => c.rpc === "platform_settle_refund" || c.rpc === "platform_record_commission_withheld"));
  const invoices = h.route("finance/invoices");
  assert.equal((await invoices.POST(h.request("/finance/invoices", { action: "credit_note", request_id: uuid(3), invoice_id: uuid(4), amount_cents: 0, reason: "Motif suffisamment long." }))).status, 422);
  assert.equal((await invoices.POST(h.request("/finance/invoices", { action: "issue", request_id: uuid(3), basis: "service", payment_id: uuid(4), total_cents: 1 }))).status, 422);
  const admin = harness("admin");
  assert.equal((await admin.route("settings").PUT(admin.request("/settings", { key: "commission_bps", value: { bps: 10001 }, expected_version: null }, "PUT"))).status, 422);
  assert.equal((await admin.route("settings").PUT(admin.request("/settings", { key: "invoice_issuer", value: { legal_name: "X", siret: "123", address: "1 rue", vat_number: null, commission_vat_rate: null }, expected_version: null }, "PUT"))).status, 422);
  assert.equal((await admin.route("operators").POST(admin.request("/operators", { action: "grant", user_id: uuid(9), scope: "support", note: "" }))).status, 422);
  assert.equal((await admin.route("super-admins").POST(admin.request("/super-admins", { user_id: uuid(9), enabled: false, restore_role: "artisan", note: "" }))).status, 422);
});
test("lists paginate with exact totals and filter-bound cursors; malformed parameters fail closed", async () => {
  const h = harness("admin"); const seen: number[] = []; let cursor: string | null = null;
  do { const params = new URLSearchParams({ limit: "10" }); if (cursor) params.set("cursor", cursor); const body = await (await h.route("audit").GET(h.request(`/audit?${params}`))).json(); assert.equal(body.page.total, 57); seen.push(...body.entries.map((e: Row) => e.id as number)); cursor = body.page.next_cursor; } while (cursor);
  assert.equal(seen.length, 57); assert.deepEqual(seen, [...seen].sort((a, b) => b - a));
  const filtered = await (await h.route("audit").GET(h.request("/audit?target_kind=operator&limit=10"))).json(); assert.equal(filtered.page.total, 28);
  assert.equal((await h.route("audit").GET(h.request(`/audit?target_kind=refund_request&cursor=${filtered.page.next_cursor}`))).status, 422);
  for (const bad of ["limit=0", "limit=101", "target_kind=unknown", "foo=1", "cursor=***", "actor_id=1"]) assert.equal((await h.route("audit").GET(h.request(`/audit?${bad}`))).status, 422, bad);
  const f = harness("finRead"); const ids = new Set<string>(); cursor = null;
  do { const params = new URLSearchParams({ limit: "7" }); if (cursor) params.set("cursor", cursor); const body = await (await f.route("finance/refund-requests").GET(f.request(`/finance/refund-requests?${params}`))).json(); assert.equal(body.page.total, 31); for (const r of body.requests) ids.add(r.id as string); cursor = body.page.next_cursor; } while (cursor);
  assert.equal(ids.size, 31);
  const approved = await (await f.route("finance/refund-requests").GET(f.request("/finance/refund-requests?status=approved"))).json(); assert.equal(approved.page.total, 10);
  assert.equal((await f.route("finance/refund-requests").GET(f.request("/finance/refund-requests?status=executed"))).status, 422);
});
test("/me reflects server scopes and configuration states without exposing secrets", async () => {
  const h = harness("finRead", { STRIPE_SECRET_KEY: "sk_test_secretvalue", PLATFORM_FEE_BPS: "1000" });
  const body = await (await h.route("me").GET(h.request("/me"))).json();
  assert.deepEqual(body.scopes, ["finance_read"]); assert.equal(body.capabilities.finance, true); assert.equal(body.capabilities.operators, false); assert.equal(body.capabilities.refund_execution, false); assert.equal(body.capabilities.invoice_rendering, true);
  assert.deepEqual(body.config.commission, { setting_bps: 1500, setting_version: 2, checkout_bps: 1000, aligned: false });
  assert.deepEqual(body.config.payment_provider, { configured: true, mode: "test", live_enabled: false });
  assert.ok(!JSON.stringify(body).includes("secretvalue"));
  const none = await (await harness("none").route("me").GET(h.request("/me"))).json();
  assert.equal(none.capabilities.finance, false); assert.equal(none.config.commission.setting_bps, null);
  assert.deepEqual([none.capabilities.support, none.capabilities.support_reply, none.capabilities.support_status], [false, false, false]);
  // Support scopes (A5): a write scope without support_read grants nothing; read alone never replies or changes status.
  const support = async (actor: keyof typeof ACCESS) => { const b = await (await harness(actor).route("me").GET(h.request("/me"))).json(); return [b.capabilities.support, b.capabilities.support_reply, b.capabilities.support_status]; };
  assert.deepEqual(await support("supportRead"), [true, false, false]);
  assert.deepEqual(await support("supportWriteOnly"), [false, false, false]);
  assert.deepEqual(await support("supportFull"), [true, true, true]);
  assert.deepEqual(await support("admin"), [true, true, true]);
  assert.deepEqual(await support("finWrite"), [false, false, false]);
});

test("protected operator and refund writes translate only the dedicated SQL MFA refusal", async () => {
  const cases = [
    { actor: "admin", path: "operators", rpc: "platform_grant_scope", body: { action: "grant", user_id: uuid(9), scope: "finance_read", note: "" } },
    { actor: "admin", path: "operators", rpc: "platform_revoke_scope", body: { action: "revoke", grant_id: uuid(9), note: "" } },
    { actor: "admin", path: "super-admins", rpc: "platform_set_super_admin", body: { user_id: uuid(9), enabled: true, note: "" } },
    { actor: "finWrite", path: "finance/refund-requests", rpc: "platform_request_refund", body: { request_id: uuid(3), payment_id: uuid(4), amount_cents: 500, reason: "Motif suffisamment long." } },
    { actor: "finWrite", path: "finance/refund-requests/[id]", rpc: "platform_decide_refund", body: { action: "approve", expected_version: 1, note: "" } },
  ];
  for (const row of cases) {
    const h = harness(row.actor, {}, { name: row.rpc, code: "PT403", message: platformMfa.PLATFORM_MFA_REQUIRED });
    const response = await h.route(row.path).POST(h.request("/" + row.path.replace("[id]", uuid(5)), row.body), h.ctx(uuid(5)));
    assert.equal(response.status, 403, row.rpc);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: platformMfa.PLATFORM_MFA_MESSAGE, code: platformMfa.PLATFORM_MFA_REQUIRED });
  }
  const h = harness("finWrite", {}, { name: "platform_request_refund", code: "42501", message: "Insufficient scope" });
  const response = await h.route("finance/refund-requests").POST(h.request("/finance/refund-requests", cases[3].body));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, undefined);
});


test("review contestation history is bounded and restricted to the assigned artisan, never a moderator shortcut", async () => {
  const reviewId = uuid(90), intervention = uuid(91);
  const fixtures = {
    reviews: [{ id: reviewId, intervention_id: intervention, rating: 2, body: "Avis synthétique." }],
    interventions: [{ id: intervention, artisan_id: uuid(1) }],
    platform_review_contestations: Array.from({ length: 53 }, (_, n) => ({ id: uuid(200+n), review_id: n === 52 ? uuid(99) : reviewId, contested_by: n === 51 ? uuid(2) : uuid(1), request_id: uuid(400+n), reason: "Motif synthétique de contestation.", status: "dismissed", created_at: new Date(Date.UTC(2026,10,1,0,n)).toISOString(), decided_at: null, decision_note: "" })),
  };
  const h = harness("none", {}, undefined, fixtures);
  const response = await h.route("reviews/[id]").GET(h.request("/reviews/"+reviewId), h.ctx(reviewId));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json(); assert.equal(body.contestations.length, 50); assert.equal(body.limited, true);
  assert.ok(body.contestations.every((row: Row) => row.review_id === reviewId && row.contested_by === uuid(1)));
  const request = h.calls.find(call => call.table === "platform_review_contestations")!;
  assert.equal(request.url.searchParams.get("limit"), "50");
  assert.equal(request.url.searchParams.get("order"), "created_at.desc,id.desc");
  assert.equal(request.url.searchParams.get("contested_by"), "eq."+uuid(1));
  assert.ok(!h.calls.some(call=>call.rpc === "platform_access"));
  for (const actor of ["none", "moderator", "admin", null]) {
    const denied = harness(actor, {}, undefined, { ...fixtures, interventions: [{ id: intervention, artisan_id: uuid(2) }] });
    const result = await denied.route("reviews/[id]").GET(denied.request("/reviews/"+reviewId), denied.ctx(reviewId));
    assert.equal(result.status, actor === null ? 401 : 404);
    assert.ok(!denied.calls.some(call=>call.table === "platform_review_contestations"));
  }
});


test("review contestation explains invalid reason lengths in French before any write", async () => {
  for (const [reason,expected] of [["123456789","Décrivez le motif de contestation en au moins 10 caractères."],["a".repeat(2001),"Le motif de contestation ne doit pas dépasser 2 000 caractères."]]) {
    const h=harness("none"),id=uuid(90);
    const response=await h.route("reviews/[id]").POST(h.request("/reviews/"+id,{action:"contest",request_id:uuid(91),reason}),h.ctx(id));
    assert.equal(response.status,422);
    assert.equal((await response.json()).error,expected);
    assert.equal(h.calls.length,0,"invalid input never reaches a database operation");
  }
});
test("FIN-06: the finance report totals the estimates already superseded by a confirmed withheld commission", async () => {
  const entry = (n: number, payment: number, entry_kind: string, amount_cents: number): Row => ({ id: uuid(n, "80000000"), payment_id: uuid(payment, "70000000"), entry_kind, amount_cents });
  const ledger = [entry(1, 1, "commission_withheld", 1845), entry(2, 1, "commission_estimated", 1085), entry(3, 2, "commission_withheld", 2213), entry(4, 2, "commission_estimated", 1302), entry(5, 3, "commission_estimated", 1085), entry(6, 3, "payment_settled", 10850)];
  const h = harness("finRead", {}, undefined, { platform_ledger_entries: ledger });
  const response = await h.route("finance").GET(h.request("/finance"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).report.commission_estimated_superseded, { count: 2, cents: 2387 });
  const none = harness("finRead");
  assert.deepEqual((await (await none.route("finance").GET(none.request("/finance"))).json()).report.commission_estimated_superseded, { count: 0, cents: 0 });
  // An unusable amount never yields a partial correction.
  const broken = harness("finRead", {}, undefined, { platform_ledger_entries: [entry(1, 1, "commission_withheld", 1845), entry(2, 1, "commission_estimated", -1)] });
  assert.equal((await (await broken.route("finance").GET(broken.request("/finance"))).json()).report.commission_estimated_superseded, null);
  assert.equal((await harness("moderator").route("finance").GET(harness("moderator").request("/finance"))).status, 403);
});
