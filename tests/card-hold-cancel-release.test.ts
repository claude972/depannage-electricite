// FIN-04: cancelling a dossier backed by a card hold releases the authorization at the provider.
// Real module (lib/features/guest/card-hold.ts) and real route handler, provider and database faked.
import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, ApiError, fakeServerHelpers } from "./documents/harness";

const ACTOR = "10000000-0000-4000-8000-000000000001", JOB = "20000000-0000-4000-8000-000000000001", REQ = "50000000-0000-4000-8000-000000000001";
const ENV = { STRIPE_SECRET_KEY: "sk_test_abcdefgh12345678", NEXT_PUBLIC_APP_URL: "https://app.example" };
type Options = { booking?: Record<string, unknown> | null; job?: Record<string, unknown> | null; pi?: Record<string, unknown>; cancelFails?: boolean; cancelIgnored?: boolean; dbFails?: boolean; env?: Record<string, string | undefined> };
function fixture(o: Options = {}) {
  const calls: string[] = [];
  const booking = o.booking === undefined ? { actor_id: ACTOR, request_id: REQ, method: "card_hold", expected_max_cents: 18000, status: "confirmed", intervention_id: JOB, stripe_session_id: "cs_test_hold", stripe_payment_intent_id: "pi_hold", created_at: "2026-11-21T10:00:00Z" } : o.booking;
  const job = o.job === undefined ? { id: JOB, client_id: ACTOR, status: "cancelled" } : o.job;
  const pi: Record<string, unknown> = { id: "pi_hold", livemode: false, metadata: { booking_actor: ACTOR, booking_request: REQ, booking_method: "card_hold" }, capture_method: "manual", currency: "eur", amount: 18000, amount_received: 0, status: "requires_capture", ...o.pi };
  const table = (name: string) => {
    const filters: Record<string, unknown> = {};
    const q = { select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, maybeSingle: async () => { calls.push(`db:${name}`); if (o.dbFails) return { data: null, error: { code: "XX000" } }; const row = name === "phone_booking_requests" ? booking : job; return { data: row && Object.entries(filters).every(([k, v]) => (row as Record<string, unknown>)[k] === v) ? row : null, error: null }; } };
    return q;
  };
  const stripe = { paymentIntents: {
    retrieve: async (id: string) => { calls.push(`retrieve:${id}`); return { ...pi }; },
    cancel: async (id: string, _body: unknown, options: { idempotencyKey: string }) => { calls.push(`cancel:${id}:${options.idempotencyKey}`); if (o.cancelFails) throw Error("SECRET_PROVIDER_ERROR"); if (!o.cancelIgnored) pi.status = "canceled"; return { ...pi }; },
  } };
  const server = { ...fakeServerHelpers({ db: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push(`rpc:${name}:${args.p_action}`); return { data: { id: JOB, client_id: ACTOR, status: args.p_action === "cancel" ? "cancelled" : "requested" }, error: null }; } } }), adminClient: () => ({ from: table }) };
  const overrides = { "@/lib/supabase/server": server, "@/lib/supabase/stripe": { stripeClient: () => stripe }, "node:process": { env: o.env ?? ENV } };
  return { calls, overrides, pi };
}
const release = (f: ReturnType<typeof fixture>) => (loadModule("lib/features/guest/card-hold.ts", f.overrides).releaseCancelledDossierHold as (actor: string, id: string) => Promise<string>)(ACTOR, JOB);

test("release: the authorization of a cancelled dossier is cancelled once, with a stable idempotency key, and re-read", async () => {
  const f = fixture();
  assert.equal(await release(f), "released");
  assert.deepEqual(f.calls, ["db:phone_booking_requests", "db:interventions", "retrieve:pi_hold", `cancel:pi_hold:booking-dossier-release:${ACTOR}:${REQ}`, "retrieve:pi_hold"]);
  // Already cancelled at the provider (replay): confirmed without a second cancel.
  const replay = fixture({ pi: { status: "canceled" } });
  assert.equal(await release(replay), "released");
  assert.equal(replay.calls.some((c) => c.startsWith("cancel:")), false);
});
test("release: no card hold ⇒ nothing is called at the provider", async () => {
  for (const booking of [null, { actor_id: ACTOR, request_id: REQ, method: "card_hold", expected_max_cents: 18000, status: "confirmed", intervention_id: JOB, stripe_session_id: null, stripe_payment_intent_id: null, created_at: "2026-11-21T10:00:00Z" }]) {
    const f = fixture({ booking });
    assert.equal(await release(f), "none");
    assert.equal(f.calls.some((c) => c.startsWith("retrieve") || c.startsWith("cancel")), false);
  }
});
test("release: never for a dossier that is not cancelled or not the actor's; provider failures are reported, never hidden", async () => {
  for (const job of [{ id: JOB, client_id: ACTOR, status: "requested" }, { id: JOB, client_id: "10000000-0000-4000-8000-000000000002", status: "cancelled" }, null]) {
    const f = fixture({ job });
    assert.equal(await release(f), "release_failed");
    assert.equal(f.calls.some((c) => c.startsWith("retrieve") || c.startsWith("cancel")), false, "no provider call");
  }
  const cases: Options[] = [
    { cancelFails: true }, { cancelIgnored: true }, { dbFails: true }, { env: {} },
    { pi: { status: "succeeded" } }, { pi: { amount_received: 18000 } }, { pi: { capture_method: "automatic" } }, { pi: { livemode: true } },
    { pi: { metadata: { booking_actor: ACTOR, booking_request: "other", booking_method: "card_hold" } } },
  ];
  for (const o of cases) {
    const f = fixture(o);
    assert.equal(await release(f), "release_failed", JSON.stringify(o));
    if (o.pi) assert.equal(f.calls.some((c) => c.startsWith("cancel:")), false, "an unexpected object is never cancelled");
  }
});
test("route: the cancel action reports the release outcome; other actions and hold-less dossiers are unchanged", async () => {
  const ctx = { params: Promise.resolve({ id: JOB }) };
  const post = (action: string) => new Request("https://app.example/api", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" }, body: JSON.stringify({ action }) });
  const route = (f: ReturnType<typeof fixture>) => loadModule("app/api/interventions/[id]/actions/route.ts", f.overrides).POST as (r: Request, c: typeof ctx) => Promise<Response>;
  const ok = fixture();
  const done = await route(ok)(post("cancel"), ctx);
  assert.equal(done.status, 200);
  assert.equal((await done.json()).card_hold, "released");
  assert.equal(ok.calls[0], "rpc:intervention_action:cancel", "the hold is released only after the cancellation succeeded");
  const failed = await route(fixture({ cancelFails: true }))(post("cancel"), ctx);
  assert.equal(failed.status, 200, "the cancellation stays recorded");
  const body = await failed.json();
  assert.equal(body.card_hold, "release_failed");
  assert.doesNotMatch(JSON.stringify(body), /SECRET_PROVIDER_ERROR/);
  assert.equal(Object.hasOwn(await (await route(fixture({ booking: null }))(post("cancel"), ctx)).json(), "card_hold"), false);
  const start = fixture();
  assert.equal(Object.hasOwn(await (await route(start)(post("start"), ctx)).json(), "card_hold"), false);
  assert.deepEqual(start.calls, ["rpc:intervention_action:start"]);
  void ApiError;
});
