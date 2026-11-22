import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Execute the actual route compiled in memory, with only the session/error helpers stubbed.
// The real installed Supabase/PostgREST SDK builds each request against a deterministic fake
// HTTP provider below. This verifies route authorization/query/cursor behavior, not cloud RLS.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/admin/interventions/route.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
const identifier = (n: number, prefix = "10000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const micros = (value: string) => BigInt(Date.parse(value)) * 1000n + BigInt((/\.(\d{1,6})/.exec(value)?.[1] ?? "").slice(3).padEnd(3, "0") || "0");
type Row = Record<string, unknown>;
const fixtures: Row[] = Array.from({ length: 237 }, (_, i) => ({
  id: identifier(i + 1), client_id: identifier(1, "20000000"), artisan_id: i % 2 ? identifier(2, "20000000") : null,
  site_id: i % 3 ? identifier(1, "30000000") : identifier(2, "30000000"),
  category: i % 2 ? "panel" : "lighting", urgency: i % 4 ? "urgent" : "scheduled",
  status: ["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"][i % 8],
  city: i % 3 ? "Fort-de-France" : "Paris", postal_code: i % 3 ? "97200" : "75001",
  description: i % 5 ? "Panne tableau électrique" : "L’éclairage de l'entrée est défectueux",
  address: `Adresse privée ${i}`, created_at: `2026-10-01T12:00:00.${String(123450 + Math.floor(i / 9)).padStart(6, "0")}+00:00`,
  updated_at: "2026-10-02T10:00:00Z", estimate_min_cents: 10000, estimate_max_cents: 20000,
  travel_stage: "planned", completed_at: null, paid_at: null,
}));
const quoteFixtures: Row[] = Array.from({ length: 53 }, (_, i) => ({ id: identifier(i + 1, "40000000"), intervention_id: fixtures[0].id, artisan_id: identifier(2, "20000000"), lines: [{ label: "Test", quantity: 1, unit_price_cents: 10000 }], subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, status: "rejected", created_at: `2026-10-01T12:00:00.${String(i).padStart(6, "0")}Z`, accepted_at: null }));
const auditFixtures: Row[] = Array.from({ length: 54 }, (_, i) => ({
  id: 1000 + i, intervention_id: i === 53 ? fixtures[1].id : fixtures[0].id,
  actor_id: identifier(1, "20000000"), action: i === 52 ? "admin_reassigned" : "accept_mission",
  created_at: `2026-10-01T12:00:00.${String(i).padStart(6, "0")}Z`,
}));
function splitTopLevel(value: string): string[] {
  const out: string[] = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]; if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
  }
  assert.equal(depth, 0); assert.equal(quoted, false); out.push(value.slice(start)); return out;
}
function matchAtom(row: Row, expression: string): boolean {
  const parsed = /^([a-z_]+)\.(eq|lt|gte|lte|ilike)\.(.*)$/s.exec(expression);
  assert.ok(parsed, `Unexpected provider expression: ${expression}`);
  const [, field, op, raw] = parsed, value = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === "ilike") return String(row[field]).toLocaleLowerCase().includes(value.slice(1, -1).toLocaleLowerCase());
  const actual = field === "created_at" ? micros(String(row[field])) : String(row[field]);
  const expected = field === "created_at" ? micros(value) : value;
  if (op === "eq") return actual === expected;
  if (op === "lt") return actual < expected;
  if (op === "gte") return actual >= expected;
  return actual <= expected;
}
function matchLogic(row: Row, expression: string): boolean {
  const group = /^(and|or)\((.*)\)$/s.exec(expression);
  if (!group) return matchAtom(row, expression);
  const values = splitTopLevel(group[2]);
  return group[1] === "and" ? values.every(v => matchLogic(row, v)) : values.some(v => matchLogic(row, v));
}
function harness(role: string | null = "admin", options: { providerCap?: number; missingCount?: boolean; auditFailure?: boolean } = {}) {
  const requests: { table: string; url: URL; method: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.split("/").at(-1)!; const method = init?.method ?? "GET";
    requests.push({ table, url, method });
    if (table === "audit_log" && options.auditFailure) return Response.json({ message: "unavailable", code: "XX000" }, { status: 503 });
    let rows = table === "profiles" ? [{ role, id: identifier(1, "20000000") }] : table === "quotes" ? [...quoteFixtures] : table === "audit_log" ? [...auditFixtures] : [...fixtures];
    for (const [key, value] of url.searchParams) {
      if (key === "or") rows = rows.filter(row => matchLogic(row, `or${value}`));
      else if (!["select", "order", "limit"].includes(key)) rows = rows.filter(row => matchAtom(row, `${key}.${value}`));
    }
    const total = rows.length;
    const ordering = (url.searchParams.get("order") ?? "").split(",").filter(Boolean);
    rows.sort((a, b) => {
      for (const term of ordering) {
        const [field, direction] = term.split(".");
        const av = field === "created_at" ? micros(String(a[field])) : String(a[field]);
        const bv = field === "created_at" ? micros(String(b[field])) : String(b[field]);
        if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    rows = rows.slice(0, Math.min(Number(url.searchParams.get("limit") ?? Infinity), options.providerCap ?? Infinity));
    const fields = (url.searchParams.get("select") ?? "*").split(",");
    rows = rows.map(row => fields[0] === "*" ? row : Object.fromEntries(fields.map(field => [field, row[field]])));
    const headers = new Headers({ "Content-Type": "application/json" });
    if (!options.missingCount) headers.set("Content-Range", `0-${Math.max(rows.length - 1, 0)}/${total}`);
    const singular = new Headers(init?.headers).get("Accept") === "application/vnd.pgrst.object+json";
    return new Response(method === "HEAD" ? null : JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers });
  };
  const db = createClient("https://provider.example.test", "public-test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async () => { if (role === null) throw new ApiError(401, "Session requise"); return { db, user: { id: identifier(1, "20000000") } }; },
    dbError: (error: unknown) => { if (error) throw new ApiError(503, "Fournisseur indisponible"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : 500 }),
  };
  const module: { exports: { GET?: (request: Request) => Promise<Response> } } = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => name === "@/lib/supabase/server" ? helpers : name === "@/lib/supabase/validation" ? { uuid: z.string().uuid() } : require(name), Buffer, URL, URLSearchParams, Response, Request }, { filename: "admin-interventions-route.js" });
  return { requests, get: (params: URLSearchParams | string = "") => module.exports.GET!(new Request(`https://app.example.test/api/admin/interventions?${params}`)) };
}

