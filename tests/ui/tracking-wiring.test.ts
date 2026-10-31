import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError, parseApiBody } from "../../components/app/api";
import {
  createDemoFeatureClients,
  createFeatureClients,
  createTrackingClient,
  reprobe,
  trackingStateFromError,
  type FeatureDeps,
  type FeatureKey,
} from "../../components/app/features";
import { trackingDemo } from "../../components/app/tracking-demo";
import { failureOf } from "../../components/features/tracking/model";
import type { ContractState } from "../../components/app/types";

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
      return (await reply({ path, body, method })) as T;
    },
  };
  return { deps, states, calls, bump: () => (generation += 1) };
}
const thrown = (status: number, text: string) => {
  try {
    parseApiBody(status, false, text);
  } catch (e) {
    return e as ApiRequestError;
  }
  throw new Error("expected a refusal");
};
const ID = "11111111-1111-4111-8111-111111111111";

test("parseApiBody carries reason, bounded retry_after_s and the JSON flag; failureOf reads them", () => {
  const e = thrown(503, JSON.stringify({ error: "Indisponible.", reason: "provider_quota", retry_after_s: 99999 }));
  assert.equal(e.status, 503);
  assert.equal(e.reason, "provider_quota");
  assert.equal(e.retry_after_s, 3600);
  assert.equal(e.json, true);
  assert.deepEqual(failureOf(e), { status: 503, message: "Indisponible.", reason: "provider_quota", retryAfterS: 3600 });
  const html = thrown(404, "<html>Not found</html>");
  assert.equal(html.json, undefined);
  assert.equal(html.reason, undefined);
  assert.equal(thrown(429, JSON.stringify({ error: "x", retry_after_s: "5" })).retry_after_s, undefined);
});

test("trackingStateFromError: JSON 404 and reasoned 503 prove the contract; framework 404/bare 503/network do not", () => {
  const s = (status: number, text: string) => trackingStateFromError(thrown(status, text));
  assert.equal(s(404, JSON.stringify({ error: "Ce suivi est introuvable." })), "available");
  assert.equal(s(404, "<html></html>"), "missing");
  assert.equal(s(405, ""), "missing");
  assert.equal(s(503, JSON.stringify({ error: "x", reason: "route_unavailable" })), "available");
  assert.equal(s(503, JSON.stringify({ error: "Le suivi n’a pas été confirmé." })), "unavailable");
  assert.equal(trackingStateFromError(new ApiRequestError(0, "réseau")), "unavailable");
  assert.equal(s(409, JSON.stringify({ error: "changé", reason: "stale_version" })), "available");
  assert.equal(s(403, JSON.stringify({ error: "refusé" })), "available");
});

test("tracking client: exact paths, methods and bodies; capability recorded", async () => {
  const h = harness(() => ({}));
  const c = createTrackingClient(h.deps, ID);
  await c.load();
  await c.command({ expected_version: 3, action: "stop", payload: { session_id: ID } });
  await c.route();
  await c.geocode("12 rue Victor Hugo");
  assert.deepEqual(h.calls, [
    { path: `/api/interventions/${ID}/tracking`, body: undefined, method: undefined },
    { path: `/api/interventions/${ID}/tracking`, body: { expected_version: 3, action: "stop", payload: { session_id: ID } }, method: undefined },
    { path: `/api/interventions/${ID}/tracking/route`, body: {}, method: undefined },
    { path: `/api/interventions/${ID}/tracking/geocode`, body: { query: "12 rue Victor Hugo" }, method: undefined },
  ]);
  assert.ok(h.states.every(([k, v]) => k === "tracking" && v === "available"));
});

test("tracking client: a framework 404 marks missing; a JSON 404 stays present and is rethrown", async () => {
  const framework = harness(() => Promise.reject(thrown(404, "<html/>")));
  await assert.rejects(createTrackingClient(framework.deps, ID).load());
  assert.deepEqual(framework.states, [["tracking", "missing"]]);
  const rls = harness(() => Promise.reject(thrown(404, JSON.stringify({ error: "Ce suivi est introuvable." }))));
  await assert.rejects(createTrackingClient(rls.deps, ID).load(), (e: unknown) => (e as ApiRequestError).status === 404);
  assert.deepEqual(rls.states, [["tracking", "available"]]);
});

test("tracking client from a bundle of an old identity sends nothing and resolves null", async () => {
  const h = harness(() => ({}));
  const bundle = createFeatureClients(h.deps);
  const client = bundle.tracking(ID);
  h.bump();
  assert.equal(await client.load(), null);
  assert.equal(await bundle.tracking(ID).command({ expected_version: 1, action: "arrived", payload: { session_id: ID } }), null);
  assert.equal(h.calls.length, 0);
});

test("reprobe tracking reads the dossier snapshot only with an intervention hint", async () => {
  const h = harness(() => ({}));
  const bundle = createFeatureClients(h.deps);
  const states: [FeatureKey, ContractState][] = [];
  const ctx = {
    bundle,
    alive: () => true,
    setState: (k: FeatureKey, s: ContractState) => states.push([k, s]),
    setUnread: () => {},
    setAccess: () => {},
  };
  await reprobe("tracking", undefined, ctx);
  assert.equal(h.calls.length, 0);
  await reprobe("tracking", { interventionId: ID }, ctx);
  assert.deepEqual(h.calls.map((c) => c.path), [`/api/interventions/${ID}/tracking`]);
});

test("demo tracking: no network, every call refused; seed carries no route and no artisan position", async () => {
  const demo = createDemoFeatureClients("client").tracking(ID);
  for (const call of [() => demo.load(), () => demo.route(), () => demo.geocode("ab")])
    await assert.rejects(call(), (e: unknown) => (e as ApiRequestError).status === 403);
  const now = Date.parse("2026-10-31T12:00:00Z");
  const viewer = trackingDemo(ID, "client", now);
  assert.equal(viewer.tracking.intervention_id, ID);
  assert.equal(viewer.tracking.position_state, "fresh");
  assert.ok(now - Date.parse(viewer.tracking.position!.sampled_at) < 60_000);
  assert.equal("route" in viewer, false);
  const artisan = trackingDemo(ID, "artisan", now);
  assert.equal(artisan.tracking.shared, false);
  assert.equal(artisan.tracking.position, null);
  assert.equal(artisan.permissions.can_share, true);
  assert.equal(trackingDemo(ID, "admin", now).permissions.can_confirm_destination, false);
});
