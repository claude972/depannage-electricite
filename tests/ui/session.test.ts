import test from "node:test";
import assert from "node:assert/strict";
import {
  artisanMissions,
  artisanPerformance,
  buildHash,
  canAccess,
  enterpriseContext,
  homeFor,
  parseHash,
  parseReturnParams,
  pickQuote,
  quoteVersions,
} from "../../components/app/session";
import type { Intervention, Payment, Quote, Review } from "../../components/app/types";

test("role guard: hash views outside the role are refused, demo role grants nothing in live", () => {
  assert.equal(canAccess("sites", "manager", "live"), true);
  assert.equal(canAccess("sites", "client", "live"), false);
  assert.equal(canAccess("admin", "manager", "demo"), false);
  assert.equal(canAccess("admin", "admin", "live"), true);
  assert.equal(canAccess("missions", "client", "demo"), false);
  assert.equal(canAccess("missions", "artisan", "demo"), true);
  // Admin assistance uses the capability-gated operator queue, not customer support.
  assert.equal(canAccess("support", "admin", "live"), false);
  assert.equal(canAccess("support", "client", "live"), true);
  assert.equal(canAccess("support-queue", "admin", "live"), true);
  // No session: only public views.
  assert.equal(canAccess("overview", null, "public"), false);
  assert.equal(canAccess("home", null, "public"), true);
  assert.equal(canAccess("help", "artisan", "live"), true);
  // A live user whose role is client cannot open the artisan dossier even if a demo role was chosen earlier.
  assert.equal(canAccess("application", "client", "live"), false);
});

