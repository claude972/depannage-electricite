import test from "node:test";
import assert from "node:assert/strict";
import { IDS, fakeServerHelpers, latin1, loadModule, sampleSnapshot } from "./harness";

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Options = { authenticated?: boolean; rpc?: { data?: unknown; error?: { code: string; message?: string } | null }; quoteLookup?: { data: unknown; error?: { code: string } | null } };
const OVERVIEW = { intervention: { id: IDS.intervention }, viewer: {}, issuer: { ready: true, missing: [] }, quotes: [{ id: IDS.quote, reference: "DEV-100000" }, { id: "10000000-0000-4000-8000-000000000002", reference: "DEV-100000" }], history: [], settlement: "not_connected" };

function harness(options: Options = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const lookups: { table: string; filter: [string, string] }[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return { data: options.rpc && "data" in options.rpc ? options.rpc.data : OVERVIEW, error: options.rpc?.error ?? null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            lookups.push({ table, filter: [column, value] });
            return { data: options.quoteLookup ? options.quoteLookup.data : { intervention_id: IDS.intervention }, error: options.quoteLookup?.error ?? null };
          },
        }),
      }),
    }),
  };
  const helpers = fakeServerHelpers({ authenticated: options.authenticated, db });
  const overrides = { "@/lib/supabase/server": helpers };
  const list = loadModule("app/api/quote-documents/route.ts", overrides);
  const download = loadModule("app/api/quote-documents/[id]/route.ts", overrides);
  const origin = "https://app.example.test";
  return {
    calls,
    lookups,
    get: (query: string) => (list.GET as Handler)(new Request(`${origin}/api/quote-documents${query}`)),
    post: (body: unknown, from = origin) => (list.POST as Handler)(new Request(`${origin}/api/quote-documents`, { method: "POST", headers: { "Content-Type": "application/json", origin: from }, body: JSON.stringify(body) })),
    download: (id: string, query = "") => (download.GET as Handler)(new Request(`${origin}/api/quote-documents/${id}${query}`), { params: Promise.resolve({ id }) }),
  };
}
const noStore = (response: Response) => assert.equal(response.headers.get("Cache-Control"), "private, no-store");

