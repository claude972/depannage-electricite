import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadModule, fakeServerHelpers } from "../documents/harness";
import type { Invoice } from "../../lib/features/platform-operations/types";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function invoice(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: id(1), request_id: id(2), kind: "invoice", basis: "service", number: "F2026-000001", issuer_key: "artisan:qa",
    issuer: { legal_name: "Électricien QA", siret: "12345678901234", address: "12 rue du Test", vat_number: null, legal_status: "EI" },
    recipient: { name: "Client QA", address: "4 rue des Tests", vat_number: null },
    payment_id: id(3), quote_id: id(4), intervention_id: id(5), related_invoice_id: null,
    lines: [{ label: "Diagnostic QA", quantity: 1, unit_price_cents: 10000 }], subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, currency: "eur",
    reason: "", issued_by: id(6), issued_at: "2026-10-31T12:00:00+00:00", ...patch,
  };
}
function harness(options: { authenticated?: boolean; scopes?: string[]; superAdmin?: boolean; rows?: Invoice[]; providerError?: string; scopeError?: string } = {}) {
  const calls: { path: string; query: URLSearchParams; method: string }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ path: url.pathname, query: url.searchParams, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/rpc/platform_access")) return options.scopeError
      ? Response.json({ code: options.scopeError, message: "PRIVATE PROVIDER ERROR" }, { status: 503 })
      : Response.json({ super_admin: options.superAdmin ?? false, scopes: options.scopes ?? ["finance_read"], super_admin_count: null });
    assert.ok(url.pathname.endsWith("/platform_invoices"), "only immutable invoice rows may be read");
    assert.equal(init?.method ?? "GET", "GET", "rendering never mutates the register");
    if (options.providerError) return Response.json({ code: options.providerError, message: "PRIVATE PROVIDER ERROR" }, { status: 500 });
    const requestedId = url.searchParams.get("id")?.slice(3);
    const row = (options.rows ?? [invoice()]).find((item) => item.id === requestedId);
    return Response.json(row ?? null);
  };
  const db = createClient("https://invoice.example.test", "public-test-key", { global: { fetch: mockFetch }, auth: { persistSession: false, autoRefreshToken: false } });
  const route = loadModule("app/api/platform-operations/finance/invoices/[id]/pdf/route.ts", {
    "@/lib/supabase/server": fakeServerHelpers({ authenticated: options.authenticated, db }),
  }) as { GET: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
  return {
    calls,
    get: (suffix = "", requestedId = id(1)) => route.GET(new Request(`https://app.example.test/api/platform-operations/finance/invoices/${requestedId}/pdf${suffix}`), { params: Promise.resolve({ id: requestedId }) }),
  };
}

test("private PDF authenticates and requires current finance_read before any invoice read", async () => {
  for (const options of [{ authenticated: false }, { scopes: [] }, { scopes: ["reviews_moderate"] }, { scopes: ["finance_write"] }]) {
    const h = harness(options);
    const response = await h.get();
    assert.equal(response.status, options.authenticated === false ? 401 : 403);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(!h.calls.some((call) => call.path.endsWith("/platform_invoices")));
  }
  const admin = harness({ superAdmin: true, scopes: [] });
  assert.equal((await admin.get()).status, 200);
});

test("rendered response uses immutable rows, safe attachment name and explicit private PDF headers", async () => {
  const h = harness();
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="facture-F2026-000001.pdf"');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(Number(response.headers.get("Content-Length")), bytes.length);
  assert.ok(bytes.toString("latin1").startsWith("%PDF-1.4"));
  assert.deepEqual(h.calls.map((call) => call.path.split("/").at(-1)), ["platform_access", "platform_invoices"]);
  assert.equal((await harness().get("?inline=1")).headers.get("Content-Disposition"), 'inline; filename="facture-F2026-000001.pdf"');
});

test("malformed IDs, duplicate/unknown parameters and missing/RLS-hidden invoices are refused", async () => {
  assert.equal((await harness().get("", "not-a-uuid")).status, 404);
  for (const query of ["?inline=0", "?inline=1&inline=1", "?download=1", "?inline=1&other=1"]) {
    const h = harness();
    assert.equal((await h.get(query)).status, 422);
    assert.ok(!h.calls.some((call) => call.path.endsWith("/platform_invoices")));
  }
  assert.equal((await harness({ rows: [] }).get()).status, 404);
});

test("credit note PDF resolves and prints its exact linked immutable invoice", async () => {
  const parent = invoice({ id: id(7) });
  const credit = invoice({ kind: "credit_note", number: "A2026-000001", related_invoice_id: parent.id, reason: "Réduction partielle QA", lines: [{ label: "Avoir QA", quantity: 1, unit_price_cents: 2 }], subtotal_cents: 2, tax_cents: 1, total_cents: 3 });
  const h = harness({ rows: [credit, parent] });
  const response = await h.get();
  assert.equal(response.status, 200);
  const text = Buffer.from(await response.arrayBuffer()).toString("latin1");
  assert.ok(text.includes("AVOIR"));
  assert.ok(text.includes("F2026-000001"));
  assert.equal(h.calls.filter((call) => call.path.endsWith("/platform_invoices")).length, 2);
});

test("wrong, hidden or inconsistent linked invoices and corrupt stored amounts fail explicitly", async () => {
  const parent = invoice({ id: id(7) });
  const credit = invoice({ kind: "credit_note", number: "A2026-000001", related_invoice_id: parent.id, reason: "Réduction partielle QA" });
  for (const rows of [
    [credit], [credit, { ...parent, kind: "credit_note" as const }], [credit, { ...parent, payment_id: id(99) }],
    [credit, { ...parent, tax_cents: 1 }], [invoice({ total_cents: 12001 })], [invoice({ issuer: { address: "" } })],
    [invoice({ related_invoice_id: parent.id })],
  ]) {
    const response = await harness({ rows }).get();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(!(await response.text()).includes("PRIVATE PROVIDER"));
  }
});

test("provider failure and revoked finance scope produce private errors without PDF or internal details", async () => {
  for (const options of [{ providerError: "42501" }, { providerError: "XX000" }, { scopeError: "XX000" }]) {
    const response = await harness(options).get();
    assert.equal(response.status, options.providerError === "42501" ? 403 : 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(!response.headers.get("Content-Type")?.includes("pdf"));
    assert.ok(!(await response.text()).includes("PRIVATE PROVIDER"));
  }
});
