import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Actual route + installed SDK against an isolated HTTP provider, not live RLS/cloud.
const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("../app/api/admin/directory/route.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
type Row = Record<string, unknown>;
type Kind = "artisans" | "clients" | "organizations";
const id = (n: number, prefix = "10000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actorId = id(1, "90000000");
const micros = (v: string) => BigInt(Date.parse(v)) * 1000n + BigInt((/\.(\d{1,6})/.exec(v)?.[1] ?? "").slice(3).padEnd(3, "0") || "0");
const created = (i: number) => `2026-10-01T12:00:00.${String(123450 + Math.floor(i / 9)).padStart(6, "0")}+00:00`;
const artisans: Row[] = Array.from({ length: 237 }, (_, i) => ({ id: id(i + 1, "a0000000"), full_name: `${i % 2 ? "Équipe Électricité" : "L’équipe d'Alice"} ${i}`, phone: "QA", role: "artisan", artisan_approved: i % 3 === 0, created_at: created(i), stripe_account_id: "private", email: "private" }));
const clients: Row[] = Array.from({ length: 237 }, (_, i) => ({ id: id(i + 1, "b0000000"), full_name: `${i % 2 ? "Équipe Clients" : "L’équipe d'Alice"} ${i}`, phone: "QA", role: i % 2 ? "manager" : "client", created_at: created(i), stripe_account_id: "private", email: "private" }));
const organizations: Row[] = Array.from({ length: 237 }, (_, i) => ({ id: id(i + 1, "c0000000"), name: `${i % 2 ? "Équipe Bureaux" : "L’équipe d'Alice"} ${i}`, owner_id: id(i % 2 + 1, "b0000000"), created_at: created(i), secret: "private" }));
const dossiers = artisans.filter((_, i) => i % 4 !== 0).map(row => ({ user_id: row.id, company_name: `Société ${row.id}`, application_status: row.artisan_approved ? "approved" : "draft", siret: "private", address: "private" }));
const byKind: Record<Kind, Row[]> = { artisans, clients, organizations };
function split(value: string) {
  const out: string[] = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') quoted = !quoted;
    if (quoted) continue;
    if (value[i] === "(") depth++; else if (value[i] === ")") depth--; else if (value[i] === "," && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
  }
  assert.equal(depth, 0); assert.equal(quoted, false); out.push(value.slice(start)); return out;
}
function atom(row: Row, expression: string): boolean {
  const parsed = /^([a-z_]+)\.(eq|lt|ilike|in)\.(.*)$/s.exec(expression); assert.ok(parsed, expression);
  const [, field, op, raw] = parsed, value = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === "in") return raw.slice(1, -1).split(",").includes(String(row[field]));
  if (op === "ilike") {
    const text = field === "directory_profile_name" ? String(row.full_name).normalize("NFKC") : String(row[field]);
    return text.toLocaleLowerCase().includes(value.slice(1, -1).toLocaleLowerCase());
  }
  const actual = field === "created_at" ? micros(String(row[field])) : String(row[field]);
  const expected = field === "created_at" ? micros(value) : value;
  return op === "eq" ? actual === expected : actual < expected;
}
function logic(row: Row, expression: string): boolean {
  const group = /^(and|or)\((.*)\)$/s.exec(expression);
  if (!group) return atom(row, expression);
  return group[1] === "and" ? split(group[2]).every(v => logic(row, v)) : split(group[2]).some(v => logic(row, v));
}
function sorted(rows: Row[]): Row[] { return [...rows].sort((a, b) => micros(String(a.created_at)) === micros(String(b.created_at)) ? String(b.id).localeCompare(String(a.id)) : micros(String(a.created_at)) > micros(String(b.created_at)) ? -1 : 1); }
function harness(role: string | null = "admin", options: { cap?: number; enrichmentCap?: number; missingCount?: boolean } = {}) {
  const requests: { table: string; url: URL; gate: boolean }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), table = url.pathname.split("/").at(-1)!;
    const gate = table === "profiles" && url.searchParams.get("select") === "role";
    requests.push({ table, url, gate });
    let rows: Row[] = gate ? [{ id: actorId, role }] : table === "profiles" ? [...artisans, ...clients, { id: actorId, role: "admin", full_name: "Operator", created_at: created(0) }] : table === "organizations" ? [...organizations] : [...dossiers];
    for (const [key, value] of url.searchParams) {
      if (key === "or") rows = rows.filter(row => logic(row, `or${value}`));
      else if (!["select", "order", "limit"].includes(key)) rows = rows.filter(row => atom(row, `${key}.${value}`));
    }
    const total = rows.length;
    if (url.searchParams.has("order")) rows = sorted(rows);
    const cap = table === "artisan_profiles" ? options.enrichmentCap : options.cap;
    rows = rows.slice(0, Math.min(Number(url.searchParams.get("limit") ?? Infinity), cap ?? Infinity));
    const fields = (url.searchParams.get("select") ?? "*").split(","); rows = rows.map(row => Object.fromEntries(fields.map(k => [k, row[k]])));
    const headers = new Headers({ "Content-Type": "application/json" });
    if (!options.missingCount || gate) headers.set("Content-Range", `0-${Math.max(0, rows.length - 1)}/${total}`);
    const singular = new Headers(init?.headers).get("Accept") === "application/vnd.pgrst.object+json";
    return new Response(init?.method === "HEAD" ? null : JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers });
  };
  const db = createClient("https://provider.example.test", "public-test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async () => { if (role === null) throw new ApiError(401, "Session requise"); return { db, user: { id: actorId } }; },
    dbError: (error: unknown) => { if (error) throw new ApiError(503, "Fournisseur indisponible"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : 500 }),
  };
  const module: { exports: { GET?: (request: Request) => Promise<Response> } } = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => name === "@/lib/supabase/server" ? helpers : name === "@/lib/supabase/validation" ? { uuid: z.string().uuid() } : require(name), Buffer, URL, URLSearchParams, Response, Request }, { filename: "admin-directory-route.js" });
  return { requests, get: (params: URLSearchParams | string = "") => module.exports.GET!(new Request(`https://app.example.test/api/admin/directory?${params}`)) };
}

