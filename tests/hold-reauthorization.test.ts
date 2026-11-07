import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, ApiError, fakeServerHelpers } from "./documents/harness";
const A = "10000000-0000-4000-8000-000000000001",
  J = "20000000-0000-4000-8000-000000000001",
  I = "30000000-0000-4000-8000-000000000001",
  Q = "40000000-0000-4000-8000-000000000001",
  R = "50000000-0000-4000-8000-000000000001";
type Options = {
  pause?: (op: string) => Promise<void>;
  configured?: boolean;
  auth?: boolean;
  old?: boolean;
  lostCreate?: boolean;
  lostCancel?: boolean;
  revoked?: string;
  badNew?: Record<string, any>;
  badOld?: Record<string, any>;
  badCharge?: Record<string, any>;
  badSession?: Record<string, any>;
  transfers?: any;
  list?: any;
  account?: boolean;
};
function fixture(o: Options = {}) {
  const calls: any[] = [];
  let session: any = null,
    authorized = false,
    oldCanceled = false,
    newCanceled = false,
    lostCreate = o.lostCreate,
    lostCancel = o.lostCancel;
  const source = {
    actor_id: A,
    intervention_id: J,
    quote_id: Q,
    artisan_id: Q,
    request_id: R,
    account_id: "acct_QA",
    amount_cents: 22000,
    authorized_max: 18000,
    session_id: "cs_test_old",
    intent_id: "pi_old",
    job_status: "completed",
    amendments: [],
    reason: "quote_exceeds_hold",
  };
  let a: any = null;
  const fail = (code: string) => ({ error: { code }, data: null });
  const db = {
    rpc: async (name: string, p: any) => {
      calls.push({ op: name, p });
      if (o.revoked === name) return fail("P0002");
      if (name === "hold_reauthorization_source")
        return {
          data: {
            source,
            snapshot_id: "a".repeat(64),
            ledger: null,
            attempt: a,
          },
          error: null,
        };
      if (name === "begin_hold_reauthorization") {
        a ??= {
          id: I,
          intervention_id: J,
          actor_id: A,
          snapshot_id: "a".repeat(64),
          snapshot: { ...source },
          old_ledger_id: null,
          old_intent: "pi_old",
          old_session: "cs_test_old",
          old_max: 18000,
          account_id: "acct_QA",
          fee_bps: -1,
          fee_cents: -1,
          return_origin: "",
          session_id: null,
          intent_id: null,
          old_released: false,
          status: "opening",
          created_at: new Date(
            Date.now() - (o.old ? 25 * 3600000 : 0),
          ).toISOString(),
          updated_at: new Date().toISOString(),
        };
        return { data: I, error: null };
      }
      if (name === "hold_reauthorization_private")
        return { data: structuredClone(a), error: null };
      if (name === "qualify_hold_reauthorization")
        Object.assign(a, {
          fee_bps: 2000,
          fee_cents: 4400,
          return_origin: "https://preview.example.test",
        });
      if (name === "authorize_hold_reauthorization") {
        if (
          p.p_action === "abort" &&
          ["old_release_pending", "ready_for_capture"].includes(a.status)
        )
          return fail("P0001");
        if (
          p.p_action === "release_old" &&
          !["new_authorized", "old_release_pending"].includes(a.status)
        )
          return fail("P0001");
        if (p.p_action === "open" && a.status !== "opening")
          return fail("P0001");
        if (p.p_action === "abort") a.status = "aborting";
        if (p.p_action === "release_old") a.status = "old_release_pending";
      }
      if (name === "bind_hold_reauthorization") {
        if (
          ![
            "opening",
            "awaiting_authorization",
            "new_authorized",
            "aborting",
          ].includes(a.status)
        )
          return fail("P0001");
        Object.assign(a, {
          session_id: p.p_session,
          intent_id: p.p_intent ?? a.intent_id,
          status:
            a.status === "aborting"
              ? "aborting"
              : p.p_authorized
                ? "new_authorized"
                : "awaiting_authorization",
        });
      }
      if (name === "record_hold_release") {
        if (p.p_abort) a.status = "aborted";
        else a.old_released = true;
      }
      if (name === "record_hold_session_expired") a.status = "aborted";
      if (name === "adopt_hold_reauthorization") {
        if (!a.old_released) return fail("P0001");
        a.status = "ready_for_capture";
      }
      if (name === "review_hold_reauthorization") a.status = "needs_review";
      return { data: null, error: null };
    },
  };
  const tags = (isNew: boolean) => ({
    booking_actor: A,
    booking_request: R,
    booking_method: "card_hold",
    ...(isNew ? { hold_reauthorization_id: I } : {}),
  });
  const stripe: any = {
    checkout: {
      sessions: {
        create: async (body: any, key: any) => {
          calls.push({ op: "create", body, key });
          session ??= {
            object: "checkout.session",
            id: "cs_test_new",
            mode: "payment",
            livemode: false,
            client_reference_id: R,
            metadata: tags(true),
            currency: "eur",
            amount_total: 22000,
            status: "open",
            payment_intent: null,
            url: "https://checkout.stripe.com/c/pay/test_QA#fidkdWxOYH%2FM2F8",
            ...o.badSession,
          };
          if (lostCreate) {
            lostCreate = false;
            throw Error("SECRET_PROVIDER_ERROR");
          }
          const reply = { ...session };
          await o.pause?.("create");
          return reply;
        },
        retrieve: async () => {
          calls.push({ op: "session-read" });
          return { ...session };
        },
        list: async () => {
          calls.push({ op: "session-list" });
          return (
            o.list ?? {
              object: "list",
              has_more: false,
              data: session ? [{ ...session }] : [],
            }
          );
        },
        expire: async (id: string, _body: any, key: any) => {
          calls.push({ op: "expire", id, key });
          session.status = "expired";
          return { ...session };
        },
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => {
        const isNew = id === "pi_new",
          canceled = isNew ? newCanceled : oldCanceled;
        calls.push({ op: "intent-read", id });
        return {
          id,
          livemode: false,
          capture_method: "manual",
          currency: "eur",
          metadata: tags(isNew),
          latest_charge: isNew ? "ch_new" : "ch_old",
          status: canceled ? "canceled" : "requires_capture",
          amount: isNew ? 22000 : 18000,
          amount_received: 0,
          amount_capturable: canceled ? 0 : isNew ? 22000 : 18000,
          ...(isNew ? o.badNew : o.badOld),
        };
      },
      cancel: async (id: string, _body: any, key: any) => {
        calls.push({ op: "cancel", id, key });
        if (id === "pi_old") oldCanceled = true;
        else newCanceled = true;
        if (lostCancel) {
          lostCancel = false;
          throw Error("SECRET_PROVIDER_ERROR");
        }
        await o.pause?.("cancel");
        return {};
      },
    },
    charges: {
      retrieve: async (id: string) => {
        const isNew = id === "ch_new";
        return {
          id,
          payment_intent: isNew ? "pi_new" : "pi_old",
          livemode: false,
          currency: "eur",
          amount: isNew ? 22000 : 18000,
          metadata: tags(isNew),
          amount_captured: 0,
          amount_refunded: 0,
          status: "succeeded",
          captured: false,
          refunded: false,
          disputed: false,
          paid: true,
          payment_method_details: {
            card: { capture_before: Math.floor(Date.now() / 1000) + 3600 },
          },
          ...o.badCharge,
        };
      },
    },
    transfers: {
      list: async () =>
        o.transfers ?? { object: "list", has_more: false, data: [] },
    },
    v2: {
      core: {
        accounts: {
          retrieve: async () => ({
            id: "acct_QA",
            livemode: false,
            metadata: { artisan_id: Q },
            configuration: {
              recipient: {
                capabilities: {
                  stripe_balance: {
                    stripe_transfers: {
                      status: o.account === false ? "inactive" : "active",
                    },
                  },
                },
              },
            },
          }),
        },
      },
    },
  };
  const helpers = fakeServerHelpers({ db, authenticated: o.auth });
  const m = loadModule("app/api/bookings/settlement/reauthorization/route.ts", {
    "@/lib/supabase/server": {
      ...helpers,
      adminClient: () => db,
      authenticatedClient: async () => {
        if (o.auth === false) throw new ApiError(401, "Session requise");
        return { db, user: { id: A } };
      },
    },
    "@/lib/features/guest/payment-options": {
      cardHoldConfigured: () => o.configured !== false,
    },
    "@/lib/supabase/stripe": {
      appUrl: () => "https://preview.example.test",
      stripeClient: () => stripe,
      commissionBps: () => 2000,
    },
    "node:process": {
      env: {
        STRIPE_SECRET_KEY: "sk_test_SYNTHETIC",
        PLATFORM_FEE_BPS: "2000",
        GUEST_SETTLEMENT_ENABLED: "true",
      },
    },
  });
  const request = (
    action = "begin",
    extra: any = {},
    origin = "https://preview.example.test",
  ) =>
    (m.POST as any)(
      new Request("https://preview.example.test/reauthorization", {
        method: "POST",
        headers: { origin },
        body: JSON.stringify({
          action,
          intervention_id: J,
          ...(action === "begin"
            ? { command_id: I, snapshot_id: "a".repeat(64), consent: true }
            : { attempt_id: I }),
          ...extra,
        }),
      }),
    );
  const get = (q = `?intervention_id=${J}`) =>
    (m.GET as any)(
      new Request("https://preview.example.test/reauthorization" + q),
    );
  return {
    request,
    get,
    calls,
    o,
    source,
    attempt: () => a,
    authorize: () => {
      authorized = true;
      session.status = "complete";
      session.payment_intent = "pi_new";
    },
    session: () => session,
    seed: async () => {
      await db.rpc("begin_hold_reauthorization", {});
      await db.rpc("qualify_hold_reauthorization", {});
    },
  };
}
async function dto(r: Response, status: number) {
  assert.equal(r.status, status, await r.clone().text());
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  const text = await r.text();
  assert.doesNotMatch(text, /pi_old|pi_new|acct_QA|ch_old|SECRET/);
  return JSON.parse(text);
}
test("nominal: consent -> exact manual Checkout -> independent new proof -> old cancellation -> adoption, never capture", async () => {
  const f = fixture();
  const opened = await dto(await f.request(), 200);
  assert.equal(opened.url, "https://checkout.stripe.com/c/pay/test_QA#fidkdWxOYH%2FM2F8");
  assert.equal(
    f.calls.some((c) => c.op === "cancel"),
    false,
  );
  const create = f.calls.find((c) => c.op === "create");
  assert.equal(create.body.line_items[0].price_data.unit_amount, 22000);
  assert.equal(create.body.payment_intent_data.capture_method, "manual");
  assert.equal(create.body.payment_intent_data.transfer_data, undefined);
  assert.equal(create.key.idempotencyKey, `hold-replacement:${I}`);
  f.authorize();
  assert.equal((await dto(await f.get(), 200)).status, "new_authorized");
  const result = await dto(await f.request("resume"), 202);
  assert.equal(result.status, "ready_for_capture");
  assert.deepEqual(
    f.calls.filter((c) => c.op === "cancel").map((c) => c.id),
    ["pi_old"],
  );
  await dto(await f.request("abort"), 409);
  assert.equal(f.calls.filter((c) => c.op === "cancel").length, 1);
});
test("GET and reload never create, cancel or mutate; configuration absence never prepares an attempt", async () => {
  const f = fixture({ configured: false });
  const r = await dto(await f.get(), 200);
  assert.equal(r.reason, "configuration_required");
  assert.equal(r.available, false);
  await dto(await f.request(), 503);
  assert.equal(
    f.calls.some((c) => c.op === "begin_hold_reauthorization"),
    false,
  );
  assert.equal(
    f.calls.every((c) => c.op === "hold_reauthorization_source"),
    true,
  );
});
test("strict body, query, auth and Origin checks reject before provider", async () => {
  for (const extra of [
    { consent: false },
    { amount: 1 },
    { destination: "acct_BAD" },
    { snapshot_id: "bad" },
  ]) {
    const f = fixture();
    await dto(await f.request("begin", extra), 422);
    assert.equal(f.calls.length, 0);
  }
  await dto(await fixture().request("begin", {}, "https://evil.example"), 403);
  await dto(await fixture({ auth: false }).get(), 401);
  await dto(
    await fixture().get(`?intervention_id=${J}&intervention_id=${J}`),
    422,
  );
});
test("lost create retries identical Checkout key and parameters without releasing old hold", async () => {
  const f = fixture({ lostCreate: true });
  await dto(await f.request(), 503);
  await dto(await f.request(), 200);
  const creates = f.calls.filter((c) => c.op === "create");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].body, creates[1].body);
  assert.deepEqual(creates[0].key, creates[1].key);
  assert.equal(
    f.calls.some((c) => c.op === "cancel"),
    false,
  );
});
test("lost old cancellation response resumes by GET canceled, no second cancel", async () => {
  const f = fixture({ lostCancel: true });
  await f.request();
  f.authorize();
  await dto(await f.request("resume"), 503);
  assert.equal(f.attempt().status, "old_release_pending");
  await dto(await f.request("resume"), 202);
  assert.equal(f.calls.filter((c) => c.op === "cancel").length, 1);
  assert.equal(f.attempt().status, "ready_for_capture");
});
test("abort authorized replacement cancels only new binding, preserves old hold", async () => {
  const f = fixture();
  await f.request();
  f.authorize();
  await dto(await f.request("abort"), 202);
  assert.equal(f.attempt().status, "aborted");
  assert.deepEqual(
    f.calls.filter((c) => c.op === "cancel").map((c) => c.id),
    ["pi_new"],
  );
  assert.equal(f.attempt().old_released, false);
});
test("abort open Checkout expires and independently reads it, never assumes browser cancellation", async () => {
  const f = fixture();
  await f.request();
  await dto(await f.request("abort"), 202);
  assert.equal(f.attempt().status, "aborted");
  assert.equal(
    f.calls.find((c) => c.op === "expire").key.idempotencyKey,
    `hold-expire:${I}`,
  );
  assert.equal(
    f.calls.some((c) => c.op === "cancel"),
    false,
  );
});
test("unknown creation abort recovers by bounded listing, never creates another session", async () => {
  const f = fixture({ lostCreate: true });
  await f.request();
  await dto(await f.request("abort"), 202);
  assert.equal(f.calls.filter((c) => c.op === "create").length, 1);
  assert.equal(
    f.calls.some((c) => c.op === "session-list"),
    true,
  );
});
test("after key window no new Checkout creation; missing/partial recovery remains blocked", async () => {
  for (const list of [
    undefined,
    { object: "list", data: [], has_more: true },
  ]) {
    const f = fixture({ old: true, list });
    await f.seed();
    await dto(await f.request("resume"), list ? 503 : 409);
    assert.equal(
      f.calls.some((c) => c.op === "create"),
      false,
    );
  }
});
test("revocation after bank reads blocks old cancellation/adoption and hides fresh URL", async () => {
  const f = fixture();
  await f.request();
  f.authorize();
  f.o.revoked = "authorize_hold_reauthorization";
  await dto(await f.request("resume"), 404);
  assert.equal(
    f.calls.some((c) => c.op === "cancel"),
    false,
  );
  const g = fixture();
  g.o.revoked = "hold_reauthorization_source";
  await dto(await g.request(), 404);
});
test("captured old intent, invalid new amount/metadata/freshness, transfer evidence never adopt", async () => {
  const old = fixture({ badOld: { amount_received: 1 } });
  await dto(await old.request(), 409);
  assert.equal(
    old.calls.some((c) => c.op === "create"),
    false,
  );
  for (const opts of [
    { badNew: { amount_received: 1 } },
    { badNew: { amount: 21999 } },
    { badNew: { metadata: {} } },
    { badCharge: { payment_method_details: { card: { capture_before: 1 } } } },
    {
      transfers: {
        object: "list",
        has_more: false,
        data: [{ id: "tr_QA", source_transaction: "ch_old" }],
      },
    },
  ]) {
    const f = fixture(opts);
    await f.request();
    f.authorize();
    const r = await f.request("resume");
    assert.ok([409, 503].includes(r.status));
    assert.notEqual(f.attempt().status, "ready_for_capture");
  }
});
test("unqualified recipient cannot open a replacement", async () => {
  const f = fixture({ account: false });
  await dto(await f.request(), 409);
  assert.equal(
    f.calls.some((c) => c.op === "create"),
    false,
  );
});

