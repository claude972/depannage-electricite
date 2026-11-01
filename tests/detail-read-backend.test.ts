import test from "node:test";
import assert from "node:assert/strict";
import { DETAIL_PROJECTIONS, detailReadSchema } from "../lib/features/workspace/detail-read";
import { routeHarness, job, quote, payment, site, org, JOB, USER, ARTISAN, SITE, ORG, id, stamp } from "./detail-read-fixtures";
const noStore = (r: Response) => assert.equal(r.headers.get("Cache-Control"), "private, no-store");

test("real GET route reads the requested old dossier and related records by id, with closed projections", async () => {
  const q = quote(1);
  const h = routeHarness("detail", { rows: { interventions: [job({ site_id: SITE })], sites: [site], organizations: [org], quotes: [q], payments: [payment(String(q.id))] } });
  const r = await h.get(); assert.equal(r.status, 200); noStore(r);
  const body = await r.json(); assert.equal(detailReadSchema.safeParse(body).success, true);
  assert.equal(body.site.value.id, SITE); assert.equal(body.organization.value.id, ORG);
  assert.equal(body.payments.items.length, 1); assert.equal(body.payments.incomplete, false);
  assert.ok(!JSON.stringify(body).includes("session_id"));
  for (const c of h.calls) {
    const key = c.table === "interventions" ? "intervention" : c.table === "sites" ? "site" : c.table === "organizations" ? "organization" : c.table === "intervention_appointments" ? "appointments" : c.table;
    assert.equal(c.projection, c.table === "quotes" && c.projection === "id" ? "id" : DETAIL_PROJECTIONS[key as keyof typeof DETAIL_PROJECTIONS]);
    assert.ok(c.url.searchParams.has("id") || c.url.searchParams.has("intervention_id") || c.url.searchParams.has("quote_id"));
  }
});

test("client-owned requested dossier without an artisan remains readable; RLS-refused offers or foreign jobs are identical 404", async () => {
  const own = await routeHarness("detail", { rows: { interventions: [job({ artisan_id: null, status: "requested" })] } }).get();
  assert.equal(own.status, 200); const b = await own.json(); assert.equal(b.intervention.artisan_id, null);
  const hidden = routeHarness("detail", { readable: false }); const missing = routeHarness("detail", { rows: { interventions: [] } });
  const rs = await Promise.all([hidden.get(), missing.get(), missing.get("not-a-uuid")]);
  const bodies = await Promise.all(rs.map(r => { assert.equal(r.status, 404); noStore(r); return r.text(); }));
  assert.equal(new Set(bodies).size, 1); assert.equal(hidden.calls.length, 1, "no dependency probe when RLS returns no dossier");
  assert.equal(hidden.calls.some(c => c.table === "available_missions"), false);
});

test("UUID spelling is normalized before comparing the requested dossier identity", async () => {
  const mixed = "abcdef00-0000-4000-8000-000000000001";
  const h = routeHarness("detail", { rows: { interventions: [job({ id: mixed })] } });
  assert.equal((await h.get(mixed.toUpperCase())).status, 200);
});

test("401 is checked before id validation; DB states, transport and malformed primary rows are 503 with retry/no-store", async () => {
  const anon = routeHarness("detail", { authenticated: false }); const r = await anon.get("invalid");
  assert.equal(r.status, 401); noStore(r); assert.equal(anon.calls.length, 0);
  for (const mode of ["42501", "P0002", "transport", "malformed", "extra", "wrong-id", "null", "duplicate"]) {
    const h = routeHarness("detail", { intercept: c => {
      if (c.table !== "interventions") return;
      if (mode === "transport") throw new TypeError("private transport detail");
      if (["42501", "P0002"].includes(mode)) return Response.json({ code: mode, message: "private SQL detail" }, { status: 500 });
      if (mode === "null") return Response.json(null);
      if (mode === "duplicate") return Response.json([job(), job()]);
      return Response.json([mode === "malformed" ? { id: JOB } : mode === "extra" ? job({ private_secret: "never" }) : job({ id: id(999) })]);
    } });
    const result = await h.get(); assert.equal(result.status, 503, mode); noStore(result); assert.equal(result.headers.get("Retry-After"), "2");
    assert.ok(!JSON.stringify(await result.json()).includes("private"));
  }
});

