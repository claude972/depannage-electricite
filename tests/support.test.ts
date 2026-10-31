import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";
const require = createRequire(import.meta.url);
const uuid = (n: number, prefix = "50000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = uuid(1), other = uuid(2), job = uuid(1, "70000000");
type Row = Record<string, unknown>;
const tickets: Row[] = Array.from({ length: 147 }, (_, i) => ({ id: uuid(i + 1, "60000000"), creator_id: i < 131 ? user : other, intervention_id: i % 9 ? null : job, subject: i % 3 ? "Demande planning" : "Question électrique", status: ["open", "in_progress", "awaiting_user", "resolved"][i % 4], version: i === 0 ? 131 : 1, created_at: `2026-10-30T10:00:00.${String(123000 + Math.floor(i / 3)).padStart(6, "0")}+00:00`, updated_at: "2026-10-30T11:00:00Z", last_message_at: "2026-10-30T11:00:00Z" }));
const events: Row[] = Array.from({ length: 131 }, (_, i) => ({ id: uuid(i + 1, "80000000"), ticket_id: tickets[0].id, actor_id: user, kind: i % 2 ? "status_changed" : "replied", from_status: "open", to_status: "open", version: i + 1, message_id: i % 2 ? null : uuid(i + 1, "90000000"), created_at: "2026-10-30T10:00:00Z" }));
const messages: Row[] = events.filter(e => e.message_id).map(e => ({ id: e.message_id, ticket_id: e.ticket_id, author_id: user, author_kind: "user", version: e.version, body: `Message ${e.version}`, created_at: e.created_at }));
const micros = (s: string) => BigInt(Date.parse(s)) * 1000n + BigInt((/\.(\d{1,6})/.exec(s)?.[1] ?? "").slice(3).padEnd(3, "0") || "0");
function split(value: string) { const parts: string[] = []; let depth = 0, quote = false, start = 0; for (let i = 0; i < value.length; i++) { const c = value[i]; if (c === '"') quote = !quote; if (quote) continue; if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && !depth) { parts.push(value.slice(start, i)); start = i + 1; } } parts.push(value.slice(start)); return parts; }
function atom(row: Row, expression: string): boolean {
  const parsed = /^([a-z_]+)\.(eq|lt|gt|lte|ilike)\.(.*)$/s.exec(expression); assert.ok(parsed, expression);
  const [, field, op, raw] = parsed, value = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === "ilike") return String(row[field]).toLowerCase().includes(value.slice(1, -1).toLowerCase());
  const actual = field === "created_at" ? micros(String(row[field])) : field === "version" ? Number(row[field]) : String(row[field]);
  const expected = field === "created_at" ? micros(value) : field === "version" ? Number(value) : value;
  return op === "eq" ? actual === expected : op === "lt" ? actual < expected : op === "gt" ? actual > expected : actual <= expected;
}
function logic(row: Row, expression: string): boolean { const match = /^(and|or)\((.*)\)$/s.exec(expression); if (!match) return atom(row, expression); return match[1] === "and" ? split(match[2]).every(v => logic(row, v)) : split(match[2]).some(v => logic(row, v)); }
type Options = { role?: string | null; revoked?: boolean; rpcError?: string; rpcData?: unknown; missingCount?: boolean };
function harness(options: Options = {}) {
  const role = options.role === undefined ? "client" : options.role;
  const requests: { table: string; args?: Record<string, unknown>; url: URL }[] = [];
  const visible = (ticket: Row) => role === "admin" || (ticket.creator_id === user && !(options.revoked && ticket.intervention_id));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), table = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      const args = JSON.parse(String(init?.body ?? "{}")); requests.push({ table, args, url });
      return options.rpcError ? Response.json({ code: options.rpcError, message: "Refus SQL" }, { status: 409 }) : Response.json("rpcData" in options ? options.rpcData : { ticket: tickets[0], initial_message: messages[0], replayed: false });
    }
    requests.push({ table, url });
    let rows: Row[] = table === "profiles" ? [{ id: user, role }] : table === "support_tickets" ? tickets.filter(visible) : (table === "support_events" ? events : messages).filter(r => tickets.some(t => t.id === r.ticket_id && visible(t)));
    for (const [key, value] of url.searchParams) if (key === "or") rows = rows.filter(row => logic(row, `or${value}`)); else if (!["select", "order", "limit"].includes(key)) rows = rows.filter(row => atom(row, `${key}.${value}`));
    const total = rows.length, ordering = (url.searchParams.get("order") ?? "").split(",").filter(Boolean);
    rows = [...rows].sort((a, b) => { for (const term of ordering) { const [field, direction] = term.split("."); const av = field === "created_at" ? micros(String(a[field])) : field === "version" ? Number(a[field]) : String(a[field]), bv = field === "created_at" ? micros(String(b[field])) : field === "version" ? Number(b[field]) : String(b[field]); if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1); } return 0; });
    rows = rows.slice(0, Number(url.searchParams.get("limit") ?? Infinity));
    const fields = (url.searchParams.get("select") ?? "*").split(","); rows = rows.map(row => fields[0] === "*" ? row : Object.fromEntries(fields.map(f => [f, row[f]])));
    const headers = new Headers({ "Content-Type": "application/json" }); if (!options.missingCount) headers.set("Content-Range", `0-${Math.max(rows.length - 1, 0)}/${total}`);
    const singular = new Headers(init?.headers).get("Accept") === "application/vnd.pgrst.object+json";
    return new Response(init?.method === "HEAD" ? null : JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers });
  };
  const db = createClient("https://support.example.test", "public-test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async () => { if (role === null) throw new ApiError(401, "Session requise"); return { db, user: { id: user } }; },
    assertOrigin: (request: Request) => { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine refusée"); },
    dbError: (error: { code: string } | null) => { if (error) throw new ApiError(({ P0001: 409, "42501": 403, "22023": 422, "53300": 429 } as Record<string, number>)[error.code] ?? 503, "Commande refusée"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
  function compile(path: string, imports: Record<string, unknown>) { const module: { exports: Record<string, unknown> } = { exports: {} }; const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code; vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => imports[name] ?? require(name), Buffer, URL, URLSearchParams, Request, Response, SyntaxError }, { filename: path }); return module.exports; }
  const validation = compile("../lib/supabase/validation.ts", { "./server": helpers });
  const imports = { "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation };
  const list = compile("../app/api/support/route.ts", imports), detail = compile("../app/api/support/[id]/route.ts", imports);
  const request = (path: string, body?: unknown, origin = "https://app.example.test") => new Request(`https://app.example.test${path}`, body === undefined ? undefined : { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  type ListHandler = (r: Request) => Promise<Response>; type DetailHandler = (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  return {
    requests,
    list: (params: URLSearchParams | string = "") => (list.GET as ListHandler)(request(`/api/support?${params}`)),
    create: (body: unknown, origin?: string) => (list.POST as ListHandler)(request("/api/support", body, origin)),
    detail: (id = String(tickets[0].id), params: URLSearchParams | string = "") => (detail.GET as DetailHandler)(request(`/api/support/${id}?${params}`), { params: Promise.resolve({ id }) }),
    mutate: (body: unknown, id = String(tickets[0].id), origin?: string) => (detail.POST as DetailHandler)(request(`/api/support/${id}`, body, origin), { params: Promise.resolve({ id }) }),
  };
}
test("support list preserves own scope and paginates >100 timestamps without duplicate or inferred totals", async () => {
  const h = harness(); const seen: string[] = []; let cursor: string | null = null;
  do { const params = new URLSearchParams({ limit: "13" }); if (cursor) params.set("cursor", cursor); const response = await h.list(params); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); const body = await response.json(); assert.equal(body.filters.scope, "mine"); assert.equal(body.page.total, 131); seen.push(...body.tickets.map((t: Row) => String(t.id))); cursor = body.page.next_cursor; } while (cursor);
  assert.equal(seen.length, 131); assert.equal(new Set(seen).size, 131); assert.ok(seen.every(id => tickets.some(t => t.id === id && t.creator_id === user)));
  for (const role of ["client", "artisan", "manager"]) { const h = harness({ role }); assert.equal((await h.list("scope=all")).status, 403); assert.equal(h.requests.some(r => r.table === "support_tickets"), false); }
  const admin = await (await harness({ role: "admin" }).list()).json(); assert.equal(admin.page.total, 147); assert.equal(admin.filters.scope, "all");
});
test("support filters/search apply before limit, cursors bind scope/filter and malformed parameters fail closed", async () => {
  const h = harness(); const params = new URLSearchParams({ q: "électrique", status: "open", intervention_id: job, limit: "1" }); const first = await (await h.list(params)).json(); const expected = tickets.filter(t => t.creator_id === user && t.status === "open" && t.intervention_id === job && String(t.subject).includes("électrique")); assert.equal(first.page.total, expected.length); assert.equal(first.tickets.length, 1);
  assert.ok(first.page.next_cursor); params.set("cursor", first.page.next_cursor); params.set("q", "planning"); assert.equal((await h.list(params)).status, 422);
  for (const query of ["scope=unknown", "limit=101", "status=bad", "scope=mine&scope=mine", "creator_id=other", "cursor=e30", "cursor=", "q=foo%25", "q=foo,status.eq.open", "intervention_id=bad"]) assert.equal((await h.list(query)).status, 422, query);
});
test("detail paginates 131 event versions and only corresponding messages, with server-global counts", async () => {
  const h = harness(); let after = 0; const history: number[] = [], bodies: number[] = [];
  for (;;) { const response = await h.detail(String(tickets[0].id), new URLSearchParams({ limit: "17", after_version: String(after) })); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.page.total_events, 131); assert.equal(body.page.total_messages, 66); assert.equal(body.permissions.can_set_status, false); assert.equal(body.permissions.can_reply, true); const end = body.events.at(-1)?.version ?? after; assert.ok(body.messages.every((m: Row) => Number(m.version) > after && Number(m.version) <= end)); history.push(...body.events.map((e: Row) => Number(e.version))); bodies.push(...body.messages.map((m: Row) => Number(m.version))); if (!body.page.has_more) break; assert.ok(body.page.next_after_version > after); after = body.page.next_after_version; }
  assert.deepEqual(history, Array.from({ length: 131 }, (_, i) => i + 1)); assert.equal(new Set(bodies).size, 66);
  assert.equal((await h.detail(uuid(999, "60000000"))).status, 404); assert.equal((await h.detail(String(tickets[0].id), "after_version=-1")).status, 422); assert.equal((await h.detail(String(tickets[0].id), "limit=1&limit=2")).status, 422);
});
test("revoked linked scope hides ticket details/list, while unrelated private tickets remain visible", async () => {
  const h = harness({ revoked: true }); assert.equal((await h.detail()).status, 404); const body = await (await h.list()).json(); assert.ok(body.tickets.every((t: Row) => !t.intervention_id)); assert.equal(body.page.total, tickets.filter(t => t.creator_id === user && !t.intervention_id).length);
  assert.equal((await harness({ role: null }).list()).status, 401); assert.equal((await harness({ role: null }).detail()).status, 401);
});
test("create/reply/status forward strict identity-free contracts and reject author/status spoof fields", async () => {
  const h = harness(); const payload = { request_id: uuid(9), subject: "  Question assistance  ", body: "  Message de demande suffisamment détaillé.  ", intervention_id: null }; const response = await h.create(payload); assert.equal(response.status, 200); const call = h.requests.find(r => r.table === "create_support_ticket")!; assert.deepEqual(call.args, { p_request_id: payload.request_id, p_subject: "Question assistance", p_body: "Message de demande suffisamment détaillé.", p_intervention_id: null });
  for (const extra of [{ creator_id: other }, { status: "resolved" }, { author_kind: "admin" }, { version: 999 }]) { const invalid = harness(); assert.equal((await invalid.create({ ...payload, ...extra })).status, 422); assert.equal(invalid.requests.some(r => r.args), false); }
  assert.equal((await harness().create({ ...payload, subject: "Question\u0000invalide" })).status, 422);
  assert.equal((await harness().create({ ...payload, body: "Message détaillé\u0000invalide" })).status, 422);
  assert.equal((await h.mutate({ action: "reply", expected_version: 131, body: "Réponse" })).status, 200); assert.deepEqual(h.requests.find(r => r.table === "mutate_support_ticket")!.args, { p_id: tickets[0].id, p_action: "reply", p_expected_version: 131, p_body: "Réponse" });
  for (const body of [{ action: "reply", expected_version: 1, body: "Réponse", author_id: user }, { action: "reply", expected_version: 0, body: "Texte" }, { action: "reply", expected_version: 1, body: "  " }, { action: "set_status", expected_version: 1, status: "bogus" }, { action: "set_status", expected_version: 1, status: "resolved", body: "Note interne" }]) assert.equal((await harness().mutate(body)).status, 422);
});
test("RPC version/permission/rate errors remain explicit/no-store, cross-origin denied and missing counts/success not faked", async () => {
  for (const [code, expected] of [["P0001", 409], ["42501", 403], ["53300", 429]] as const) { const response = await harness({ rpcError: code }).mutate({ action: "reply", expected_version: 1, body: "Texte" }); assert.equal(response.status, expected); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); }
  const h = harness(); assert.equal((await h.mutate({ action: "reply", expected_version: 1, body: "Texte" }, undefined, "https://foreign.example.test")).status, 403); assert.equal(h.requests.length, 0);
  assert.equal((await harness({ missingCount: true }).list()).status, 503); assert.equal((await harness({ rpcData: null }).create({ request_id: uuid(9), subject: "Question assistance", body: "Message détaillé de demande.", intervention_id: null })).status, 503);
});