test("all directory and detail reads require platform admin before data queries; errors stay private", async () => {
  for (const kind of Object.keys(byKind)) for (const role of [null, "client", "artisan", "manager", "owner", "viewer"]) {
    const h = harness(role), response = await h.get(`kind=${kind}&id=${id(1)}`);
    assert.equal(response.status, role === null ? 401 : 403); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.ok(h.requests.every(r => r.gate));
  }
});
test("each directory paginates 237 tied/microsecond records once with invariant global filtered total", async () => {
  for (const kind of Object.keys(byKind) as Kind[]) {
    const h = harness(), found: string[] = []; let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ kind, limit: "17" }); if (cursor) params.set("cursor", cursor);
      const response = await h.get(params); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); const body = await response.json();
      assert.equal(body.page.total, 237); found.push(...body.items.map((r: Row) => String(r.id))); cursor = body.page.next_cursor; assert.equal(body.page.has_more, cursor !== null);
      if (cursor) assert.match(JSON.parse(Buffer.from(cursor, "base64url").toString()).created_at, /\.\d{6}\+00:00$/);
    } while (cursor);
    assert.deepEqual(found, sorted(byKind[kind]).map(r => r.id)); assert.equal(new Set(found).size, 237);
  }
});
test("kind-specific filters and literal search apply before pagination/count", async () => {
  for (const [kind, extra, expected] of [
    ["artisans", { approved: "true", q: "Électricité" }, artisans.filter(r => r.artisan_approved && String(r.full_name).includes("Électricité"))],
    ["clients", { role: "manager", q: "Clients" }, clients.filter(r => r.role === "manager" && String(r.full_name).includes("Clients"))],
    ["organizations", { owner_id: String(organizations[1].owner_id), q: "Bureaux" }, organizations.filter(r => r.owner_id === organizations[1].owner_id && String(r.name).includes("Bureaux"))],
  ] as [Kind, Record<string, string>, Row[]][]) {
    const h = harness(), params = new URLSearchParams({ kind, limit: "9", ...extra }), found: string[] = []; let cursor: string | null = null;
    do { if (cursor) params.set("cursor", cursor); const response = await h.get(params); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.page.total, expected.length); found.push(...body.items.map((r: Row) => String(r.id))); cursor = body.page.next_cursor; } while (cursor);
    assert.deepEqual(found, sorted(expected).map(r => r.id));
  }
});
test("minimal projections preserve legacy artisans without dossier and never expose Auth/financial/registration data", async () => {
  for (const kind of Object.keys(byKind) as Kind[]) {
    const body = await (await harness().get(`kind=${kind}&limit=100`)).json();
    for (const row of body.items) for (const key of ["email", "stripe_account_id", "address", "siret", "secret", "role_secret"]) assert.ok(!(key in row));
    if (kind === "artisans") { assert.ok(body.items.some((r: Row) => r.company_name === null && r.application_status === null)); assert.ok(body.items.some((r: Row) => typeof r.company_name === "string")); }
    if (kind === "clients") assert.ok(body.items.every((r: Row) => r.role === "client" || r.role === "manager"));
  }
});
test("cursor binds kind and filters but permits page-size changes", async () => {
  const h = harness(), first = await (await h.get("kind=clients&q=Équipe&limit=3")).json(); assert.ok(first.page.next_cursor);
  for (const params of [{ kind: "artisans", q: "Équipe" }, { kind: "clients", q: "Alice" }, { kind: "clients", q: "Équipe", role: "manager" }] as Record<string, string>[]) assert.equal((await h.get(new URLSearchParams({ ...params, cursor: first.page.next_cursor }))).status, 422);
  const body = await (await h.get(new URLSearchParams({ kind: "clients", q: "Équipe", limit: "7", cursor: first.page.next_cursor }))).json(); assert.equal(body.items.length, 7); assert.ok(!body.items.some((r: Row) => first.items.some((a: Row) => a.id === r.id)));
});
test("malformed/incompatible parameters, cursors and injection strings fail before directory reads", async () => {
  for (const params of ["", "kind=unknown", "kind=clients&kind=artisans", "kind=clients&unknown=x", "kind=clients&approved=true", "kind=artisans&role=client", "kind=organizations&role=client", "kind=clients&owner_id=x", "kind=clients&role=admin", "kind=artisans&approved=1", "kind=organizations&owner_id=bad", "kind=clients&limit=0", "kind=clients&limit=101", "kind=clients&limit=01", "kind=clients&cursor=", "kind=clients&cursor=e30", "kind=clients&cursor=a===", "kind=clients&id=bad", `kind=clients&id=${clients[0].id}&q=foo`]) {
    const h = harness(); assert.equal((await h.get(params)).status, 422, params); assert.ok(h.requests.every(r => r.gate), params);
  }
  for (const q of ["a", "a".repeat(81), "name.eq.foo,role.eq.admin", "foo%", "foo_", 'foo"', "foo(bar)", "foo:bar", "foo.bar", "ＦＯＯ，admin"]) assert.equal((await harness().get(new URLSearchParams({ kind: "clients", q }))).status, 422, q);
  const first = await (await harness().get("kind=clients&limit=3")).json(), cursor = JSON.parse(Buffer.from(first.page.next_cursor, "base64url").toString()); cursor.created_at = '2026-10-01T00:00:00Z",role.eq.admin';
  assert.equal((await harness().get(new URLSearchParams({ kind: "clients", cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url") }))).status, 422);
});
test("literal apostrophe search, uppercase UUID reference, empty results and old details are exact", async () => {
  for (const kind of Object.keys(byKind) as Kind[]) {
    const h = harness(), row = byKind[kind][0];
    const found = await (await h.get(new URLSearchParams({ kind, q: "L’équipe d'Alice" }))).json(); assert.ok(found.items.length > 0);
    const exact = await (await h.get(new URLSearchParams({ kind, q: String(row.id).toUpperCase() }))).json(); assert.equal(exact.page.total, 1); assert.equal(exact.items[0].id, row.id);
    const detail = await (await h.get(`kind=${kind}&id=${row.id}`)).json(); assert.equal(detail.item.id, row.id);
    assert.equal((await h.get(`kind=${kind}&id=${id(99999)}`)).status, 404);
    const empty = await (await h.get(`kind=${kind}&q=AbsentMarker`)).json(); assert.deepEqual(empty.items, []); assert.equal(empty.page.total, 0); assert.equal(empty.page.next_cursor, null);
  }
  assert.equal((await harness().get(`kind=clients&id=${artisans[0].id}`)).status, 404);
});
test("provider caps cannot silently truncate history or artisan enrichment; missing count fails closed", async () => {
  const body = await (await harness("admin", { cap: 10 }).get("kind=clients&limit=100")).json(); assert.equal(body.items.length, 10); assert.equal(body.page.has_more, true); assert.equal(body.page.total, 237);
  assert.equal((await harness("admin", { enrichmentCap: 1 }).get("kind=artisans&limit=100")).status, 503);
  assert.equal((await harness("admin", { missingCount: true }).get("kind=clients")).status, 503);
});