test("none, hidden and error remain distinct, and an inaccessible site never triggers organization discovery", async () => {
  const none = await (await routeHarness("detail").get()).json(); assert.equal(none.site.status, "none"); assert.equal(none.organization.status, "none");
  const hidden = routeHarness("detail", { rows: { interventions: [job({ site_id: SITE })] } });
  const b = await (await hidden.get()).json(); assert.equal(b.site.status, "hidden"); assert.equal(b.organization.status, "hidden"); assert.equal(hidden.calls.filter(c => c.table === "organizations").length, 0);
  for (const mode of ["error", "malformed", "transport", "null"]) {
    const h = routeHarness("detail", { rows: { interventions: [job({ site_id: SITE })] }, intercept: c => {
      if (c.table !== "sites") return;
      if (mode === "transport") throw Error("failed");
      if (mode === "null") return Response.json(null);
      return mode === "error" ? Response.json({ code: "42501" }, { status: 500 }) : Response.json([{ ...site, organization_id: "bad" }]);
    } });
    const response = await h.get(); assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.site.status, "error"); assert.equal(body.organization.status, "error"); assert.equal(h.calls.filter(c => c.table === "organizations").length, 0);
  }
});

test("payment on quote outside the displayed20 is present; 201 quote scope declares incomplete; unavailable count is error", async () => {
  for (const n of [20, 21, 200, 201]) {
    const quotes = Array.from({ length: n }, (_, i) => quote(i));
    const h = routeHarness("detail", { rows: { quotes, payments: [payment(String(quotes[n > 200 ? n - 1 : 0].id))] } });
    const body = await (await h.get()).json(); assert.equal(body.quotes.items.length, 20);
    assert.equal(body.quotes.limited, n > 20); assert.equal(body.payments.items.length, 1);
    assert.equal(body.payments.incomplete, n > 200);
    assert.ok(h.calls.find(c => c.table === "quotes" && c.projection === "id")!.headers.get("Prefer")?.includes("count=exact"));
  }
  for (const mode of ["no-count", "error", "malformed", "short-page"]) {
    const h = routeHarness("detail", { intercept: c => {
      if (c.table !== "quotes" || c.projection !== "id") return;
      if (mode === "error") return Response.json({ code: "X" }, { status: 503 });
      if (mode === "malformed") return Response.json([{ id: "invalid" }], { headers: { "Content-Range": "0-0/1" } });
      return Response.json([], { headers: mode === "short-page" ? { "Content-Range": "*/21" } : {} });
    } });
    const body = await (await h.get()).json(); assert.equal(body.payments.status, "error", mode);
    assert.equal(h.calls.filter(c => c.table === "payments").length, 0);
  }
});

test("child L+1 flags and wrong-parent/malformed dependencies never become empty success", async () => {
  for (const n of [0, 199, 200, 201]) {
    const messages = Array.from({ length: n }, (_, i) => ({ id: id(1000 + i), intervention_id: JOB, author_id: USER, body: `Message ${i}`, created_at: stamp }));
    const body = await (await routeHarness("detail", { rows: { messages } }).get()).json();
    assert.equal(body.messages.items.length, Math.min(n, 200)); assert.equal(body.messages.limited, n > 200);
  }
  const h = routeHarness("detail", { intercept: c => c.table === "messages" ? Response.json([{ id: id(900), intervention_id: id(999), author_id: USER, body: "wrong dossier", created_at: stamp }]) : undefined });
  const body = await (await h.get()).json(); assert.equal(body.messages.status, "error");
  const changed = structuredClone(body); changed.extra = "not allowed"; assert.equal(detailReadSchema.safeParse(changed).success, false);
});