test("overview GET requires exactly one of intervention_id / quote_id, authenticates and forwards the dossier id", async () => {
  const h = harness();
  const response = await h.get(`?intervention_id=${IDS.intervention}`);
  assert.equal(response.status, 200);
  noStore(response);
  assert.deepEqual(h.calls, [{ name: "quote_documents_overview", args: { p_intervention_id: IDS.intervention } }]);
  assert.deepEqual(await response.json(), OVERVIEW);
  for (const query of ["", `?intervention_id=${IDS.intervention}&quote_id=${IDS.quote}`, "?intervention_id=bad", `?intervention_id=${IDS.intervention}&x=1`, `?intervention_id=${IDS.intervention}&intervention_id=${IDS.intervention}`, "?quote_id=bad"]) {
    const invalid = harness();
    const r = await invalid.get(query);
    assert.equal(r.status, 422, query);
    noStore(r);
    assert.equal(invalid.calls.length, 0);
  }
  const anonymous = harness({ authenticated: false });
  assert.equal((await anonymous.get(`?intervention_id=${IDS.intervention}`)).status, 401);
  assert.equal(anonymous.calls.length, 0);
});
test("overview by quote_id resolves the dossier under RLS and narrows the quotes to that exact version", async () => {
  const h = harness();
  const response = await h.get(`?quote_id=${IDS.quote}`);
  assert.equal(response.status, 200);
  assert.deepEqual(h.lookups, [{ table: "quotes", filter: ["id", IDS.quote] }]);
  assert.deepEqual(h.calls[0].args, { p_intervention_id: IDS.intervention });
  const body = await response.json();
  assert.deepEqual(body.quotes.map((q: { id: string }) => q.id), [IDS.quote]);
  const missing = harness({ quoteLookup: { data: null } });
  assert.equal((await missing.get(`?quote_id=${IDS.quote}`)).status, 404);
  assert.equal(missing.calls.length, 0);
  const notInOverview = harness();
  assert.equal((await notInOverview.get("?quote_id=10000000-0000-4000-8000-000000000003")).status, 404);
});
test("overview failures stay explicit: refusal 403, malformed success 503, missing quotes array 503", async () => {
  assert.equal((await harness({ rpc: { error: { code: "42501" } } }).get(`?intervention_id=${IDS.intervention}`)).status, 403);
  assert.equal((await harness({ rpc: { data: null } }).get(`?intervention_id=${IDS.intervention}`)).status, 503);
  assert.equal((await harness({ rpc: { data: { quotes: "no" } } }).get(`?intervention_id=${IDS.intervention}`)).status, 503);
});
test("set_terms validates the date before any command and never accepts a past validity", async () => {
  const h = harness({ rpc: { data: { quote_id: IDS.quote, valid_until: "2999-01-01", validity: "valid" } } });
  const response = await h.post({ action: "set_terms", quote_id: IDS.quote, valid_until: "2999-01-01" });
  assert.equal(response.status, 200);
  noStore(response);
  assert.deepEqual(h.calls, [{ name: "set_quote_terms", args: { p_quote_id: IDS.quote, p_valid_until: "2999-01-01" } }]);
  assert.deepEqual(await response.json(), { action: "set_terms", terms: { quote_id: IDS.quote, valid_until: "2999-01-01", validity: "valid" } });
  const cleared = harness({ rpc: { data: { quote_id: IDS.quote, valid_until: null, validity: "unspecified" } } });
  assert.equal((await cleared.post({ action: "set_terms", quote_id: IDS.quote, valid_until: null })).status, 200);
  assert.deepEqual(cleared.calls[0].args, { p_quote_id: IDS.quote, p_valid_until: null });
  for (const body of [
    { action: "set_terms", quote_id: IDS.quote, valid_until: "2000-01-01" },
    { action: "set_terms", quote_id: IDS.quote, valid_until: "01/01/2999" },
    { action: "set_terms", quote_id: IDS.quote },
    { action: "set_terms", quote_id: IDS.quote, valid_until: null, validity: "valid" },
    { action: "generate", quote_id: IDS.quote },
    { action: "generate", quote_id: IDS.quote, amendment_id: null, total_cents: 1 },
    { action: "other", quote_id: IDS.quote },
  ]) {
    const invalid = harness();
    assert.equal((await invalid.post(body)).status, 422, JSON.stringify(body));
    assert.equal(invalid.calls.length, 0);
  }
  const foreign = harness();
  assert.equal((await foreign.post({ action: "set_terms", quote_id: IDS.quote, valid_until: null }, "https://foreign.example.test")).status, 403);
  assert.equal(foreign.calls.length, 0);
  assert.equal((await harness({ rpc: { error: { code: "P0001" } } }).post({ action: "set_terms", quote_id: IDS.quote, valid_until: null })).status, 409);
});
test("generate returns 201 for a new revision, 200 when the snapshot was unchanged, and the issuer configuration error explicitly", async () => {
  const doc = { id: IDS.document, kind: "quote", reference: "DEV-100000", revision: 1 };
  const created = harness({ rpc: { data: { document: doc, created: true } } });
  const response = await created.post({ action: "generate", quote_id: IDS.quote, amendment_id: IDS.amendment });
  assert.equal(response.status, 201);
  noStore(response);
  assert.deepEqual(created.calls, [{ name: "generate_quote_document", args: { p_quote_id: IDS.quote, p_amendment_id: IDS.amendment } }]);
  assert.deepEqual(await response.json(), { action: "generate", document: doc, created: true });
  const reused = await harness({ rpc: { data: { document: doc, created: false } } }).post({ action: "generate", quote_id: IDS.quote, amendment_id: null });
  assert.equal(reused.status, 200);
  assert.equal((await reused.json()).created, false);
  const issuer = await harness({ rpc: { error: { code: "QD001", message: "issuer_incomplete:company_name,siret" } } }).post({ action: "generate", quote_id: IDS.quote, amendment_id: null });
  assert.equal(issuer.status, 409);
  noStore(issuer);
  const body = await issuer.json();
  assert.equal(body.code, "issuer_incomplete");
  assert.deepEqual(body.missing, ["company_name", "siret"]);
  assert.doesNotMatch(body.error, /QD001|rpc|artisan_profiles/i);
  assert.equal((await harness({ rpc: { data: { created: true } } }).post({ action: "generate", quote_id: IDS.quote, amendment_id: null })).status, 503);
  assert.equal((await harness({ rpc: { error: { code: "42501" } } }).post({ action: "generate", quote_id: IDS.quote, amendment_id: null })).status, 403);
});
test("download streams a private PDF rendered from the stored snapshot after the audited authorisation", async () => {
  const document = { id: IDS.document, kind: "quote", reference: "DEV-100000", revision: 2, quote_id: IDS.quote, amendment_id: null, generated_at: "2026-10-31T14:05:00Z", snapshot_sha256: "ab".repeat(32) };
  const h = harness({ rpc: { data: { document, snapshot: sampleSnapshot({ lineCount: 3 }) } } });
  const response = await h.download(IDS.document);
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [{ name: "record_quote_document_download", args: { p_document_id: IDS.document } }]);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="devis-DEV-100000-r2.pdf"');
  noStore(response);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get("Content-Length"), String(bytes.length));
  assert.ok(latin1(bytes).startsWith("%PDF-1.4\n") && latin1(bytes).endsWith("%%EOF\n"));
  const inline = await harness({ rpc: { data: { document, snapshot: sampleSnapshot({ lineCount: 3 }) } } }).download(IDS.document, "?inline=1");
  assert.equal(inline.headers.get("Content-Disposition"), 'inline; filename="devis-DEV-100000-r2.pdf"');
  for (const [id, query] of [["bad", ""], [IDS.document, "?inline=2"], [IDS.document, "?other=1"]] as const) {
    const invalid = harness();
    assert.equal((await invalid.download(id, query)).status, 422);
    assert.equal(invalid.calls.length, 0);
  }
  assert.equal((await harness({ authenticated: false }).download(IDS.document)).status, 401);
  assert.equal((await harness({ rpc: { error: { code: "P0002" } } }).download(IDS.document)).status, 404);
  assert.equal((await harness({ rpc: { error: { code: "53300" } } }).download(IDS.document)).status, 429);
});
test("download refuses to render an inconsistent or malformed stored snapshot instead of printing wrong amounts", async () => {
  const document = { id: IDS.document, kind: "quote", reference: "DEV-100000", revision: 1, quote_id: IDS.quote, amendment_id: null, generated_at: "2026-10-31T14:05:00Z", snapshot_sha256: "ab".repeat(32) };
  const tampered = await harness({ rpc: { data: { document, snapshot: sampleSnapshot({ lineCount: 2, quote: { total_cents: 1 } }) } } }).download(IDS.document);
  assert.equal(tampered.status, 503);
  noStore(tampered);
  assert.match((await tampered.json()).error, /incohérent/);
  assert.equal((await harness({ rpc: { data: { document, snapshot: null } } }).download(IDS.document)).status, 503);
  assert.equal((await harness({ rpc: { data: { document: { id: IDS.document }, snapshot: sampleSnapshot() } } }).download(IDS.document)).status, 503);
  assert.equal((await harness({ rpc: { data: null } }).download(IDS.document)).status, 503);
});