function gate() {
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (entered = r));
  return {
    release,
    seen,
    pause: async () => {
      entered();
      await wait;
    },
  };
}
test("concurrent abort during lost/inflight creation: late open reply cannot restore URL or reopen closed attempt", async () => {
  const g = gate(),
    f = fixture({
      pause: (op) => (op === "create" ? g.pause() : Promise.resolve()),
    });
  const opening = f.request();
  await g.seen;
  await dto(await f.request("abort"), 202);
  g.release();
  await dto(await opening, 409);
  assert.equal(f.attempt().status, "aborted");
  assert.equal(f.calls.filter((c) => c.op === "create").length, 1);
  assert.equal(
    f.calls.some((c) => c.op === "cancel"),
    false,
  );
});
test("concurrent abort cannot race old cancellation; adopted replacement is not canceled", async () => {
  const g = gate(),
    f = fixture();
  await f.request();
  f.authorize();
  f.o.pause = (op) => (op === "cancel" ? g.pause() : Promise.resolve());
  const resume = f.request("resume");
  await g.seen;
  await dto(await f.request("abort"), 409);
  g.release();
  await dto(await resume, 202);
  assert.deepEqual(
    f.calls.filter((c) => c.op === "cancel").map((c) => c.id),
    ["pi_old"],
  );
});
test("GET rejects unknown/unsafe projection instead of claiming eligible", async () => {
  const f = fixture();
  f.source.authorized_max = NaN;
  await dto(await f.get(), 503);
  const g = fixture();
  await g.seed();
  g.attempt().status = "invented";
  await dto(await g.get(), 503);
});