test("document metadata and payments are bounded independently, with no Storage path or payment session exposed", async () => {
  const quotes = Array.from({ length: 21 }, (_, i) => quote(i));
  const payments = quotes.map((q, i) => payment(String(q.id), i));
  const documents = Array.from({ length: 51 }, (_, i) => ({ id: id(6000 + i), intervention_id: JOB, owner_id: USER, name: `Photo ${i}`, mime_type: "image/jpeg", created_at: stamp, path: "private-storage-object" }));
  const body = await (await routeHarness("detail", { rows: { quotes, payments, documents } }).get()).json();
  assert.equal(body.documents.items.length, 50); assert.equal(body.documents.limited, true);
  assert.equal(body.payments.items.length, 20); assert.equal(body.payments.limited, true); assert.equal(body.payments.incomplete, false);
  assert.ok(!JSON.stringify(body).includes("private-storage-object")); assert.ok(!JSON.stringify(body).includes("server-only-never-return"));
  const wrongPayment = routeHarness("detail", { rows: { quotes: [quote(1)] }, intercept: c => c.table === "payments" ? Response.json([{ ...payment(id(9999)), session_id: undefined }]) : undefined });
  assert.equal((await (await wrongPayment.get()).json()).payments.status, "error");
});

test("final user-scoped read discards an in-flight revoked or reassigned dossier instead of exposing stale detail", async () => {
  for (const mode of ["revoked", "reassigned", "db-error"]) {
    const h = routeHarness("detail", { intercept: (c, ordinal) => {
      if (c.table !== "interventions" || ordinal !== 2) return;
      return mode === "revoked" ? Response.json([]) : mode === "db-error" ? Response.json({ code: "X" }, { status: 500 }) : Response.json([job({ artisan_id: id(999) })]);
    } });
    const r = await h.get(); assert.equal(r.status, mode === "revoked" ? 404 : 503); noStore(r);
    assert.ok(!(await r.text()).includes("Un tableau en panne"));
  }
});


test("stored SQL-valid quote lines project known fields and normalize exact bounded numeric strings", async () => {
  for (const quantity of [JSON.parse("2.0"), "2.0", "2e0", "+.2e1", " 002.000 "]) {
    const h = routeHarness("detail", { rows: { quotes: [quote(1, { lines: [{ label: "Diagnostic", quantity, unit_price_cents: "1000.0", internal_extra: { private: "never expose" } }] })] } });
    const response = await h.get(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.quotes.status, "ok");
    assert.deepEqual(body.quotes.items[0].lines, [{ label: "Diagnostic", quantity: 2, unit_price_cents: 1000 }]);
    assert.ok(!JSON.stringify(body).includes("internal_extra"));
    assert.equal(detailReadSchema.safeParse(body).success, true);
  }
  for (const field of ["quantity", "unit_price_cents"]) {
    const invalid = [null, true, false, "", "Infinity", "NaN", "2.1", "2.0000000000000000001", "1e999", {}, [], field === "quantity" ? 1001 : 10000001, field === "quantity" ? 0 : -1];
    for (const value of invalid) {
      const line = { label: "Diagnostic", quantity: 2, unit_price_cents: 1000, [field]: value };
      const body = await (await routeHarness("detail", { rows: { quotes: [quote(1, { lines: [line] })] } }).get()).json();
      assert.equal(body.quotes.status, "error", `${field}=${JSON.stringify(value)}`);
    }
  }
});


test("detail and workspace preserve payment provenance without exposing provider references", async () => {
  for (const mode of ["detail", "workspace"] as const) {
    const q = quote(1);
    const cash = { ...payment(q.id as string), method: "on_site_declared" };
    const h = routeHarness(mode, { rows: { quotes: [q], payments: [cash] } });
    const response = await h.get();
    assert.equal(response.status, 200);
    const body = await response.json();
    const rows = mode === "detail" ? body.payments.items : body.payments;
    assert.equal(rows[0].method, "on_site_declared");
    assert.equal(JSON.stringify(body).includes("server-only-never-return"), false);
    if (mode === "detail") assert.equal(detailReadSchema.safeParse(body).success, true);
  }
});
