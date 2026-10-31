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
type Options = { scopes?: string[]; rights?: unknown; role?: string | null; revoked?: boolean; rpcError?: string; rpcData?: unknown; missingCount?: boolean };
function harness(options: Options = {}) {
  const role = options.role === undefined ? "client" : options.role;
  const requests: { table: string; args?: Record<string, unknown>; url: URL }[] = [];
  const rights = "rights" in options ? options.rights : { can_read_all: role === "admin", can_reply_all: role === "admin", can_set_status_all: role === "admin" };
  const visible = (ticket: Row) => role === "admin" || (rights as {can_read_all?: boolean} | null)?.can_read_all === true || (ticket.creator_id === user && !(options.revoked && ticket.intervention_id));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), table = url.pathname.split("/").at(-1)!;
    if (url.pathname.includes("/rpc/")) {
      const args = JSON.parse(String(init?.body ?? "{}")); requests.push({ table, args, url });
      if(table === "platform_access") return Response.json({super_admin:role === "admin",scopes:options.scopes ?? [],super_admin_count:role === "admin" ? 1 : null});
      if(table === "support_operator_permissions") return Response.json(rights);
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
  function compile(path: string, imports: Record<string, unknown>) { const module: { exports: Record<string, unknown> } = { exports: {} }; const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code; vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => imports[name] ?? require(name), Buffer, URL, URLSearchParams, Request, Response, SyntaxError, process: {env:{}} }, { filename: path }); return module.exports; }
  const validation = compile("../lib/supabase/validation.ts", { "./server": helpers });
  const permissions = compile("../lib/features/support/permissions.ts", { "@/lib/supabase/server": helpers });
  const imports = { "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation, "@/lib/features/support/permissions": permissions };
  const list = compile("../app/api/support/route.ts", imports), detail = compile("../app/api/support/[id]/route.ts", imports);
  const request = (path: string, body?: unknown, origin = "https://app.example.test") => new Request(`https://app.example.test${path}`, body === undefined ? undefined : { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  type ListHandler = (r: Request) => Promise<Response>; type DetailHandler = (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
  return {
    requests, permissions, compile, helpers, db,
    list: (params: URLSearchParams | string = "") => (list.GET as ListHandler)(request(`/api/support?${params}`)),
    create: (body: unknown, origin?: string) => (list.POST as ListHandler)(request("/api/support", body, origin)),
    detail: (id = String(tickets[0].id), params: URLSearchParams | string = "") => (detail.GET as DetailHandler)(request(`/api/support/${id}?${params}`), { params: Promise.resolve({ id }) }),
    mutate: (body: unknown, id = String(tickets[0].id), origin?: string) => (detail.POST as DetailHandler)(request(`/api/support/${id}`, body, origin), { params: Promise.resolve({ id }) }),
  };
}
const rights=(read=false,reply=false,status=false)=>({can_read_all:read,can_reply_all:reply,can_set_status_all:status});
test('operator permissions decode fails closed for missing, extra, malformed or incoherent RPC payloads',async()=>{
  const decode=harness().permissions.decodeSupportOperatorPermissions as (v:unknown)=>unknown;
  for(const input of [null,undefined,[],true,{},rights(false,true),rights(false,false,true),{...rights(),extra:true},{...rights(),can_read_all:'true'}])assert.throws(()=>decode(input));
  for(const input of [rights(),rights(true),rights(true,true),rights(true,false,true),rights(true,true,true)])assert.deepEqual(JSON.parse(JSON.stringify(decode(input))),input);
});
test('global support list uses server rights, preserves mine default, and never promotes a client role',async()=>{
  const read=harness({rights:rights(true)});const response=await read.list('scope=all');assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.page.total,147);assert.equal(data.filters.scope,'all');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await read.list()).status,200);const mine=await(await read.list()).json();assert.equal(mine.filters.scope,'mine');assert.equal(mine.page.total,131);
  assert.equal((await harness({rights:rights()}).list('scope=all')).status,403);
  assert.equal((await harness({role:null}).list('scope=all')).status,401);
  for(const malformed of [null,{},[],{...rights(),can_reply_all:1}])assert.equal((await harness({rights:malformed}).list('scope=all')).status,503);
});
test('detail rights separate read-only, reply, status and creator fallback including resolved tickets',async()=>{
  const target=String(tickets[140].id); // foreign creator, open status
  for(const [r,expected] of [[rights(true),{can_reply:false,can_set_status:false}],[rights(true,true),{can_reply:true,can_set_status:false}],[rights(true,false,true),{can_reply:false,can_set_status:true}],[rights(true,true,true),{can_reply:true,can_set_status:true}]] as const){
    const response=await harness({rights:r}).detail(target);assert.equal(response.status,200);assert.deepEqual((await response.json()).permissions,expected);
  }
  assert.equal((await harness({rights:rights()}).detail(target)).status,404);
  assert.equal((await harness({rights:null}).detail()).status,503);
  const helper=harness().permissions.supportTicketPermissions as (r:unknown,uid:string,t:unknown)=>unknown;
  assert.deepEqual(JSON.parse(JSON.stringify(helper(rights(true,true),user,{creator_id:user,status:'resolved'}))),{can_reply:false,can_set_status:false});
  assert.deepEqual(JSON.parse(JSON.stringify(helper(rights(),user,{creator_id:user,status:'resolved'}))),{can_reply:true,can_set_status:false});
  assert.deepEqual(JSON.parse(JSON.stringify(helper(rights(true,false,true),user,{creator_id:user,status:'resolved'}))),{can_reply:true,can_set_status:true});
});
test('server mutation refusals retain exact 403/409 and private cache; payload and origin remain bounded',async()=>{
  const body={action:'reply',expected_version:1,body:'Réponse opérateur de recette'};
  for(const [code,status] of [['42501',403],['P0001',409]] as const){const h=harness({rights:rights(true,true),rpcError:code});const response=await h.mutate(body);assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'private, no-store');}
  const h=harness({rights:rights(true,true)});assert.equal((await h.mutate(body,undefined,'https://foreign.example.test')).status,403);assert.equal(h.requests.length,0);
  assert.equal((await h.mutate({...body,expected_version:0})).status,422);
  assert.equal((await h.mutate({...body,scope:'admin'})).status,422);
});
test('operator list cursor remains bound to filters and exact counts fail closed',async()=>{
  const h=harness({rights:rights(true)});const first=await(await h.list('scope=all&limit=25')).json();assert.ok(first.page.next_cursor);
  assert.equal((await h.list(new URLSearchParams({scope:'all',limit:'25',status:'resolved',cursor:first.page.next_cursor}))).status,422);
  const second=await(await h.list(new URLSearchParams({scope:'all',limit:'25',cursor:first.page.next_cursor}))).json();assert.equal(second.tickets.length,25);
  assert.equal(new Set([...first.tickets,...second.tickets].map((t:Row)=>t.id)).size,50);
  assert.equal((await harness({rights:rights(true),missingCount:true}).list('scope=all')).status,503);
});
test('platform me advertises the three combined support capabilities without finance or operator management',async()=>{
  for(const [scopes,expected] of [[[],[false,false,false]],[['support_reply','support_status'],[false,false,false]],[['support_read'],[true,false,false]],[['support_read','support_reply'],[true,true,false]],[['support_read','support_status'],[true,false,true]]] as const){
    const h=harness({scopes:[...scopes]});
    const http=h.compile('../lib/features/platform-operations/http.ts',{'@/lib/supabase/server':h.helpers,'@/lib/supabase/validation':{uuid:{}},'./config':{INVOICE_RENDERING_AVAILABLE:true,financeConfig:()=>({})}});
    const access=await (http.describeAccess as (db:unknown)=>Promise<{capabilities:Record<string,boolean>}>)(h.db);
    assert.deepEqual([access.capabilities.support,access.capabilities.support_reply,access.capabilities.support_status],[...expected]);
    assert.equal(access.capabilities.finance,false);assert.equal(access.capabilities.operators,false);assert.equal(access.capabilities.audit,false);assert.equal(access.capabilities.reviews_moderation,false);
    assert.ok(h.requests.every(r=>r.table==='platform_access'),'support capability probe never reads finance tables');
  }
});
