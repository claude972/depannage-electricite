import test from "node:test";
import assert from "node:assert/strict";
import { createRevalidationScheduler, startAccessRevalidation } from "../../components/app/revalidate";

// Deterministic clock and timers.
function clock() {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    async advance(ms: number) {
      const target = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      t = target;
    },
    pending: () => timers.length,
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

test("a focus during a running revalidation triggers one trailing run after the quiet window", async () => {
  const c = clock();
  const gates: ReturnType<typeof deferred>[] = [];
  let runs = 0;
  const s = createRevalidationScheduler(
    async () => {
      runs += 1;
      const g = deferred();
      gates.push(g);
      await g.promise;
    },
    { minIntervalMs: 15000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer },
  );
  s.signal(); // first focus → run 1 starts
  assert.equal(runs, 1);
  s.signal(); // hide/show while run 1 is in flight
  s.signal(); // rapid second focus
  assert.deepEqual(s.state(), { running: true, trailing: true, scheduled: false });
  gates[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  // Run 1 ended at t=0: the trailing run is scheduled at the end of the quiet window, not dropped.
  assert.equal(runs, 1);
  assert.equal(s.state().scheduled, true);
  await c.advance(15000);
  assert.equal(runs, 2, "trailing revalidation completed automatically, no third focus needed");
  gates[1].resolve();
});
test("a focus right after a completed run is delayed to the end of the quiet window, never dropped", async () => {
  const c = clock();
  let runs = 0;
  const s = createRevalidationScheduler(async () => void (runs += 1), {
    minIntervalMs: 15000,
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
  });
  s.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runs, 1);
  await c.advance(5000);
  s.signal(); // within 15 s: the previous implementation dropped it
  s.signal(); // duplicates coalesce into one scheduled run
  assert.equal(s.state().scheduled, true);
  await c.advance(10000);
  assert.equal(runs, 2);
  assert.equal(c.pending(), 0);
});
test("cancel drops pending timers and trailing runs (unmount / identity change)", async () => {
  const c = clock();
  let runs = 0;
  const gate = deferred();
  const s = createRevalidationScheduler(
    async () => {
      runs += 1;
      await gate.promise;
    },
    { minIntervalMs: 15000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer },
  );
  s.signal();
  s.signal();
  s.cancel();
  gate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await c.advance(20000);
  assert.equal(runs, 1);
  assert.equal(c.pending(), 0);
});


test("access revalidation waits 30 seconds, checks current visibility/role/connectivity and recovers after failure", async () => {
  const c = clock(); let eligible = false; let runs = 0;
  const stop = startAccessRevalidation(async () => { runs++; if (runs === 1) throw Error("offline"); }, () => eligible, c);
  await c.advance(30000); assert.equal(runs, 0);
  eligible = true;
  await c.advance(29999); assert.equal(runs, 0);
  await c.advance(1); assert.equal(runs, 1);
  await c.advance(30000); assert.equal(runs, 2);
  eligible = false;
  await c.advance(30000); assert.equal(runs, 2);
  stop(); assert.equal(c.pending(), 0);
  eligible = true; await c.advance(60000); assert.equal(runs, 2);
});

test("access revalidation does not overlap slow reads or reschedule after unmount", async () => {
  const c = clock(), gate = deferred(); let runs = 0;
  const stop = startAccessRevalidation(async () => { runs++; await gate.promise; }, () => true, c);
  await c.advance(30000); assert.equal(runs, 1);
  await c.advance(120000); assert.equal(runs, 1); assert.equal(c.pending(), 0);
  stop(); gate.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(c.pending(), 0);
});
