import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoordinator, refreshContextKey, type ReadResult, type RefreshOutcome } from "../../components/app/workspace-refresh";

// A fake workspace read: each call is a deferred promise the test resolves by hand, and reports
// which "server state" it observed (the server state at the moment the read was SENT).
function harness(initialContext = "g1|client||") {
  let context = initialContext;
  let serverVersion = 0;
  const reads: { sentAtVersion: number; context: string; resolve: (r: ReadResult) => void }[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const applied: number[] = [];
  const coordinator = createRefreshCoordinator({
    contextKey: () => context,
    read: () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const entry = { sentAtVersion: serverVersion, context, resolve: (_r: ReadResult) => {} };
      const p = new Promise<ReadResult>((resolve) => {
        entry.resolve = (r) => {
          concurrent -= 1;
          if (r.kind === "loaded") applied.push(entry.sentAtVersion);
          resolve(r);
        };
      });
      reads.push(entry);
      return p;
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    coordinator,
    reads,
    applied,
    flush,
    write: () => (serverVersion += 1),
    setContext: (c: string) => (context = c),
    get maxConcurrent() {
      return maxConcurrent;
    },
  };
}

const settled = <T,>(p: Promise<T>) => {
  const box: { value?: T; done: boolean } = { done: false };
  void p.then((v) => {
    box.value = v;
    box.done = true;
  });
  return box;
};

test("A4: a post-write cause during read A is NOT satisfied by A's old snapshot; one trailing read B proves it", async () => {
  const h = harness();
  const first = settled(h.coordinator.request()); // cause 1 ⇒ read A
  await h.flush();
  assert.equal(h.reads.length, 1);
  h.write(); // a mutation commits while A is in flight
  const afterWrite = settled(h.coordinator.request()); // post-write cause ⇒ barrier
  await h.flush();
  assert.equal(h.reads.length, 1, "no second concurrent read");
  h.reads[0].resolve({ kind: "loaded" }); // A returns the OLD workspace
  await h.flush();
  assert.equal(first.done, true);
  assert.equal(afterWrite.done, false, "the old snapshot must not satisfy the post-write cause");
  assert.equal(h.reads.length, 2, "exactly one trailing read");
  assert.equal(h.reads[1].sentAtVersion, 1, "the trailing read observes the write");
  h.reads[1].resolve({ kind: "loaded" });
  await h.flush();
  assert.equal((afterWrite.value as RefreshOutcome).kind, "loaded");
  assert.equal(h.maxConcurrent, 1);
});

test("A4: the same holds for a realtime event, a manual « Actualiser » and a deep link arriving during A", async () => {
  for (const label of ["realtime", "manual", "deeplink"]) {
    const h = harness();
    void h.coordinator.request();
    await h.flush();
    h.write();
    const cause = settled(h.coordinator.request()); // every cause takes a barrier by default
    h.reads[0].resolve({ kind: "loaded" });
    await h.flush();
    assert.equal(cause.done, false, `${label}: not satisfied by the read that started before it`);
    assert.equal(h.reads.length, 2, `${label}: one trailing read`);
    h.reads[1].resolve({ kind: "loaded" });
    await h.flush();
    assert.equal((cause.value as RefreshOutcome).kind, "loaded");
  }
});

test("causes registered in the same tick before the read starts share ONE read", async () => {
  const h = harness();
  const a = settled(h.coordinator.request()); // focus
  const b = settled(h.coordinator.request()); // realtime
  const c = settled(h.coordinator.request()); // deep link
  await h.flush();
  assert.equal(h.reads.length, 1, "focus + realtime + deep link at the same checkpoint ⇒ one read");
  h.reads[0].resolve({ kind: "loaded" });
  await h.flush();
  for (const x of [a, b, c]) assert.equal((x.value as RefreshOutcome).kind, "loaded");
  assert.equal(h.reads.length, 1);
});

test("many causes during A coalesce into ONE trailing read; never two concurrent calls", async () => {
  const h = harness();
  void h.coordinator.request();
  await h.flush();
  const waits = Array.from({ length: 10 }, () => settled(h.coordinator.request()));
  await h.flush();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve({ kind: "loaded" });
  await h.flush();
  assert.equal(h.reads.length, 2, "one trailing read for ten causes");
  const late = settled(h.coordinator.request()); // a cause after B started ⇒ B cannot prove it
  h.reads[1].resolve({ kind: "loaded" });
  await h.flush();
  for (const w of waits) assert.equal((w.value as RefreshOutcome).kind, "loaded");
  assert.equal(late.done, false);
  assert.equal(h.reads.length, 3, "one more trailing read for the late cause");
  h.reads[2].resolve({ kind: "loaded" });
  await h.flush();
  assert.equal((late.value as RefreshOutcome).kind, "loaded");
  assert.equal(h.maxConcurrent, 1);
});

test("a passive read (no barrier) joins the current flight", async () => {
  const h = harness();
  void h.coordinator.request();
  await h.flush();
  const passive = settled(h.coordinator.request({ barrier: false }));
  h.reads[0].resolve({ kind: "loaded" });
  await h.flush();
  assert.equal((passive.value as RefreshOutcome).kind, "loaded");
  assert.equal(h.reads.length, 1);
});

test("context change during A: A's data is never proof for the old waiter (superseded) and the new context gets its own read", async () => {
  const h = harness("g1|client||");
  const oldWaiter = settled(h.coordinator.request());
  await h.flush();
  h.setContext("g1|manager|org-2|site-9"); // organisation/site switched while A is in flight
  const newWaiter = settled(h.coordinator.request());
  h.reads[0].resolve({ kind: "loaded" }); // A was read for the OLD context
  await h.flush();
  assert.equal((oldWaiter.value as RefreshOutcome).kind, "superseded");
  assert.equal(newWaiter.done, false, "the old context's read is not applied to the new one");
  assert.equal(h.reads.length, 2);
  assert.equal(h.reads[1].context, "g1|manager|org-2|site-9");
  h.reads[1].resolve({ kind: "loaded" });
  await h.flush();
  const v = newWaiter.value as RefreshOutcome;
  assert.equal(v.kind, "loaded");
  assert.equal(v.kind === "loaded" && v.contextKey, "g1|manager|org-2|site-9");
});

test("identity change ⇒ pending waiters resolve superseded (no attempt, no not_found)", async () => {
  const h = harness("g1|client||");
  const w = settled(h.coordinator.request());
  await h.flush();
  h.setContext("g2|client||");
  h.reads[0].resolve({ kind: "loaded" });
  await h.flush();
  assert.equal((w.value as RefreshOutcome).kind, "superseded");
});

test("trailing read B fails (503 or transport) ⇒ failed with its status, never loaded", async () => {
  for (const status of [503, 0]) {
    const h = harness();
    void h.coordinator.request();
    await h.flush();
    h.write();
    const cause = settled(h.coordinator.request());
    h.reads[0].resolve({ kind: "loaded" });
    await h.flush();
    h.reads[1].resolve({ kind: "failed", status });
    await h.flush();
    assert.deepEqual(cause.value, { kind: "failed", status });
  }
});

test("a read that throws is a failure (status 0), the coordinator keeps working", async () => {
  let calls = 0;
  const c = createRefreshCoordinator({
    contextKey: () => "g1|client||",
    read: () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return Promise.resolve({ kind: "loaded" } as ReadResult);
    },
  });
  assert.deepEqual(await c.request(), { kind: "failed", status: 0 });
  assert.equal((await c.request()).kind, "loaded");
});

test("signed_out and a superseded read (same context) resolve instead of looping", async () => {
  const h = harness();
  const a = settled(h.coordinator.request());
  await h.flush();
  h.reads[0].resolve({ kind: "signed_out" });
  await h.flush();
  assert.deepEqual(a.value, { kind: "signed_out" });
  const b = settled(h.coordinator.request());
  await h.flush();
  h.reads[1].resolve({ kind: "superseded" });
  await h.flush();
  assert.deepEqual(b.value, { kind: "superseded" });
  assert.equal(h.reads.length, 2, "no extra read after a superseded result");
});

test("refreshContextKey separates identity generation, role, organisation and site", () => {
  const keys = new Set([
    refreshContextKey(1, "client", "", ""),
    refreshContextKey(2, "client", "", ""),
    refreshContextKey(1, "manager", "", ""),
    refreshContextKey(1, "manager", "o1", ""),
    refreshContextKey(1, "manager", "o1", "s1"),
  ]);
  assert.equal(keys.size, 5);
});
