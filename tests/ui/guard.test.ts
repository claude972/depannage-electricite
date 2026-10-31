import test from "node:test";
import assert from "node:assert/strict";
import { createGuard, createRunner } from "../../components/app/guard";

function harness() {
  const log: string[] = [];
  const state = { busy: false, error: "", notice: "" };
  const guard = createGuard();
  const runner = createRunner(guard, {
    setBusy: (v) => {
      state.busy = v;
      log.push(`busy:${v}`);
    },
    setError: (m) => {
      state.error = m;
      if (m) log.push(`error:${m}`);
    },
    setNotice: (m) => {
      state.notice = m;
      if (m) log.push(`notice:${m}`);
    },
  });
  return { guard, runner, state, log };
}
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("a mutation finishing after logout/login never publishes into the new session", async () => {
  const { guard, runner, state, log } = harness();
  const navigated: string[] = [];
  const data: string[] = [];
  const gate = deferred<void>();
  const chainA = runner.run(async (ctx) => {
    await gate.promise; // server response of account A still in flight
    ctx.when((id: string) => data.push(id))("dossier-A");
    ctx.when((v: string) => navigated.push(v))("detail");
    ctx.notice("Modification enregistrée (A)");
  });
  assert.equal(state.busy, true);
  // Account A logs out, account B logs in: identity generation bumps and busy is reset.
  guard.bump();
  runner.reset();
  assert.equal(state.busy, false);
  // B starts its own work.
  const gateB = deferred<void>();
  const chainB = runner.run(async (ctx) => {
    await gateB.promise;
    ctx.notice("B terminé");
  });
  assert.equal(state.busy, true, "B's chain is running");
  gate.resolve();
  const okA = await chainA;
  assert.equal(okA, false, "A's chain reports not applied");
  assert.deepEqual(data, [], "A's dossier is not selected for B");
  assert.deepEqual(navigated, [], "A's navigation is dropped");
  assert.equal(state.notice, "", "A's notice is not shown to B");
  assert.equal(state.busy, true, "A's completion did not clear B's busy flag");
  gateB.resolve();
  assert.equal(await chainB, true);
  assert.equal(state.busy, false);
  assert.equal(state.notice, "B terminé");
  assert.ok(!log.includes("notice:Modification enregistrée (A)"));
});
test("a rejected stale chain does not surface its error to the new identity", async () => {
  const { guard, runner, state } = harness();
  const gate = deferred<void>();
  const chainA = runner.run(async () => {
    await gate.promise;
    throw new Error("Erreur de A");
  });
  guard.bump();
  runner.reset();
  gate.reject(new Error("ignored"));
  assert.equal(await chainA, false);
  assert.equal(state.error, "", "stale error is dropped");
  assert.equal(state.busy, false);
});
test("within one identity the runner serialises mutations and reports errors", async () => {
  const { runner, state } = harness();
  const gate = deferred<void>();
  const first = runner.run(async () => {
    await gate.promise;
  });
  const second = await runner.run(async () => {});
  assert.equal(second, false, "second mutation refused while the first is busy");
  gate.resolve();
  assert.equal(await first, true);
  const failed = await runner.run(async () => {
    throw new Error("Vérifiez les informations saisies.");
  });
  assert.equal(failed, false);
  assert.equal(state.error, "Vérifiez les informations saisies.");
  assert.equal(state.busy, false);
});
test("bound effects run only while their generation is current", () => {
  const guard = createGuard();
  const g = guard.generation();
  let calls = 0;
  const effect = guard.bind(g, () => {
    calls += 1;
  });
  effect();
  guard.bump();
  effect();
  assert.equal(calls, 1);
  assert.equal(guard.alive(g), false);
});
test("runForResult hands back a value only when the chain completed as the current identity", async () => {
  const { runForResult } = await import("../../components/app/guard");
  const { guard, runner, state } = harness();
  const gate = deferred<{ id: string }>();
  const pending = runForResult(runner, async () => await gate.promise);
  guard.bump(); // the account changed while the creation was in flight
  runner.reset();
  gate.resolve({ id: "ticket-A" });
  assert.equal(await pending, null, "the stale result is not handed back");
  assert.equal(state.notice, "");
  const fresh = await runForResult(runner, async () => ({ id: "ticket-B" }));
  assert.deepEqual(fresh, { id: "ticket-B" });
  const failed = await runForResult(runner, async () => {
    throw new Error("refus");
  });
  assert.equal(failed, null);
  assert.equal(state.error, "refus");
});
