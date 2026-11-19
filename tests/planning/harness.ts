// Shared test harness for the planning/notification routes: compiles the TypeScript route files
// with esbuild inside a vm, resolves "@/" and relative imports to the repository, and replaces
// "@/lib/supabase/server" with fakes. The Supabase client is the real supabase-js over a fetch
// stub that evaluates a small PostgREST subset, exactly like tests/support.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";
const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export type Row = Record<string, unknown>;
const SERVER = path.join(ROOT, "lib/supabase/server.ts");
// CSS modules become their class names; esbuild interop reads __esModule/default.
const cssStub: Record<string, unknown> = new Proxy({}, { get: (_, key) => (key === "__esModule" ? undefined : key === "default" ? cssStub : typeof key === "symbol" ? undefined : String(key)) });
export const uuid = (n: number, prefix = "50000000") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const micros = (s: string) => BigInt(Date.parse(s)) * 1000n + BigInt((/\.(\d{1,6})/.exec(s)?.[1] ?? "").slice(3).padEnd(3, "0") || "0");
function split(value: string) { const parts: string[] = []; let depth = 0, quote = false, start = 0; for (let i = 0; i < value.length; i++) { const c = value[i]; if (c === '"') quote = !quote; if (quote) continue; if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && !depth) { parts.push(value.slice(start, i)); start = i + 1; } } parts.push(value.slice(start)); return parts; }
function atom(row: Row, expression: string): boolean {
  const parsed = /^([a-z_]+)\.(eq|lt|gt|lte|gte|is|ilike)\.(.*)$/s.exec(expression); assert.ok(parsed, expression);
  const [, field, op, raw] = parsed, value = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === "is") return value === "null" ? row[field] === null || row[field] === undefined : row[field] === (value === "true");
  if (op === "ilike") return String(row[field]).toLowerCase().includes(value.slice(1, -1).toLowerCase());
  const temporal = field === "created_at" || field === "starts_at";
  const actual = temporal ? micros(String(row[field])) : typeof row[field] === "number" ? Number(row[field]) : String(row[field]);
  const expected = temporal ? micros(value) : typeof row[field] === "number" ? Number(value) : value;
  return op === "eq" ? actual === expected : op === "lt" ? actual < expected : op === "gt" ? actual > expected : op === "gte" ? actual >= expected : actual <= expected;
}
function logic(row: Row, expression: string): boolean { const match = /^(and|or)\((.*)\)$/s.exec(expression); if (!match) return atom(row, expression); return match[1] === "and" ? split(match[2]).every(v => logic(row, v)) : split(match[2]).some(v => logic(row, v)); }
export type RpcHandler = (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { code: string; message?: string } } | undefined;
export type HarnessOptions = {
  /** null = unauthenticated. */
  role?: string | null;
  userId?: string;
  tables?: Record<string, Row[]>;
  rpc?: RpcHandler;
  rpcError?: string;
  rpcData?: unknown;
  missingCount?: boolean;
};
export function harness(options: HarnessOptions = {}) {
  const role = options.role === undefined ? "artisan" : options.role;
  const user = options.userId ?? uuid(1);
  const authenticationRequests: (Request | undefined)[] = [];
  const requests: { table: string; args?: Record<string, unknown>; url: URL; method: string }[] = [];
  const tables: Record<string, Row[]> = { profiles: [{ id: user, role }], ...(options.tables ?? {}) };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), table = url.pathname.split("/").at(-1)!;
    const method = init?.method ?? "GET";
    if (url.pathname.includes("/rpc/")) {
      const args = JSON.parse(String(init?.body ?? "{}")); requests.push({ table, args, url, method });
      if (options.rpcError) return Response.json({ code: options.rpcError, message: "Refus SQL" }, { status: 409 });
      const custom = options.rpc?.(table, args);
      if (custom?.error) return Response.json({ code: custom.error.code, message: custom.error.message ?? "Refus SQL" }, { status: 409 });
      if (custom) return Response.json(custom.data ?? null);
      return Response.json("rpcData" in options ? options.rpcData : { ok: true, rpc: table, args });
    }
    requests.push({ table, url, method });
    let rows: Row[] = tables[table] ?? [];
    for (const [key, value] of url.searchParams) if (key === "or") rows = rows.filter(row => logic(row, `or${value}`)); else if (!["select", "order", "limit"].includes(key)) rows = rows.filter(row => atom(row, `${key}.${value}`));
    const total = rows.length, ordering = (url.searchParams.get("order") ?? "").split(",").filter(Boolean);
    rows = [...rows].sort((a, b) => { for (const term of ordering) { const [field, direction] = term.split("."); const temporal = field === "created_at" || field === "starts_at"; const av = temporal ? micros(String(a[field])) : String(a[field]), bv = temporal ? micros(String(b[field])) : String(b[field]); if (av !== bv) return (av < bv ? -1 : 1) * (direction === "desc" ? -1 : 1); } return 0; });
    rows = rows.slice(0, Number(url.searchParams.get("limit") ?? Infinity));
    const fields = (url.searchParams.get("select") ?? "*").split(","); rows = rows.map(row => fields[0] === "*" ? row : Object.fromEntries(fields.map(f => [f, row[f]])));
    const headers = new Headers({ "Content-Type": "application/json" }); if (!options.missingCount) headers.set("Content-Range", `0-${Math.max(rows.length - 1, 0)}/${total}`);
    const singular = new Headers(init?.headers).get("Accept") === "application/vnd.pgrst.object+json";
    return new Response(method === "HEAD" ? null : JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers });
  };
  const db = createClient("https://planning.example.test", "public-test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async (request?: Request) => { authenticationRequests.push(request); if (role === null) throw new ApiError(401, "Session requise"); return { db, user: { id: user } }; },
    assertOrigin: (request: Request) => { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine refusée"); },
    dbError: (error: { code: string } | null) => { if (error) throw new ApiError(({ P0001: 409, P0002: 404, "42501": 403, "22023": 422, "23505": 409, "53300": 429 } as Record<string, number>)[error.code] ?? 503, "Commande refusée"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
  const cache = new Map<string, Record<string, unknown>>();
  function resolve(from: string, name: string): string | null {
    const base = name.startsWith("@/") ? path.join(ROOT, name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(from), name) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) { try { if (readFileSync(candidate)) return candidate; } catch { /* next */ } }
    throw new Error(`Import introuvable : ${name} depuis ${from}`);
  }
  function compile(file: string): Record<string, unknown> {
    const cached = cache.get(file); if (cached) return cached;
    const module: { exports: Record<string, unknown> } = { exports: {} }; cache.set(file, module.exports);
    const code = transformSync(readFileSync(file, "utf8"), { loader: file.endsWith(".tsx") ? "tsx" : "ts", jsx: "automatic", format: "cjs", target: "es2022" }).code;
    vm.runInNewContext(code, { module, exports: module.exports, process, Buffer, URL, URLSearchParams, Request, Response, Headers, SyntaxError, Intl, Date, Math, Number, JSON, Map, Set, RangeError, Error, console, require: (name: string) => {
      if (name.endsWith(".css")) return cssStub;
      const target = name === "@/lib/supabase/server" ? SERVER : resolve(file, name);
      if (target === SERVER) return helpers;
      return target ? compile(target) : require(name);
    } }, { filename: file });
    // esbuild's CommonJS output reassigns module.exports: publish the final object.
    cache.set(file, module.exports);
    return module.exports;
  }
  const load = (relative: string) => compile(path.join(ROOT, relative));
  const request = (urlPath: string, body?: unknown, origin = "https://app.example.test") => new Request(`https://app.example.test${urlPath}`, body === undefined ? undefined : { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { requests, authenticationRequests, user, db, load, request, ApiError };
}
export type Handler = (request: Request) => Promise<Response>;
