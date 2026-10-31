import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError, parseApiBody } from "../../components/app/api";
import {
  bound,
  createFeatureClients,
  createNotificationsClient,
  createPlanningClient,
  createPlatformClient,
  createQuoteDocumentsClient,
  createSiteOperationsClient,
  platformViewAllowed,
  type FeatureDeps,
  type FeatureKey,
} from "../../components/app/features";
import type { ContractState } from "../../components/app/types";
import type { PlatformAccess } from "../../lib/features/platform-operations/types";
import { isoInstant } from "../../lib/features/planning/schemas";
import { PLANNING_MAX_RANGE_DAYS } from "../../lib/features/planning/types";
import { planningProbeRange } from "../../components/app/features";

type Call = { path: string; body?: unknown; method?: string };
function harness(reply: (call: Call) => unknown) {
  let generation = 1;
  const states: [FeatureKey, ContractState][] = [];
  const calls: Call[] = [];
  const deps: FeatureDeps = {
    generation: () => generation,
    setState: (key, state) => states.push([key, state]),
    request: async <T,>(path: string, body?: unknown, method?: string) => {
      calls.push({ path, body, method });
      const value = await reply({ path, body, method });
      return value as T;
    },
  };
  return { deps, states, calls, bump: () => (generation += 1) };
}

test("bound: a reply landing after an identity change resolves null and records nothing", async () => {
  let release: (v: unknown) => void = () => {};
  const h = harness(() => new Promise((resolve) => (release = resolve)));
  const pending = bound(h.deps, "planning", () => h.deps.request!("/x"));
  h.bump();
  release({ ok: 1 });
  assert.equal(await pending, null);
  assert.deepEqual(h.states, []);
});

test("bound: a failure landing after an identity change is swallowed as null (never rendered)", async () => {
  let reject: (e: unknown) => void = () => {};
  const h = harness(() => new Promise((_, r) => (reject = r)));
  const pending = bound(h.deps, "planning", () => h.deps.request!("/x"));
  h.bump();
  reject(new ApiRequestError(403, "refus"));
  assert.equal(await pending, null);
  assert.deepEqual(h.states, []);
});

test("an old client bundle never sends a request after an identity change (nothing under the new actor's cookie)", async () => {
  const h = harness(() => Promise.resolve({ ok: 1 }));
  const before = createPlanningClient(h.deps);
  const bundle = createFeatureClients(h.deps);
  assert.deepEqual(await before.load({ from: "a", to: "b" }), { ok: 1 });
  assert.equal(h.calls.length, 1);
  h.bump(); // logout / login as B / demo switch
  assert.equal(await before.load({ from: "a", to: "b" }), null);
  assert.equal(await before.command({ action: "save_rule" } as never), null);
  assert.equal(await bundle.notifications.summary(), null);
  assert.equal(await bundle.platform.command.reconcile({ limit: 1 }), null);
  assert.equal(await bundle.quoteDocuments.load({ quoteId: "q" }), null);
  assert.equal(h.calls.length, 1, "no request was emitted by the stale bundle");
  // A bundle built for the new generation works normally.
  const after = createFeatureClients(h.deps);
  assert.deepEqual(await after.notifications.summary(), { ok: 1 });
  assert.equal(h.calls.length, 2);
});

test("bound: capability truth from the reply (success available, 404 missing, 503 unavailable, 403 present)", async () => {
  const cases: [unknown, ContractState][] = [
    [{ ok: 1 }, "available"],
    [new ApiRequestError(404, "absent"), "missing"],
    [new ApiRequestError(503, "panne"), "unavailable"],
    [new ApiRequestError(0, "réseau"), "unavailable"],
    [new ApiRequestError(403, "interdit"), "available"],
    [new ApiRequestError(409, "conflit"), "available"],
  ];
  for (const [reply, expected] of cases) {
    const h = harness(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)));
    try {
      const value = await bound(h.deps, "siteOperations", () => h.deps.request!("/x"));
      assert.deepEqual(value, reply);
    } catch (e) {
      assert.equal(e, reply, "server errors are rethrown for the leaf");
    }
    assert.deepEqual(h.states, [["siteOperations", expected]]);
  }
});

test("planning client: range query, 409 becomes a conflict result, other refusals a plain refusal, success ok", async () => {
  const h = harness(({ path, body }) => {
    if (path.startsWith("/api/planning?")) return { range: { from: "a", to: "b" } };
    const action = (body as { action: string }).action;
    if (action === "conflict") return Promise.reject(new ApiRequestError(409, "chevauchement"));
    if (action === "invalid") return Promise.reject(new ApiRequestError(422, "invalide"));
    return { replayed: false };
  });
  const client = createPlanningClient(h.deps);
  assert.deepEqual(await client.load({ from: "2026-11-01", to: "2026-11-07" }), { range: { from: "a", to: "b" } });
  assert.equal(h.calls[0].path, "/api/planning?from=2026-11-01&to=2026-11-07");
  assert.deepEqual(await client.command({ action: "conflict" } as never), { ok: false, conflict: true, message: "chevauchement" });
  assert.deepEqual(await client.command({ action: "invalid" } as never), { ok: false, conflict: false, message: "invalide" });
  assert.deepEqual(await client.command({ action: "save_rule" } as never), { ok: true, data: { replayed: false } });
  assert.equal(h.calls[3].path, "/api/planning");
});

