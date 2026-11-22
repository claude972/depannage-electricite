// Card verify/cancel single flight + context checks (they bypass run(ctx)). Deferred promises.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardAction } from "../../components/app/card-return";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function ctx() {
  const state = { gen: 1, uid: "u1" as string | null };
  return { state, context: { generation: () => state.gen, userId: () => state.uid } };
}

test("verify + cancel in the same tick: the second is refused before any call", async () => {
  const flight = { current: false };
  const { context } = ctx();
  const d = deferred<string>();
  let cancelCalled = false;
  const verify = cardAction(flight, context, async () => d.promise);
  const cancel = await cardAction(flight, context, async () => { cancelCalled = true; return "cancelled"; });
  assert.equal(cancel, false);
  assert.equal(cancelCalled, false);
  d.resolve("ok");
  assert.equal(await verify, "ok");
  assert.equal(flight.current, false, "released");
});

test("finalize confirmed → refresh suspended → identity B installed → refresh resolves ⇒ nothing applied", async () => {
  const flight = { current: false };
  const { state, context } = ctx();
  const provider = deferred<void>();
  const refresh = deferred<void>();
  const applied: string[] = [];
  const run = cardAction(flight, context, async (still) => {
    await provider.promise;
    if (!still()) return false;
    applied.push("cardReturn cleared");
    await refresh.promise; // suspended
    if (!still()) return false; // re-checked AFTER refresh
    applied.push("draft cleared", "navigate job A");
    return true;
  });
  provider.resolve();
  await new Promise((r) => setTimeout(r, 0));
  state.gen += 1; // identity reset (clearSessionState bumps the guard)
  state.uid = "u2"; // B adopted, B's draft installed
  refresh.resolve();
  assert.equal(await run, false);
  assert.deepEqual(applied, ["cardReturn cleared"], "B's draft never cleared, no navigation to A's job");
});

test("sign-out then sign-in as the SAME UID during the call ⇒ generation changed ⇒ ignored", async () => {
  const flight = { current: false };
  const { state, context } = ctx();
  const d = deferred<void>();
  const run = cardAction(flight, context, async (still) => { await d.promise; return still(); });
  state.gen += 2; // SIGNED_OUT then SIGNED_IN (same uid)
  d.resolve();
  assert.equal(await run, false);
});

test("503 then retry: the flight is released (also after a throw), the retry runs", async () => {
  const flight = { current: false };
  const { context } = ctx();
  await assert.rejects(cardAction(flight, context, async () => { throw new Error("503"); }));
  assert.equal(flight.current, false);
  assert.equal(await cardAction(flight, context, async () => "201"), "201");
  assert.equal(await cardAction(flight, { generation: () => 1, userId: () => null }, async () => "x"), false, "no identity ⇒ nothing");
});

test("controller: verify/cancel go through cardAction; still() checked after the provider call AND after refresh", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const verify = src.slice(src.indexOf("async function verifyCardHoldReturn("), src.indexOf("async function checkPendingCardHold("));
  assert.match(verify, /return cardAction\(cardFlight, cardContext, async \(still, me\) => \{/);
  const afterRefresh = verify.slice(verify.indexOf("await refresh();"));
  assert.ok(afterRefresh.indexOf("if (!still()) return false;") < afterRefresh.indexOf("setPendingDraft(null);"));
  assert.ok(afterRefresh.indexOf("if (!still()) return false;") < afterRefresh.indexOf('navigate("detail"'));
  const cancel = src.slice(src.indexOf("async function cancelBooking("), src.indexOf("async function createIntervention("));
  assert.match(cancel, /return cardAction\(cardFlight, cardContext, async \(still, me\) => \{/);
  assert.ok(cancel.indexOf("if (!still()) return false;") < cancel.indexOf("setBooking(rest)"));
  assert.match(src, /const cardContext = \{ generation: \(\) => guard\.generation\(\), userId: \(\) => userId\.current \};/);
});