test("admin route gates every list/detail read before querying dossiers and marks failures private", async () => {
  for (const role of [null, "client", "artisan", "manager", "owner", "viewer"]) {
    const h = harness(role); const response = await h.get(`id=${fixtures[0].id}`);
    assert.equal(response.status, role === null ? 401 : 403);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(h.requests.some(r => r.table === "interventions" || r.table === "quotes" || r.table === "audit_log"), false);
  }
});
test("237 dossiers paginate exactly once through tied and microsecond-distinct timestamps with stable filtered total", async () => {
  const h = harness(); const ids: string[] = []; let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "17" }); if (cursor) params.set("cursor", cursor);
    const response = await h.get(params); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json(); assert.equal(body.page.total, fixtures.length); assert.ok(body.interventions.length <= 17);
    ids.push(...body.interventions.map((row: Row) => String(row.id)));
    cursor = body.page.next_cursor; assert.equal(body.page.has_more, cursor !== null);
    if (cursor) { const value = JSON.parse(Buffer.from(cursor, "base64url").toString()); assert.match(value.created_at, /\.\d{6}\+00:00$/); }
  } while (cursor);
  const expected = [...fixtures].sort((a, b) => micros(String(a.created_at)) === micros(String(b.created_at)) ? String(b.id).localeCompare(String(a.id)) : micros(String(a.created_at)) > micros(String(b.created_at)) ? -1 : 1).map(r => r.id);
  assert.deepEqual(ids, expected); assert.equal(new Set(ids).size, fixtures.length);
});
test("search and status/site/artisan/date filters apply before limit and persist across cursors", async () => {
  const h = harness(); const params = new URLSearchParams({ q: "panne", status: "assigned", category: "panel", urgency: "urgent", site_id: String(fixtures[1].site_id), artisan_id: String(fixtures[1].artisan_id), created_from: "2026-10-01T12:00:00.123450+00:00", created_to: "2026-10-01T12:00:00.123476+00:00", limit: "2" });
  const expected = fixtures.filter(row => String(row.description).toLowerCase().includes("panne") && row.status === "assigned" && row.site_id === fixtures[1].site_id);
  const found: string[] = []; let cursor: string | null = null;
  do { if (cursor) params.set("cursor", cursor); const response = await h.get(params); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.page.total, expected.length); found.push(...body.interventions.map((r: Row) => String(r.id))); cursor = body.page.next_cursor; } while (cursor);
  assert.equal(new Set(found).size, expected.length); assert.deepEqual(new Set(found), new Set(expected.map(r => String(r.id))));
});
test("literal unicode and apostrophe search and exact UUID reference work without exposing private list fields", async () => {
  for (const q of ["éclairage", "L’éclairage", "L’éclairage de l'entrée", String(fixtures[0].id)]) {
    const response = await harness().get(new URLSearchParams({ q })); assert.equal(response.status, 200);
    const body = await response.json(); assert.ok(body.page.total > 0);
    assert.ok(body.interventions.every((r: Row) => !("address" in r) && !("description" in r) && !("phone" in r)));
  }
});
test("the INT-XXXXXX reference shown to clients finds its dossier (any case), and nothing else", async () => {
  // Recette admin réelle du 16/11 : « INT-5B12D9 » (placeholder « INT-… ou ville ») renvoyait 0 dossier.
  const target = String(fixtures[41].id); // 10000000-0000-4000-8000-000000000042
  const reference = `INT-${target.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  for (const q of [reference, reference.toLowerCase()]) {
    const h = harness(); const response = await h.get(new URLSearchParams({ q }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.page.total, fixtures.length, q); // every fixture id starts with « 100000 »
    assert.ok(body.interventions.every((r: Row) => String(r.id).replaceAll("-", "").startsWith(target.replaceAll("-", "").slice(0, 6))));
    const url = h.requests.find(r => r.table === "interventions")!.url;
    assert.equal(url.searchParams.getAll("id").sort().join(" "), "gte.10000000-0000-0000-0000-000000000000 lte.100000ff-ffff-ffff-ffff-ffffffffffff");
  }
  const none = await (await harness().get(new URLSearchParams({ q: "INT-ABCDEF" }))).json();
  assert.equal(none.page.total, 0);
  // Without « INT- », six letters stay a literal city/description search.
  const literal = harness(); await literal.get(new URLSearchParams({ q: "facade" }));
  assert.ok(literal.requests.find(r => r.table === "interventions")!.url.searchParams.get("or")?.includes("ilike"));
});

test("malformed cursor, duplicate/unknown parameters, wildcards and filter injection are rejected before dossier queries", async () => {
  for (const params of ["limit=0", "limit=101", "limit=01", "limit=1.5", "status=unknown", "site_id=bad", "limit=2&limit=3", "unknown=x", "cursor=", "cursor=a===", "cursor=e30", "created_from=2026-02-30T00%3A00%3A00Z", "created_from=2026-10-01T12%3A00%3A00.123456Z&created_to=2026-10-01T12%3A00%3A00.123455Z"]) {
    const h = harness(); assert.equal((await h.get(params)).status, 422, params); assert.equal(h.requests.some(r => r.table === "interventions"), false);
  }
  for (const q of ["a", "a".repeat(81), "foo,status.eq.paid", "foo%", "foo_", 'foo"', "foo(bar)", "foo:bar", "foo.bar", "ＦＯＯ，status"]) assert.equal((await harness().get(new URLSearchParams({ q }))).status, 422, q);
});
test("cursor is bound to normalized filters but not the chosen page size", async () => {
  const h = harness(); const first = await (await h.get("limit=3&q=panne")).json();
  assert.ok(first.page.next_cursor);
  assert.equal((await h.get(new URLSearchParams({ limit: "4", q: "éclairage", cursor: first.page.next_cursor }))).status, 422);
  const next = await h.get(new URLSearchParams({ limit: "4", q: "panne", cursor: first.page.next_cursor })); assert.equal(next.status, 200);
  const nextBody = await next.json(); assert.equal(nextBody.interventions.length, 4); assert.ok(!nextBody.interventions.some((r: Row) => first.interventions.some((p: Row) => p.id === r.id)));
  const altered = JSON.parse(Buffer.from(first.page.next_cursor, "base64url").toString()); altered.created_at = '2026-10-01T12:00:00Z",status.eq.paid';
  assert.equal((await h.get(new URLSearchParams({ q: "panne", cursor: Buffer.from(JSON.stringify(altered)).toString("base64url") }))).status, 422);
});
test("provider row cap does not create a false end of history and missing exact count fails closed", async () => {
  const body = await (await harness("admin", { providerCap: 10 }).get("limit=100")).json();
  assert.equal(body.interventions.length, 10); assert.equal(body.page.has_more, true); assert.equal(body.page.total, fixtures.length); assert.ok(body.page.next_cursor);
  assert.equal((await harness("admin", { missingCount: true }).get()).status, 503);
});
test("admin detail finds a dossier beyond workspace and returns bounded exact quote versions only", async () => {
  const h = harness(); const response = await h.get(`id=${fixtures[0].id}`); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.intervention.id, fixtures[0].id); assert.ok(body.intervention.address); assert.equal(body.quotes.length, 50); assert.equal(body.quotes_limited, true);
  assert.equal(body.quotes[0].id, quoteFixtures.at(-1)!.id);
  assert.equal((await h.get(`id=${identifier(99999)}`)).status, 404);
  assert.equal((await h.get(`id=${fixtures[0].id}&limit=2`)).status, 422);
});


test("client dossier filtering is server-side, rejects malformed UUID and binds its cursor", async () => {
 const h=harness();
 const client=identifier(1,"20000000");
 const response=await h.get(`client_id=${client}&limit=2`);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.ok(body.interventions.every((r:Row)=>r.client_id===client));
 assert.ok(h.requests.filter(r=>r.table==='interventions').every(r=>r.url.searchParams.get('client_id')===`eq.${client}`));
 const foreign=await h.get(`client_id=${identifier(9,"20000000")}&cursor=${body.page.next_cursor}&limit=2`);
 assert.equal(foreign.status,422);
 const invalid=await h.get('client_id=not-a-uuid');assert.equal(invalid.status,422);
 const absent=await h.get(`client_id=${identifier(9,"20000000")}`);assert.equal(absent.status,200);assert.equal((await absent.json()).interventions.length,0);
});


test("admin dossier audit is scoped, bounded, ordered and includes reassignment without private extra fields", async () => {
  const h = harness(); const response = await h.get(`id=${fixtures[0].id}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const { audit } = await response.json();
  assert.equal(audit.status, "ok"); assert.equal(audit.items.length, 50); assert.equal(audit.limit, 50); assert.equal(audit.limited, true);
  assert.equal(audit.items[0].action, "admin_reassigned"); assert.equal(audit.items[0].id, "1052");
  assert.equal(audit.items.some((row: any) => row.id === "1053"), false);
  assert.deepEqual(Object.keys(audit.items[0]).sort(), ["action", "actor_id", "created_at", "id"]);
  const request = h.requests.find(r => r.table === "audit_log")!;
  assert.equal(request.url.searchParams.get("intervention_id"), `eq.${fixtures[0].id}`);
  assert.equal(request.url.searchParams.get("order"), "created_at.desc,id.desc");
});

test("audit read failure is explicit while the admin dossier remains readable; retry can recover", async () => {
  const failed = await harness("admin", { auditFailure: true }).get(`id=${fixtures[0].id}`);
  assert.equal(failed.status, 200); const body = await failed.json();
  assert.equal(body.intervention.id, fixtures[0].id); assert.deepEqual(body.audit, { status: "error" });
  assert.equal((await (await harness().get(`id=${fixtures[0].id}`)).json()).audit.status, "ok");
});

test("an empty dossier audit is distinguishable from a provider failure", async () => {
  const response = await harness().get(`id=${fixtures[2].id}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).audit, { status: "ok", items: [], limit: 50, limited: false });
});