test("notifications client: list query encodes unread/cursor, mark and preferences map refusals", async () => {
  const h = harness(({ path, body }) => {
    if (path.startsWith("/api/notifications?")) return { notifications: [], page: {}, unread_count: 0 };
    if (path === "/api/notifications/summary") return { unread_count: 2, latest_created_at: null };
    if (path === "/api/notifications/preferences" && body) return Promise.reject(new ApiRequestError(409, "version périmée"));
    if (path === "/api/notifications/preferences") return { preferences: {} };
    return { updated: 1, unread_count: 1 };
  });
  const client = createNotificationsClient(h.deps);
  await client.list({ limit: 10, cursor: "c1", unread: true });
  assert.equal(h.calls[0].path, "/api/notifications?limit=10&cursor=c1&unread=1");
  await client.list({});
  assert.equal(h.calls[1].path, "/api/notifications");
  assert.deepEqual(await client.summary(), { unread_count: 2, latest_created_at: null });
  assert.deepEqual(await client.mark({ action: "mark_read", ids: ["n1"] }), { ok: true, result: { updated: 1, unread_count: 1 } });
  assert.deepEqual(await client.savePreferences({ expected_version: 1 } as never), { ok: false, conflict: true, message: "version périmée" });
});

test("site operations client: site query and command body pass through", async () => {
  const h = harness(({ path }) => (path.startsWith("/api/site-operations?") ? { snapshot: 1 } : { action: "x", result: null }));
  const client = createSiteOperationsClient(h.deps);
  await client.load("site-1");
  assert.equal(h.calls[0].path, "/api/site-operations?site_id=site-1");
  await client.command({ action: "save_site_equipment" } as never);
  assert.deepEqual(h.calls[1], { path: "/api/site-operations", body: { action: "save_site_equipment" }, method: undefined });
});

test("quote documents client: target query, command routing by action, private href", async () => {
  const h = harness(() => ({ ok: 1 }));
  const client = createQuoteDocumentsClient(h.deps);
  await client.load({ quoteId: "q 1" });
  await client.load({ interventionId: "i1" });
  await client.command({ action: "generate" } as never);
  await client.command({ action: "set_terms" } as never);
  await client.command({ action: "propose" } as never);
  await client.command({ action: "accept" } as never);
  assert.deepEqual(
    h.calls.map((c) => c.path),
    ["/api/quote-documents?quote_id=q%201", "/api/quote-documents?intervention_id=i1", "/api/quote-documents", "/api/quote-documents", "/api/quote-amendments", "/api/quote-amendments"],
  );
  assert.equal(client.documentHref("d/1"), "/api/quote-documents/d%2F1");
  assert.equal(client.documentHref("d1", true), "/api/quote-documents/d1?inline=1");
});

test("server error details (code, missing) reach the leaf through ApiRequestError", () => {
  assert.throws(
    () => parseApiBody(409, false, JSON.stringify({ error: "Dossier incomplet", code: "issuer_incomplete", missing: ["siret", "address"] })),
    (e: unknown) => e instanceof ApiRequestError && e.status === 409 && e.code === "issuer_incomplete" && e.missing?.join() === "siret,address" && e.message === "Dossier incomplet",
  );
  assert.throws(
    () => parseApiBody(422, false, JSON.stringify({ error: "Invalide", code: 5, missing: "x" })),
    (e: unknown) => e instanceof ApiRequestError && e.code === undefined && e.missing === undefined,
  );
});