test("advanced lot views: role gate only, platform views stay admin, planning stays artisan", () => {
  assert.equal(canAccess("planning", "artisan", "live"), true);
  assert.equal(canAccess("planning", "client", "live"), false);
  assert.equal(canAccess("planning", "manager", "demo"), false);
  for (const role of ["client", "artisan", "manager", "admin"] as const) {
    assert.equal(canAccess("notifications", role, "live"), true);
    assert.equal(canAccess("quote-documents", role, "live"), true);
  }
  assert.equal(canAccess("notifications", null, "public"), false);
  assert.equal(canAccess("site-operations", "manager", "live"), true);
  assert.equal(canAccess("site-operations", "client", "live"), false);
  assert.equal(canAccess("site-operations", "admin", "live"), false);
  // Back-office views: the role gate admits any signed-in role (a limited operator keeps a
  // client/manager profile); the server /me reply decides, fail-closed (tests in features.test.ts).
  // A5: the assistance queue follows the same rule (server capability decides, role gate open).
  for (const role of ["client", "artisan", "manager", "admin"] as const) assert.equal(canAccess("support-queue", role, "live"), true);
  assert.equal(canAccess("support-queue", null, "public"), false);
  for (const view of ["platform-operators", "platform-finance", "platform-moderation"] as const) {
    assert.equal(canAccess(view, "admin", "live"), true);
    assert.equal(canAccess(view, "manager", "live"), true);
    assert.equal(canAccess(view, "client", "live"), true);
    assert.equal(canAccess(view, null, "public"), false);
  }
});
test("home view depends on role and mode", () => {
  assert.equal(homeFor(null, "public"), "home");
  assert.equal(homeFor("admin", "live"), "admin");
  assert.equal(homeFor("artisan", "demo"), "overview");
});
test("hash parsing tolerates malformed input without throwing", () => {
  assert.deepEqual(parseHash("#detail/abc-123"), { view: "detail", param: "abc-123" });
  assert.deepEqual(parseHash("#/sites"), { view: "sites", param: "" });
  assert.deepEqual(parseHash("#unknown-view/1"), { view: null, param: "" });
  assert.deepEqual(parseHash("#detail/%E0%A4%A"), { view: "detail", param: "" });
  assert.deepEqual(parseHash("#detail/%3Cscript%3E"), { view: "detail", param: "" });
  assert.deepEqual(parseHash(""), { view: null, param: "" });
  assert.equal(buildHash("detail", "x y"), "detail/x%20y");
});
test("return parameters are hints only and never carry a success state", () => {
  assert.deepEqual(parseReturnParams("?payment=pending&intervention=abc"), {
    kind: "payment",
    state: "pending",
    interventionId: "abc",
  });
  assert.deepEqual(parseReturnParams("?payment=paid&intervention=abc"), null);
  assert.deepEqual(parseReturnParams("?connect=returned"), { kind: "connect", state: "returned" });
  assert.deepEqual(parseReturnParams("?auth=expired"), { kind: "auth", state: "expired" });
  assert.equal(parseReturnParams(""), null);
});
const quotes: Quote[] = [
  { id: "q1", intervention_id: "i1", lines: [], subtotal_cents: 100, tax_cents: 20, total_cents: 120, tax_rate: 20, status: "rejected", created_at: "2026-10-01T10:00:00Z" },
  { id: "q2", intervention_id: "i1", lines: [], subtotal_cents: 200, tax_cents: 40, total_cents: 240, tax_rate: 20, status: "sent", created_at: "2026-10-02T10:00:00Z" },
  { id: "q3", intervention_id: "i2", lines: [], subtotal_cents: 300, tax_cents: 60, total_cents: 360, tax_rate: 20, status: "accepted", created_at: "2026-10-03T10:00:00Z" },
];
test("historical quote selection opens the exact version, default is the active one", () => {
  assert.equal(pickQuote(quotes, "i1")?.id, "q2");
  assert.equal(pickQuote(quotes, "i1", "q1")?.id, "q1");
  assert.equal(pickQuote(quotes, "i1", "q3"), undefined, "a foreign quote id is never returned");
  assert.deepEqual(quoteVersions(quotes, "i1").map((q) => q.id), ["q1", "q2"]);
});
const interventions: Intervention[] = [
  { id: "i1", category: "panel", description: "", address: "a", postal_code: "97200", city: "FDF", urgency: "urgent", status: "quoted", created_at: "2026-10-02T09:00:00Z", estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: "art" },
  { id: "i2", category: "socket", description: "", address: "b", postal_code: "97200", city: "FDF", urgency: "scheduled", status: "paid", created_at: "2026-10-03T09:00:00Z", estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: "art" },
  { id: "i3", category: "lighting", description: "", address: "c", postal_code: "97200", city: "FDF", urgency: "scheduled", status: "requested", created_at: "2026-10-04T09:00:00Z", estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: null },
  { id: "i4", category: "lighting", description: "", address: "d", postal_code: "97200", city: "FDF", urgency: "scheduled", status: "paid", created_at: "2026-10-04T09:00:00Z", estimate_min_cents: 1, estimate_max_cents: 2, artisan_id: "other" },
];
test("artisan missions are scoped to the artisan; offers are the unassigned requests", () => {
  const m = artisanMissions(interventions, "art");
  assert.deepEqual(m.active.map((i) => i.id), ["i1"]);
  assert.deepEqual(m.done.map((i) => i.id), ["i2"]);
  assert.deepEqual(m.offers.map((i) => i.id), ["i3"]);
});
test("performance uses only paid payments of the artisan's quotes in the current month and real reviews", () => {
  const payments: Payment[] = [
    { id: "p3", quote_id: "q3", total_cents: 360, currency: "eur", status: "paid", created_at: "2026-10-03T10:00:00Z", paid_at: "2026-10-05T10:00:00Z" },
    { id: "p2", quote_id: "q2", total_cents: 240, currency: "eur", status: "pending", created_at: "2026-10-03T10:00:00Z" },
    { id: "pX", quote_id: "foreign", total_cents: 9999, currency: "eur", status: "paid", created_at: "2026-10-03T10:00:00Z", paid_at: "2026-10-05T10:00:00Z" },
  ];
  const reviews: Review[] = [
    { id: "r1", intervention_id: "i2", rating: 4, body: "" },
    { id: "r2", intervention_id: "i4", rating: 1, body: "" },
  ];
  const perf = artisanPerformance(interventions, quotes, payments, reviews, "art", new Date("2026-10-20T12:00:00Z"));
  assert.equal(perf.monthRevenueCents, 360);
  assert.equal(perf.monthPaidCount, 1);
  assert.deepEqual(perf.rating, { average: 4, count: 1 });
  assert.equal(perf.onTimeRate, null, "punctuality has no measurable source");
  const other = artisanPerformance(interventions, quotes, payments, reviews, "art", new Date("2026-11-20T12:00:00Z"));
  assert.equal(other.monthRevenueCents, 0);
});
test("enterprise context never picks organizations[0] implicitly when several exist", () => {
  const orgs = [{ id: "o1" }, { id: "o2" }];
  const sites = [
    { id: "s1", organization_id: "o1" },
    { id: "s2", organization_id: "o2" },
  ];
  const jobs = [{ site_id: "s1" }, { site_id: "s2" }, { site_id: null }];
  const none = enterpriseContext(orgs, sites, jobs, "", "");
  assert.equal(none.needsChoice, true);
  assert.equal(none.organizationId, "");
  const chosen = enterpriseContext(orgs, sites, jobs, "o2", "");
  assert.deepEqual(chosen.sites.map((s) => s.id), ["s2"]);
  assert.deepEqual(chosen.interventions, [{ site_id: "s2" }]);
  const stale = enterpriseContext(orgs, sites, jobs, "o2", "s1");
  assert.equal(stale.siteId, "", "a site of another organisation is dropped");
  const single = enterpriseContext([{ id: "o1" }], sites, jobs, "", "s1");
  assert.equal(single.organizationId, "o1");
  assert.deepEqual(single.interventions, [{ site_id: "s1" }]);
});
test("demo deep link and public views stay reachable without a session; join/demo params are plain identifiers", () => {
  assert.equal(canAccess("demo", null, "public"), true);
  assert.deepEqual(parseHash("#demo/artisan-missions"), { view: "demo", param: "artisan-missions" });
  assert.deepEqual(parseHash("#demo/artisan/extra"), { view: "demo", param: "" }, "slashes are not identifiers");
});
test("a reloaded workspace drops an organisation or site the server no longer returns", async () => {
  const { validateContext } = await import("../../components/app/session");
  const orgs = [{ id: "o1" }];
  const sites = [{ id: "s1" }];
  assert.deepEqual(validateContext(orgs, sites, "o1", "s1"), { organizationId: "o1", siteId: "s1", organizationDropped: false });
  assert.deepEqual(validateContext(orgs, sites, "o2", "s1"), { organizationId: "", siteId: "", organizationDropped: true });
  assert.deepEqual(validateContext(orgs, sites, "o1", "s9"), { organizationId: "o1", siteId: "", organizationDropped: false });
  assert.deepEqual(validateContext([], [], "", ""), { organizationId: "", siteId: "", organizationDropped: false });
});

test("public mode: a direct #new link opens the public request form; private views stay closed", () => {
  assert.equal(canAccess("new", null, "public"), true);
  assert.equal(canAccess("requests", null, "public"), false);
  assert.equal(canAccess("detail", null, "public"), false);
  assert.equal(canAccess("new", null, "demo"), false, "no role outside public mode ⇒ closed");
  assert.equal(canAccess("new", "artisan", "live"), false, "artisans still cannot create requests");
  assert.equal(canAccess("new", "client", "live"), true);
});
