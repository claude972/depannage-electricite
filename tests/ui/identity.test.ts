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
function controllerLike() {
  const guard = createGuard();
  const state = { busy: false, error: "", notice: "", userId: null as string | null, views: [] as View[], refreshes: 0, clears: 0 };
  const runner = createRunner(guard, {
    setBusy: (v) => {
      state.busy = v;
    },
    setError: (m) => {
      state.error = m;
    },
    setNotice: (m) => {
      state.notice = m;
    },
  });
  // Same shape as the controller: clearing state bumps the generation and resets the runner.
  const clearSessionState = () => {
    state.clears += 1;
    guard.bump();
    runner.reset();
    state.userId = null;
  };
  const refreshGate = deferred<void>();
  const deps: IdentityDeps = {
    clearSessionState,
    setUserId: (id) => {
      state.userId = id;
    },
    refresh: async () => {
      state.refreshes += 1;
      await refreshGate.promise;
    },
    navigate: (v) => {
      state.views.push(v);
    },
    setPendingDraft: () => {},
    homeView: () => "overview",
  };
  return { guard, runner, state, deps, refreshGate, clearSessionState };
}

test("login chain clears the old session, adopts the new identity, refreshes once and navigates", async () => {
  const { runner, state, deps, refreshGate } = controllerLike();
  const chain = runner.run(async (ctx) => {
    await adoptIdentity(ctx, "user-B", null, deps);
  });
  refreshGate.resolve();
  assert.equal(await chain, true, "chain completes as the new identity");
  assert.equal(state.clears, 1);
  assert.equal(state.userId, "user-B");
  assert.equal(state.refreshes, 1);
  assert.deepEqual(state.views, ["overview"]);
  assert.equal(state.busy, false, "busy released after adoption");
});
test("a draft kept before login is restored after the new identity is loaded", async () => {
  const { runner, state, deps, refreshGate } = controllerLike();
  const draft = { category: "panel" as const, description: "x".repeat(20), address: "1 rue", postal_code: "97200", city: "FDF", urgency: "scheduled" as const };
  const chain = runner.run(async (ctx) => {
    await adoptIdentity(ctx, "user-B", draft, deps);
  });
  refreshGate.resolve();
  await chain;
  assert.deepEqual(state.views, ["new"]);
});
test("logout during the login refresh drops the navigation and the late effects", async () => {
  const { runner, state, deps, refreshGate, clearSessionState } = controllerLike();
  const chain = runner.run(async (ctx) => {
    await adoptIdentity(ctx, "user-B", null, deps);
    ctx.notice("Bienvenue B");
  });
  // Another identity change happens while the workspace of B is loading.
  clearSessionState();
  refreshGate.resolve();
  assert.equal(await chain, false);
  assert.deepEqual(state.views, [], "no navigation into a session that no longer exists");
  assert.equal(state.notice, "");
  assert.equal(state.busy, false);
});
test("a stale chain of account A finishing after B's login still publishes nothing", async () => {
  const { runner, state, deps, refreshGate, guard } = controllerLike();
  const gateA = deferred<void>();
  const chainA = runner.run(async (ctx) => {
    await gateA.promise;
    ctx.notice("A terminé");
    ctx.when((v: View) => state.views.push(v))("detail");
  });
  // A logs out, B logs in through the adoption sequence.
  guard.bump();
  runner.reset();
  const chainB = runner.run(async (ctx) => {
    await adoptIdentity(ctx, "user-B", null, deps);
  });
  refreshGate.resolve();
  gateA.resolve();
  assert.equal(await chainA, false);
  assert.equal(await chainB, true);
  assert.deepEqual(state.views, ["overview"], "only B's navigation happened");
  assert.equal(state.notice, "");
  assert.equal(state.userId, "user-B");
});