test("platform client: paths, verbs and action discriminators match the lot routes", async () => {
  const h = harness(() => ({ ok: 1 }));
  const client = createPlatformClient(h.deps);
  await client.load.me();
  await client.load.operators({ limit: 25, status: "active", cursor: null });
  await client.load.billingContact("organization", "o1");
  await client.load.invoice("inv/1");
  await client.command.grant({ user_id: "u1", scope: "finance_read", note: "n" });
  await client.command.setSetting({ key: "commission_bps", value: { bps: 0 }, expected_version: null });
  await client.command.reconcile({ limit: 50 });
  await client.command.invoiceReadiness({ basis: "service", payment_id: "p1" });
  await client.command.decideRefund("r1", { action: "approve", expected_version: 1, note: "" });
  await client.command.moderateReview("rv1", { action: "hide", expected_version: null, note: "x" });
  await client.command.contestReview("rv1", { request_id: "req", reason: "motif suffisant" });
  const expected: Call[] = [
    { path: "/api/platform-operations/me", body: undefined, method: undefined },
    { path: "/api/platform-operations/operators?limit=25&status=active", body: undefined, method: undefined },
    { path: "/api/platform-operations/billing-contacts?subject_kind=organization&subject_id=o1", body: undefined, method: undefined },
    { path: "/api/platform-operations/finance/invoices/inv%2F1", body: undefined, method: undefined },
    { path: "/api/platform-operations/operators", body: { action: "grant", user_id: "u1", scope: "finance_read", note: "n" }, method: undefined },
    { path: "/api/platform-operations/settings", body: { key: "commission_bps", value: { bps: 0 }, expected_version: null }, method: "PUT" },
    { path: "/api/platform-operations/finance", body: { action: "reconcile", limit: 50 }, method: undefined },
    { path: "/api/platform-operations/finance/invoices", body: { action: "readiness", basis: "service", payment_id: "p1" }, method: undefined },
    { path: "/api/platform-operations/finance/refund-requests/r1", body: { action: "approve", expected_version: 1, note: "" }, method: undefined },
    { path: "/api/platform-operations/reviews/rv1", body: { action: "hide", expected_version: null, note: "x" }, method: undefined },
    { path: "/api/platform-operations/reviews/rv1", body: { action: "contest", request_id: "req", reason: "motif suffisant" }, method: undefined },
  ];
  assert.deepEqual(h.calls, expected);
  // Commission rate is never a client argument: reconcile carries only the limit.
  assert.ok(!("commission_bps" in (h.calls[6].body as object)));
});

test("platform views are fail-closed on the server reply: no reply, no capability, no access", () => {
  const base: PlatformAccess = {
    super_admin: false,
    scopes: ["finance_read"],
    super_admin_count: 2,
    capabilities: { operators: false, audit: false, finance: true, reviews_moderation: false, refund_execution: false, invoice_rendering: false },
    config: {} as PlatformAccess["config"],
  };
  assert.equal(platformViewAllowed(null, "platform-finance"), false);
  assert.equal(platformViewAllowed(undefined, "platform-operators"), false);
  assert.equal(platformViewAllowed(base, "platform-finance"), true);
  assert.equal(platformViewAllowed(base, "platform-operators"), false);
  assert.equal(platformViewAllowed(base, "platform-moderation"), false);
  assert.equal(platformViewAllowed({ ...base, super_admin: true }, "platform-operators"), true);
  assert.equal(platformViewAllowed({ ...base, capabilities: undefined as never }, "platform-finance"), false);
  // A profile role never substitutes for the reply: the helper does not even look at roles.
  assert.equal(platformViewAllowed({ ...base, scopes: [], capabilities: { ...base.capabilities, finance: false } }, "platform-finance"), false);
});

test("demo clients: seeds only, every command refused with the demonstration message, no request function", async () => {
  const { createDemoFeatureClients, DEMO_COMMAND_MESSAGE } = await import("../../components/app/features");
  const demo = createDemoFeatureClients("artisan");
  assert.equal(demo.demo, true);
  const planning = await demo.planning.load({ from: "2026-11-02", to: "2026-11-08" });
  assert.ok(planning && Array.isArray(planning.rules));
  assert.deepEqual(await demo.planning.command({ action: "save_rule" } as never), { ok: false, conflict: false, message: DEMO_COMMAND_MESSAGE });
  assert.deepEqual(await demo.notifications.mark({ action: "mark_all_read" }), { ok: false, conflict: false, message: DEMO_COMMAND_MESSAGE });
  const summary = await demo.notifications.summary();
  assert.ok(summary && Number.isInteger(summary.unread_count));
  await assert.rejects(demo.quoteDocuments.command({ action: "generate" } as never), (e: unknown) => e instanceof ApiRequestError && e.message === DEMO_COMMAND_MESSAGE);
  await assert.rejects(demo.siteOperations.command({ action: "save_equipment" } as never)); // validated like the server, then refused
  await assert.rejects(demo.platform.command.reconcile({ limit: 1 }), (e: unknown) => e instanceof ApiRequestError && e.message === DEMO_COMMAND_MESSAGE);
  const me = await demo.platform.load.me();
  assert.ok(me && typeof me.super_admin === "boolean");
  const live = createDemoFeatureClients("admin");
  assert.equal(live.demo, true);
});

test("planning probe range passes the real API validation (full ISO instants with offset, 0 < span <= max days)", () => {
  // Same rule as GET /api/planning: both bounds must satisfy isoInstant and to must be after from.
  for (const now of ["2026-10-31T12:00:00Z", "2026-03-29T01:30:00Z", "2026-12-31T23:59:59Z", Date.UTC(2027, 0, 1)]) {
    const { from, to } = planningProbeRange(now);
    assert.equal(isoInstant.safeParse(from).success, true, `from ${from}`);
    assert.equal(isoInstant.safeParse(to).success, true, `to ${to}`);
    const span = Date.parse(to) - Date.parse(from);
    assert.ok(span > 0 && span <= PLANNING_MAX_RANGE_DAYS * 86400000, `span ${span}`);
    assert.equal(span, 7 * 86400000, "one week");
  }
  // A bare calendar date is exactly what the API refuses (the previous probe shape).
  assert.equal(isoInstant.safeParse("2026-10-31").success, false);
});
