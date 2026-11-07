import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkspace } from "../components/app/workspace-reader";
import { workspaceLimitsSchema } from "../lib/features/workspace/detail-read";
import { routeHarness, job, quote, site, org, id, USER } from "./detail-read-fixtures";

test("real workspace route: each list distinguishes N<L, N=L and N=L+1; extra rows are not returned or used for appointments", async () => {
  for (const delta of [-1, 0, 1]) {
    const interventions = Array.from({ length: 100 + delta }, (_, i) => job({ id: id(1000 + i) }));
    const quotes = Array.from({ length: 200 + delta }, (_, i) => quote(i));
    const sites = Array.from({ length: 100 + delta }, (_, i) => ({ ...site, id: id(2000 + i) }));
    const organizations = Array.from({ length: 50 + delta }, (_, i) => ({ ...org, id: id(3000 + i) }));
    const h = routeHarness("workspace", { rows: { interventions, quotes, sites, organizations } });
    const r = await h.get(); assert.equal(r.status, 200); const body = await r.json();
    for (const [key, limit] of Object.entries({ interventions: 100, quotes: 200, sites: 100, organizations: 50 })) {
      assert.equal(body[key].length, Math.min(limit + delta, limit));
      assert.equal(body.limits[key].limit, limit); assert.equal(body.limits[key].limited, delta > 0);
    }
    assert.equal(validateWorkspace(body).ok, true);
    assert.equal(workspaceLimitsSchema.safeParse(body.limits).success, true);
    const ids = h.calls.find(c => c.table === "intervention_appointments")!.url.searchParams.get("intervention_id")!;
    assert.equal(ids.slice(4, -1).split(",").length, Math.min(100 + delta, 100));
    if (delta === 1) assert.ok(!ids.includes(String(interventions[100].id)));
    const oldShape = structuredClone(body); delete oldShape.limits; assert.equal(validateWorkspace(oldShape).ok, true);
  }
});

test("runtime limits decoder is strict while the legacy workspace validator still accepts the old envelope", () => {
  const good = { interventions: { limit: 100, limited: false }, quotes: { limit: 200, limited: true }, sites: { limit: 100, limited: false }, organizations: { limit: 50, limited: false } };
  for (const candidate of [null, {}, { ...good, interventions: { limit: 100, limited: "true" } }, { ...good, sites: { limit: 101, limited: true } }, { ...good, extra: true }])
    assert.equal(workspaceLimitsSchema.safeParse(candidate).success, false);
});

test("an unusable watched collection never produces a false not-limited workspace", async () => {
  for (const table of ["interventions", "quotes", "sites", "organizations"]) {
    const h = routeHarness("workspace", { intercept: c => c.table === table ? Response.json([{}]) : undefined });
    const response = await h.get(); assert.equal(response.status, 503, table);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Retry-After"), "2");
    assert.ok((await response.json()).error);
  }
});

test("offered artisan missions do not affect the readable dossier limit flag or leak their private data", async () => {
  const offers = [{ id: id(9000), status: "requested", category: "panel", city: "Test", postal_code: "972**", urgency: "scheduled", estimate_min_cents: 1000, estimate_max_cents: 2000, created_at: "2026-10-31T10:00:00Z" }];
  const h = routeHarness("workspace", { offers, rows: { profiles: [{ id: USER, role: "artisan", full_name: "Test", phone: "", artisan_approved: true, created_at: "2026-10-31T10:00:00Z" }], interventions: Array.from({ length: 100 }, (_, i) => job({ id: id(1000 + i) })) } });
  const body = await (await h.get()).json(); assert.equal(body.interventions.length, 101); assert.equal(body.limits.interventions.limited, false);
  const offer = body.interventions.find((r: { id: string }) => r.id === offers[0].id); assert.equal(offer.address, undefined); assert.equal(offer.client_id, undefined);
});

test("workspace counters come from the exact private scope, and an unavailable counter leaves the workspace usable", async () => {
  const counters = { active_interventions: 137, received_messages: 502 };
  const h = routeHarness("workspace", { intercept: call => call.table === "client_workspace_counters" ? Response.json(counters) : undefined });
  const response = await h.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.client_counts, counters);
  assert.equal(validateWorkspace(body).ok, true);
  for (const invalid of [null, { ...counters, received_messages: "502" }, { ...counters, user_id: USER }]) {
    assert.equal(validateWorkspace({ ...body, client_counts: invalid }).ok, false);
  }
  assert.equal(validateWorkspace({ ...body, profile: { ...body.profile, role: "manager" } }).ok, false);
  const unavailable = routeHarness("workspace", {
    intercept: call => call.table === "client_workspace_counters" ? Response.json({ code: "PGRST202" }, { status: 404 }) : undefined,
  });
  const result = await unavailable.get();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).client_counts, undefined);
});
