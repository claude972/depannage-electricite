import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url);
const id = "10000000-0000-4000-8000-000000000001";
const token = "a".repeat(64);
const draft = { draft: null, version: 0, assignment_token: token, current_quote_id: null };
type Context = { params: Promise<{ id: string }> };
type Handler = (request: Request, context: Context) => Promise<Response>;
function harness(options: { authenticated?: boolean; error?: { code: string }; data?: unknown } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const helpers = {
    ApiError,
    authenticatedClient: async () => {
      if (options.authenticated === false) throw new ApiError(401, "Session requise");
      return { user: { id }, db: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return { data: "data" in options ? options.data : draft, error: options.error ?? null }; } } };
    },
    assertOrigin: (request: Request) => { const origin = request.headers.get("origin"); if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "Origine refusée"); },
    dbError: (error: { code: string } | null) => { if (error) throw new ApiError(({ P0001: 409, "42501": 403, "22023": 422, "53300": 429 } as Record<string, number>)[error.code] ?? 503, "Commande refusée"); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 500 }),
  };
  function compile(path: string, imports: Record<string, unknown>) {
    const module: { exports: Record<string, unknown> } = { exports: {} };
    const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
    vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => imports[name] ?? require(name), URL, Request, Response, Buffer, SyntaxError }, { filename: path });
    return module.exports;
  }
  // Use the actual shared validator, not a duplicate of its body/strict-schema behavior.
  const validation = compile("../lib/supabase/validation.ts", { "./server": helpers });
  const route = compile("../app/api/interventions/[id]/quote-draft/route.ts", { "@/lib/supabase/server": helpers, "@/lib/supabase/validation": validation });
  return {
    calls,
    get: (query = "", dossier = id) => (route.GET as Handler)(new Request(`https://app.example.test/api/interventions/${dossier}/quote-draft${query}`), { params: Promise.resolve({ id: dossier }) }),
    post: (body: unknown, origin = "https://app.example.test", dossier = id) => (route.POST as Handler)(new Request(`https://app.example.test/api/interventions/${dossier}/quote-draft`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: dossier }) }),
  };
}
test("draft GET authenticates, rejects extra query/id and forwards only the current dossier load", async () => {
  const h = harness(); const response = await h.get(); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(h.calls, [{ name: "manage_quote_draft", args: { p_id: id, p_action: "load" } }]); assert.deepEqual(await response.json(), draft);
  const invalid = harness(); assert.equal((await invalid.get("?user_id=other")).status, 422); assert.equal((await invalid.get("", "invalid")).status, 422); assert.equal(invalid.calls.length, 0);
  const anonymous = harness({ authenticated: false }); assert.equal((await anonymous.get()).status, 401); assert.equal(anonymous.calls.length, 0);
});
test("save accepts a private incomplete draft and does not accept browser totals or actor identities", async () => {
  const h = harness(); const response = await h.post({ action: "save", expected_version: 0, assignment_token: token, base_quote_id: null, lines: [], tax_rate: null });
  assert.equal(response.status, 200); assert.deepEqual(h.calls[0], { name: "manage_quote_draft", args: { p_id: id, p_action: "save", p_expected_version: 0, p_assignment_token: token, p_base_quote_id: null, p_lines: [], p_tax_rate: null } });
  for (const extra of [{ total_cents: 1 }, { artisan_id: id }, { subtotal_cents: 1 }]) {
    const invalid = harness(); assert.equal((await invalid.post({ action: "save", expected_version: 0, assignment_token: token, base_quote_id: null, lines: [], tax_rate: null, ...extra })).status, 422); assert.equal(invalid.calls.length, 0);
  }
});
test("draft payload rejects invalid money, revision, token, tax and missing base reference before RPC", async () => {
  const valid = { action: "save", expected_version: 0, assignment_token: token, base_quote_id: null, lines: [{ label: "Travail", quantity: 1, unit_price_cents: 1000 }], tax_rate: 20 };
  for (const patch of [{ expected_version: -1 }, { expected_version: 1.5 }, { expected_version: 2147483648 }, { assignment_token: "bad" }, { tax_rate: 7 }, { lines: [{ label: "Travail", quantity: 1, unit_price_cents: -1 }] }, { lines: [{ label: "Travail", quantity: 1.5, unit_price_cents: 1 }] }, { lines: [{ label: "Travail", quantity: 1, unit_price_cents: 1, total_cents: 1 }] }, { base_quote_id: "bad" }]) {
    const h = harness(); assert.equal((await h.post({ ...valid, ...patch })).status, 422); assert.equal(h.calls.length, 0);
  }
  const h = harness(); const { base_quote_id: _unused, ...missing } = valid; assert.equal((await h.post(missing)).status, 422); assert.equal(h.calls.length, 0);
});
test("send and discard pass only optimistic revision/assignment, never caller publication lines", async () => {
  for (const action of ["send", "discard"]) {
    const h = harness(); assert.equal((await h.post({ action, expected_version: 4, assignment_token: token })).status, 200);
    assert.deepEqual(h.calls[0].args, { p_id: id, p_action: action, p_expected_version: 4, p_assignment_token: token });
    const invalid = harness(); assert.equal((await invalid.post({ action, expected_version: 4, assignment_token: token, lines: [] })).status, 422); assert.equal(invalid.calls.length, 0);
  }
});
test("RPC conflict/suspension/rate errors stay explicit and private; malformed success is not an empty successful draft", async () => {
  for (const [code, status] of [["P0001", 409], ["42501", 403], ["53300", 429]] as const) {
    const response = await harness({ error: { code } }).post({ action: "send", expected_version: 2, assignment_token: token });
    assert.equal(response.status, status); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  const h = harness(); assert.equal((await h.post({ action: "send", expected_version: 2, assignment_token: token }, "https://foreign.example.test")).status, 403); assert.equal(h.calls.length, 0);
  assert.equal((await harness({ data: null }).get()).status, 503);
});
