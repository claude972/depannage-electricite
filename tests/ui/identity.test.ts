import test from "node:test";
import assert from "node:assert/strict";
import { createGuard, createRunner } from "../../components/app/guard";
import { adoptIdentity, type IdentityDeps } from "../../components/app/identity";
import type { View } from "../../components/app/types";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
// Mirrors the controller: userId ref, clearSessionState bumps + resets, listener adoption,
// refresh gated so that interleavings can be driven explicitly.
function controllerLike() {
  const guard = createGuard();
  const state = {
    busy: false,
    error: "",
    notice: "",
    userId: null as string | null,
    sdkUser: null as string | null,
    views: [] as View[],
    refreshes: [] as (string | null)[],
    clears: 0,
  };
  const runner = createRunner(guard, {
    setBusy: (v) => void (state.busy = v),
    setError: (m) => void (state.error = m),
    setNotice: (m) => void (state.notice = m),
  });
  const clearSessionState = () => {
    state.clears += 1;
    guard.bump();
    runner.reset();
    state.userId = null;
  };
  // What the auth listener does on SIGNED_IN for another user.
  const listenerSignedIn = (id: string) => {
    state.sdkUser = id;
    if (id !== state.userId) {
      clearSessionState();
      state.userId = id;
      state.refreshes.push(id);
    }
  };
  const refreshGate = deferred<void>();
  const refreshStarted = deferred<void>();
  const deps: IdentityDeps = {
    currentUserId: async () => state.sdkUser,
    loadedUserId: () => state.userId,
    clearSessionState,
    setUserId: (id) => void (state.userId = id),
    refresh: async () => {
      state.refreshes.push(state.userId);
      refreshStarted.resolve();
      await refreshGate.promise;
    },
    navigate: (v) => void state.views.push(v),
    setPendingDraft: () => {},
    homeView: () => "overview",
  };
  return { guard, runner, state, deps, refreshGate, refreshStarted, clearSessionState, listenerSignedIn };
}
const login = (userId: string) => ({ userId });

test("promise before event: the chain clears the anonymous state, adopts A and navigates", async () => {
  const h = controllerLike();
  const chain = h.runner.run(async (ctx) => {
    h.state.sdkUser = "A"; // SDK holds A once signInWithPassword resolved
    const outcome = await adoptIdentity(ctx, login("A").userId, null, h.deps);
    assert.equal(outcome, "adopted");
  });
  h.refreshGate.resolve();
  assert.equal(await chain, true);
  assert.equal(h.state.clears, 1);
  assert.equal(h.state.userId, "A");
  assert.deepEqual(h.state.views, ["overview"]);
  // A late SIGNED_IN for the same user is a no-op in the listener.
  h.listenerSignedIn("A");
  assert.equal(h.state.clears, 1);
});
test("event before promise: the listener already adopted A; the chain does not clear again and still navigates", async () => {
  const h = controllerLike();
  const chain = h.runner.run(async (ctx) => {
    h.listenerSignedIn("A"); // SIGNED_IN fired during signInWithPassword, before it resolved
    const outcome = await adoptIdentity(ctx, "A", null, h.deps);
    assert.equal(outcome, "adopted");
  });
  h.refreshGate.resolve();
  assert.equal(await chain, true, "own legitimate login is not rejected");
  assert.equal(h.state.clears, 1, "no second reset of the freshly loaded A");
  assert.equal(h.state.userId, "A");
  assert.deepEqual(h.state.views, ["overview"]);
  assert.equal(h.state.busy, false);
});
test("delayed login A resolving after B took over the browser is superseded: B is untouched", async () => {
  const h = controllerLike();
  const chain = h.runner.run(async (ctx) => {
    h.listenerSignedIn("A");
    h.listenerSignedIn("B"); // another tab / later login replaced A before A's promise resolved
    const outcome = await adoptIdentity(ctx, "A", null, h.deps);
    assert.equal(outcome, "superseded");
  });
  h.refreshGate.resolve();
  await chain;
  assert.equal(h.state.userId, "B", "B stays the loaded identity");
  assert.equal(h.state.clears, 2, "no extra reset caused by A's late completion");
  assert.deepEqual(h.state.views, [], "no navigation on behalf of A");
  assert.deepEqual(h.state.refreshes, ["A", "B"], "no workspace load attributed to A after B");
});
test("SIGNED_IN B arriving while A's verification is awaited (stale reply says A) never resets B", async () => {
  const h = controllerLike();
  h.deps.currentUserId = async () => {
    // The verification request was issued while A was current; B signs in before it returns.
    h.listenerSignedIn("B");
    return "A"; // stale reply
  };
  const chain = h.runner.run(async (ctx) => {
    h.listenerSignedIn("A");
    const outcome = await adoptIdentity(ctx, "A", null, h.deps);
    assert.equal(outcome, "superseded");
  });
  h.refreshGate.resolve();
  await chain;
  assert.equal(h.state.userId, "B");
  assert.equal(h.state.clears, 2, "no reset of B by A's late attempt");
  assert.deepEqual(h.state.views, []);
  assert.deepEqual(h.state.refreshes, ["A", "B"]);
});
test("logout during verification (SDK user null) supersedes the attempt", async () => {
  const h = controllerLike();
  h.deps.currentUserId = async () => {
    h.clearSessionState();
    h.state.sdkUser = null;
    return null;
  };
  const chain = h.runner.run(async (ctx) => {
    const outcome = await adoptIdentity(ctx, "A", null, h.deps);
    assert.equal(outcome, "superseded");
  });
  await chain;
  assert.equal(h.state.userId, null);
  assert.deepEqual(h.state.views, []);
});
test("logout during the login refresh drops navigation and late effects", async () => {
  const h = controllerLike();
  const chain = h.runner.run(async (ctx) => {
    h.state.sdkUser = "A";
    const outcome = await adoptIdentity(ctx, "A", null, h.deps);
    assert.equal(outcome, "interrupted");
    ctx.notice("Bienvenue A");
  });
  await h.refreshStarted.promise; // A's workspace request is in flight…
  h.clearSessionState(); // …when the user logs out
  h.refreshGate.resolve();
  assert.equal(await chain, false);
  assert.deepEqual(h.state.views, []);
  assert.equal(h.state.notice, "");
  assert.equal(h.state.busy, false);
});
test("a stale mutation chain of A finishing after B's login publishes nothing", async () => {
  const h = controllerLike();
  const gateA = deferred<void>();
  const chainA = h.runner.run(async (ctx) => {
    await gateA.promise;
    ctx.notice("A terminé");
    ctx.when((v: View) => h.state.views.push(v))("detail");
  });
  h.guard.bump();
  h.runner.reset();
  const chainB = h.runner.run(async (ctx) => {
    h.state.sdkUser = "B";
    await adoptIdentity(ctx, "B", null, h.deps);
  });
  h.refreshGate.resolve();
  gateA.resolve();
  assert.equal(await chainA, false);
  assert.equal(await chainB, true);
  assert.deepEqual(h.state.views, ["overview"]);
  assert.equal(h.state.notice, "");
  assert.equal(h.state.userId, "B");
});
test("a kept draft is restored after adoption", async () => {
  const h = controllerLike();
  const draft = { category: "panel" as const, description: "x".repeat(20), address: "1 rue", postal_code: "97200", city: "FDF", urgency: "scheduled" as const };
  const chain = h.runner.run(async (ctx) => {
    h.state.sdkUser = "A";
    await adoptIdentity(ctx, "A", draft, h.deps);
  });
  h.refreshGate.resolve();
  await chain;
  assert.deepEqual(h.state.views, ["new"]);
});
