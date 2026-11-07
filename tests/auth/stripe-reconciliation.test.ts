import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "../documents/harness";
const ID = "evt_FINQA",
  U = "10000000-0000-4000-8000-000000000001",
  KEY = "20000000-0000-4000-8000-000000000001";
function event(type = "transfer.created", account?: string) {
  return {
    id: ID,
    object: "event",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    ...(account ? { account } : {}),
    data: {
      object: {
        id: "tr_QA",
        object: "transfer",
        amount: 9600,
        currency: "eur",
        source_transaction: "ch_QA",
        destination: "acct_QA",
        amount_reversed: 0,
        reversed: false,
        livemode: false,
        metadata: { quote_id: U },
      },
    },
  };
}
function webhook(
  badSignature = false,
  error: string | null = null,
  ack: any = { event_id: ID, version: 1, replayed: false },
) {
  const calls: any[] = [];
  const m = loadModule("app/api/payments/webhook/route.ts", {
    "node:process": {
      env: {
        STRIPE_WEBHOOK_SECRET: "FAKE_LOCAL_ONLY",
        STRIPE_SECRET_KEY: "sk_test_FAKE",
      },
    },
    "@/lib/supabase/server": {
      ...fakeServerHelpers({ db: {} }),
      adminClient: () => ({
        rpc: async (name: string, args: any) => {
          calls.push({ name, args });
          return { data: ack, error: error ? { code: error } : null };
        },
      }),
    },
    "@/lib/supabase/stripe": {
      stripeClient: () => ({
        webhooks: {
          constructEvent: (body: string) => {
            if (badSignature) throw Error("invalid");
            return JSON.parse(body);
          },
        },
      }),
    },
  });
  return {
    calls,
    post: (e: any = event(), signature = "LOCAL_ONLY") =>
      (m.POST as any)(
        new Request("https://qa.invalid/api/payments/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: JSON.stringify(e),
        }),
      ),
  };
}
test("real signed webhook records transfer proof only, never payment mutation or metadata binding", async () => {
  const f = webhook();
  const r = await f.post();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["ingest_stripe_financial_observation"],
  );
  const p = f.calls[0].args;
  assert.equal(p.p_event.source_account, null);
  assert.equal(p.p_event.object.source_charge, "ch_QA");
  assert.equal(p.p_event.object.destination, "acct_QA");
  assert.equal(p.p_event.object.metadata, undefined);
  assert.match(p.p_fingerprint, /^[a-f0-9]{64}$/);
});
test("invalid signature, missing signature, mode mismatch and malformed proof cannot write", async () => {
  const bad = webhook(true);
  assert.equal((await bad.post()).status, 400);
  assert.equal(bad.calls.length, 0);
  assert.equal((await webhook().post(event(), "")).status, 400);
  for (const e of [
    { ...event(), livemode: true },
    { ...event(), created: Infinity },
    {
      ...event(),
      data: { object: { ...event().data.object, amount_reversed: 10000 } },
    },
    {
      ...event(),
      data: { object: { ...event().data.object, object: "payout" } },
    },
  ]) {
    const f = webhook();
    assert.equal((await f.post(e)).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
test("connected transfer context is preserved for review; other connected payment paths stay refused", async () => {
  const f = webhook();
  assert.equal(
    (await f.post(event("transfer.created", "acct_QA"))).status,
    200,
  );
  assert.equal(f.calls[0].args.p_event.source_account, "acct_QA");
  const q = webhook();
  assert.equal(
    (await q.post(event("checkout.session.completed", "acct_QA"))).status,
    400,
  );
  assert.equal(q.calls.length, 0);
});
test("payout contains no bank destination, no dossier inference, and keeps source account", async () => {
  const e = {
    ...event("payout.paid", "acct_QA"),
    data: {
      object: {
        id: "po_QA",
        object: "payout",
        livemode: false,
        amount: 9600,
        currency: "eur",
        status: "paid",
        destination: "ba_PRIVATE",
        metadata: { quote_id: U },
      },
    },
  };
  const f = webhook();
  assert.equal((await f.post(e)).status, 200);
  const p = f.calls[0].args.p_event;
  assert.equal(p.family, "payout");
  assert.equal(p.object.destination, null);
  assert.equal(p.object.source_charge, null);
  assert.equal(JSON.stringify(p).includes("PRIVATE"), false);
});
test("fees and disputes are recorded as their own observations", async () => {
  for (const [type, object, id, family] of [
    ["application_fee.created", "application_fee", "fee_QA", "fee"],
    ["charge.dispute.created", "dispute", "dp_QA", "dispute"],
  ]) {
    const f = webhook();
    assert.equal(
      (
        await f.post({
          ...event(type),
          data: {
            object: {
              id,
              object,
              livemode: false,
              amount: 1200,
              currency: "eur",
              charge: "ch_QA",
              status: object === "dispute" ? "needs_response" : undefined,
            },
          },
        })
      ).status,
      200,
    );
    assert.equal(f.calls[0].args.p_event.family, family);
  }
});
test("SQL persistence failures and unconfirmed acknowledgments are not swallowed", async () => {
  assert.equal((await webhook(false, "unknown").post()).status, 503);
  assert.equal((await webhook(false, "P0001").post()).status, 409);
  assert.equal(
    (
      await webhook(false, null, {
        event_id: "evt_OTHER",
        version: 1,
        replayed: false,
      }).post()
    ).status,
    503,
  );
});
const result = {
  state: "needs_review",
  reason: "unlinked_transfer",
  settlement_id: null,
  intervention_id: null,
  quote_id: null,
};
const normal = {
  id: ID,
  type: "transfer.created",
  family: "transfer",
  livemode: false,
  source_account: null,
  created: "2026-11-07T12:00:00Z",
  object: {
    id: "tr_QA",
    amount: 9600,
    currency: "eur",
    source_charge: "ch_QA",
    destination: "acct_QA",
    amount_reversed: 0,
    reversed: false,
    status: null,
  },
};
const record = {
  event: normal,
  result,
  version: 1,
  received_at: "2026-11-07T12:00:00Z",
};
function api(data: unknown, error: unknown = null, list = false) {
  const calls: any[] = [];
  const m = loadModule(
    list
      ? "app/api/platform-operations/stripe-observations/route.ts"
      : "app/api/platform-operations/stripe-observations/[id]/route.ts",
    {
      "@/lib/supabase/server": fakeServerHelpers({
        db: {
          rpc: async (name: string, args: unknown) => {
            calls.push({ name, args });
            return { data, error };
          },
        },
      }),
    },
  );
  const c = { params: Promise.resolve({ id: ID }) };
  return {
    calls,
    get: (query = "") =>
      (m.GET as any)(new Request("https://qa.invalid/path" + query), c),
    post: (
      body: any = {
        command_id: KEY,
        expected_version: 1,
        note: "Vérification QA",
      },
      origin = "https://qa.invalid",
    ) =>
      (m.POST as any)(
        new Request("https://qa.invalid/path", {
          method: "POST",
          headers: { origin },
          body: JSON.stringify(body),
        }),
        c,
      ),
  };
}
test("operator routes enforce exact review command and receipt without forcing association", async () => {
  const f = api({ event_id: ID, version: 2, result, replayed: false });
  assert.equal((await f.post()).status, 200);
  assert.equal(f.calls[0].name, "review_stripe_financial_observation");
  assert.equal(
    (
      await f.post({
        command_id: KEY,
        expected_version: 1,
        note: "QA",
        intervention_id: U,
      })
    ).status,
    422,
  );
  assert.equal(
    (await api({ event_id: ID, version: 3, result, replayed: false }).post())
      .status,
    503,
  );
});
test("finance denial, wrong origin, private projection and list cursor are checked", async () => {
  assert.equal((await api(null, { code: "42501" }).get()).status, 403);
  assert.equal(
    (await api(null).post(undefined, "https://evil.invalid")).status,
    403,
  );
  assert.equal(
    (await api({ record, history: [], history_limited: false }).get()).status,
    200,
  );
  assert.equal(
    (
      await api({
        record: { ...record, customer_email: "private" },
        history: [],
        history_limited: false,
      }).get()
    ).status,
    503,
  );
  assert.equal(
    (await api({ records: [record], next_after: null }, null, true).get())
      .status,
    200,
  );
  assert.equal(
    (
      await api(
        { records: [record, record], next_after: null },
        null,
        true,
      ).get()
    ).status,
    503,
  );
  assert.equal((await api(null, null, true).get("?state=paid")).status, 422);
});
