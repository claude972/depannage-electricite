// Route handlers compiled in isolation with fake server helpers: validation, refusal mapping,
// snapshot verification and command dispatch. No network, no Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as schemas from "../../lib/features/site-operations/schemas";
import * as report from "../../lib/features/site-operations/report";
import { demoSnapshot } from "../../lib/features/site-operations/demo";
const require = createRequire(import.meta.url);
const site = "22222222-2222-4222-8222-222222222222";
type Options = { authenticated?: boolean; rpcError?: string; rpcData?: unknown };
function harness(options: Options = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (options.rpcError) return { data: null, error: { code: options.rpcError, message: "Refus SQL interne" } };
      return { data: "rpcData" in options ? options.rpcData : fn === "site_operations_snapshot" ? demoSnapshot() : { id: "row", version: 2 }, error: null };
    },
  };
  const helpers = {
    ApiError,
    authenticatedClient: async () => { if (options.authenticated === false) throw new ApiError(401, "Connectez-vous pour accéder à cet espace."); return { db, user: { id: "user" } }; },
    assertOrigin: (request: Request) => { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine de la requête non autorisée."); },
    dbError: (error: { code: string } | null) => { if (error) throw new ApiError(({ P0001: 409, "42501": 403, P0002: 404, "22023": 422, "53300": 429 } as Record<string, number>)[error.code] ?? 503, "Refus serveur rendu tel quel"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
  const validation = {
    validated: async (request: Request, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } }) => {
      const raw = await request.text();
      if (raw.length > 65536) throw new ApiError(413, "Le contenu envoyé est trop volumineux.");
      const result = schema.safeParse(JSON.parse(raw));
      if (!result.success) throw new ApiError(422, result.error?.issues[0]?.message ?? "Vérifiez les informations saisies.");
      return result.data;
    },
  };
  const code = transformSync(readFileSync(new URL("../../app/api/site-operations/route.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
  const module: { exports: Record<string, (request: Request) => Promise<Response>> } = { exports: {} };
  const imports: Record<string, unknown> = { "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation, "@/lib/features/site-operations/schemas": schemas, "@/lib/features/site-operations/report": report };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => imports[name] ?? require(name), URL, Request, Response, SyntaxError, Date, Intl }, { filename: "route.ts" });
  return { ...module.exports, calls };
}
const get = (query: string, options?: Options) => harness(options).GET(new Request(`https://app.example.test/api/site-operations${query}`));
const post = (body: unknown, options?: Options, headers: Record<string, string> = {}) => {
  const h = harness(options);
  return h.POST(new Request("https://app.example.test/api/site-operations", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })).then((response) => ({ response, calls: h.calls }));
};

test("GET requires exactly one site_id and a session; responses are private", async () => {
  for (const query of ["", "?site_id=abc", `?site_id=${site}&site_id=${site}`, `?site_id=${site}&extra=1`]) {
    const response = await get(query);
    assert.equal(response.status, 422, query);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal((await get(`?site_id=${site}`, { authenticated: false })).status, 401);
});
test("GET returns the snapshot with server-computed SLA and completeness", async () => {
  const h = harness();
  const response = await h.GET(new Request(`https://app.example.test/api/site-operations?site_id=${site}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.site_id, site);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ fn: "site_operations_snapshot", args: { p_site_id: site } }]);
  assert.equal(body.sla.cases.length, 2);
  assert.equal(typeof body.completeness.budget.configured, "boolean");
  assert.ok(body.computed_at);
  assert.equal(body.snapshot.limits.can_write_site, true);
});
test("GET maps refusals without an existence oracle and rejects malformed snapshots", async () => {
  assert.equal((await get(`?site_id=${site}`, { rpcError: "42501" })).status, 403, "unknown and foreign site answer the same");
  assert.equal((await get(`?site_id=${site}`, { rpcError: "53300" })).status, 429);
  for (const data of [null, "text", [], { site: {} }, { ...demoSnapshot(), equipment: "x" }, { ...demoSnapshot(), contract_grids: "x" }]) {
    const response = await get(`?site_id=${site}`, { rpcData: data });
    assert.equal(response.status, 503, JSON.stringify(data).slice(0, 40));
    assert.doesNotMatch((await response.json()).error, /snapshot|rpc|site_operations/i, "no internal name in copy");
  }
  const nullGrids = await get(`?site_id=${site}`, { rpcData: { ...demoSnapshot(), contract_grids: null } });
  assert.equal(nullGrids.status, 200);
  assert.equal((await nullGrids.json()).completeness.contract_grids.readable, false);
});
test("POST validates origin, query, body and dispatches the matching SQL command", async () => {
  const command = { action: "save_equipment", site_id: site, payload: { name: "QA", category: "panel", criticality: "low", location: "", reference: "", installed_on: null, status: "in_service", notes: "" } };
  assert.equal((await post(command, {}, { origin: "https://evil.example.test" })).response.status, 403);
  assert.equal((await post(command, { authenticated: false })).response.status, 401);
  assert.equal((await post("{broken")).response.status, 400);
  assert.equal((await post({ ...command, action: "drop" })).response.status, 422);
  assert.equal((await post({ ...command, id: "e1000000-0000-4000-8000-000000000001" })).response.status, 422, "id without expected_version");
  const h = harness();
  const withQuery = await h.POST(new Request(`https://app.example.test/api/site-operations?x=1`, { method: "POST", body: JSON.stringify(command) }));
  assert.equal(withQuery.status, 422);
  assert.equal(h.calls.length, 0);
  const ok = await post(command, {}, { origin: "https://app.example.test" });
  assert.equal(ok.response.status, 200);
  assert.deepEqual(ok.calls, [{ fn: "save_site_equipment", args: { p_site_id: site, p_payload: command.payload, p_id: null, p_expected_version: null } }]);
  const body = await ok.response.json();
  assert.equal(body.action, "save_equipment");
  assert.deepEqual(body.result, { id: "row", version: 2 });
  assert.equal(ok.response.headers.get("Cache-Control"), "private, no-store");
});
test("POST renders server refusals as-is and never claims success without a row", async () => {
  const publish = { action: "publish_contract_grid", id: "d1000000-0000-4000-8000-000000000001", expected_version: 3 };
  for (const [code, status] of [["42501", 403], ["P0001", 409], ["P0002", 404], ["22023", 422], ["53300", 429], ["XX000", 503]] as const) {
    const { response } = await post(publish, { rpcError: code });
    assert.equal(response.status, status, code);
    assert.equal((await response.json()).error, "Refus serveur rendu tel quel");
  }
  for (const data of [null, "ok", [1]]) assert.equal((await post(publish, { rpcData: data })).response.status, 503);
  const pause = await post({ action: "pause_sla_case", id: publish.id, started_at: "2026-10-05T07:00:00Z", reason: "QA", expected_version: 1 });
  assert.equal(pause.calls[0].fn, "pause_sla_case");
  assert.equal(pause.calls[0].args.p_case_id, publish.id);
});
