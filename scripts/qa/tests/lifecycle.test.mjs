import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLifecycle, createStopGate, fatalExitCode, StopRequestedError } from "../lib/lifecycle.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

test("finalize runs cleanup exactly once even when called twice (suite crash + normal path)", async () => {
  let cleanups = 0;
  let writes = 0;
  const lc = createLifecycle({
    cleanup: async () => {
      cleanups++;
      return { ok: true, steps: [] };
    },
    writeResults: async () => {
      writes++;
    },
  });
  const first = await lc.finalize("completed");
  const second = await lc.finalize("again");
  assert.equal(cleanups, 1);
  assert.equal(writes, 1);
  assert.equal(first, second);
  assert.equal(first.cleanup.ok, true);
});

test("a throwing cleanup never aborts the finalisation and is reported as incomplete", async () => {
  let written = null;
  const lc = createLifecycle({
    cleanup: async () => {
      throw new Error("supabase unreachable");
    },
    writeResults: async (payload) => {
      written = payload;
    },
  });
  const result = await lc.finalize("completed");
  assert.equal(result.cleanup.ok, false);
  assert.match(result.cleanup.error, /supabase unreachable/);
  assert.equal(written.cleanup.ok, false);
});

test("--keep-fixtures skips cleanup but still writes results", async () => {
  let cleanups = 0;
  let writes = 0;
  const lc = createLifecycle({ keepFixtures: true, cleanup: async () => cleanups++, writeResults: async () => writes++ });
  const result = await lc.finalize();
  assert.equal(cleanups, 0);
  assert.equal(writes, 1);
  assert.equal(result.cleanup, null);
});

test("an unhandled rejection records a FATAL, runs cleanup once and exits with 1 (3 if cleanup incomplete)", async () => {
  for (const cleanupOk of [true, false]) {
    const proc = new EventEmitter();
    let cleanups = 0;
    let exitCode = null;
    let fatalSeen = null;
    const exited = new Promise((resolve) => {
      const lc = createLifecycle({
        cleanup: async () => {
          cleanups++;
          return { ok: cleanupOk, steps: [] };
        },
        writeResults: async () => {},
      });
      lc.installCrashHandlers(proc, {
        onFatal: (error, origin) => {
          fatalSeen = { message: error.message, origin };
        },
        codeFor: fatalExitCode,
        exit: (code) => {
          exitCode = code;
          resolve();
        },
      });
      proc.emit("unhandledRejection", new Error("route.fetch: Timeout 30000ms exceeded"));
      proc.emit("uncaughtException", new Error("second crash must be ignored"));
    });
    await exited;
    assert.equal(cleanups, 1);
    assert.equal(fatalSeen.origin, "unhandledRejection");
    assert.match(fatalSeen.message, /Timeout 30000ms/);
    assert.equal(exitCode, cleanupOk ? 1 : 3);
  }
});

test("stop gate: check() throws once stopped, stop() is idempotent, register/drain count in-flight work", async () => {
  const gate = createStopGate();
  assert.equal(gate.stopping, false);
  gate.check(); // no throw before the signal
  assert.deepEqual(await gate.drain(10), { pending: 0, settled: 0, timedOut: false, waitedMs: 0 });
  const a = deferred();
  const b = deferred();
  gate.register(a.promise);
  gate.register(b.promise).catch(() => {}); // a failing creation is the caller's; drain never rejects
  assert.equal(gate.pending, 2);
  assert.equal(gate.stop("fatal:unhandledRejection"), true);
  assert.equal(gate.stop("again"), false, "the first reason wins");
  assert.equal(gate.reason, "fatal:unhandledRejection");
  assert.equal(gate.stopping, true);
  assert.ok(gate.signal.aborted);
  assert.throws(() => gate.check(), (e) => e instanceof StopRequestedError && e.code === "QA_STOP_REQUESTED" && /fatal:unhandledRejection/.test(e.message));
  const draining = gate.drain(5000);
  a.resolve("ok");
  b.reject(new Error("insert failed after the signal"));
  const result = await draining;
  assert.equal(result.pending, 0);
  assert.equal(result.settled, 2);
  assert.equal(result.timedOut, false);
});

test("stop gate: drain times out on a creation that never settles and reports it as pending", async () => {
  const gate = createStopGate();
  const hung = deferred();
  gate.register(hung.promise);
  gate.stop("fatal:x");
  const result = await gate.drain(20);
  assert.equal(result.pending, 1);
  assert.equal(result.settled, 0);
  assert.equal(result.timedOut, true);
  assert.ok(result.waitedMs >= 15);
  hung.resolve();
});

test("finalize raises the stop signal, drains in-flight creations, THEN runs cleanup (never during)", async () => {
  const gate = createStopGate();
  const order = [];
  const creation = deferred();
  gate.register(creation.promise.then(() => order.push("creation settled")));
  const lc = createLifecycle({
    gate,
    drainTimeoutMs: 5000,
    cleanup: async () => {
      order.push("cleanup");
      assert.equal(gate.pending, 0, "cleanup started while a creation was still in flight");
      return { ok: true, steps: [] };
    },
    writeResults: async (payload) => {
      order.push(`results:${payload.reason}`);
      assert.equal(payload.drain.settled, 1);
    },
  });
  assert.equal(lc.stopping, false);
  const finalizing = lc.finalize("completed");
  assert.equal(lc.stopping, true, "the signal is raised synchronously by finalize");
  assert.throws(() => gate.check(), StopRequestedError);
  setTimeout(() => creation.resolve(), 10); // the in-flight insert answers after the signal
  const result = await finalizing;
  assert.deepEqual(order, ["creation settled", "cleanup", "results:completed"]);
  assert.equal(result.drain.pending, 0);
  assert.equal(result.cleanup.ok, true);
});

test("finalize with a creation that never settles: cleanup still runs, result is INCOMPLETE and names the drain", async () => {
  const gate = createStopGate();
  const hung = deferred();
  gate.register(hung.promise);
  const logs = [];
  const lc = createLifecycle({ gate, drainTimeoutMs: 20, log: (m) => logs.push(m), cleanup: async () => ({ ok: true, steps: [] }), writeResults: async () => {} });
  const result = await lc.finalize("fatal:uncaughtException");
  assert.equal(result.drain.timedOut, true);
  assert.equal(result.drain.pending, 1);
  assert.equal(result.cleanup.ok, false, "a possibly untracked id is never reported as a complete cleanup");
  assert.match(result.cleanup.error, /did not settle before cleanup/);
  assert.ok(logs.some((l) => /still pending/.test(l)));
  assert.equal(fatalExitCode({ origin: "uncaughtException" }, result.cleanup), 3);
  hung.resolve();
});

test("a crash handler raises the stop signal immediately: a helper looping on fixtures stops at its next insert, its last insert reaches the manifest, then cleanup", async () => {
  const proc = new EventEmitter();
  const gate = createStopGate();
  const order = [];
  const manifest = [];
  // A Node fixture loop (as a suite setup would run), each insert answering asynchronously.
  const insert = (n) =>
    gate.register(
      (async () => {
        gate.check();
        await new Promise((r) => setTimeout(r, 5));
        manifest.push(n);
        order.push(`insert ${n}`);
        return n;
      })(),
    );
  let loopError = null;
  const loop = (async () => {
    try {
      for (let n = 1; n <= 50; n++) await insert(n);
    } catch (error) {
      loopError = error;
    }
  })();
  let exitCode = null;
  const exited = new Promise((resolve) => {
    const lc = createLifecycle({
      gate,
      drainTimeoutMs: 1000,
      cleanup: async () => {
        order.push("cleanup");
        return { ok: true, steps: [] };
      },
      writeResults: async () => {},
    });
    lc.installCrashHandlers(proc, {
      onFatal: () => order.push("fatal reported"),
      codeFor: fatalExitCode,
      exit: (code) => {
        exitCode = code;
        resolve();
      },
    });
    setTimeout(() => proc.emit("unhandledRejection", new Error("route.fetch: Timeout exceeded")), 12);
  });
  await exited;
  await loop;
  assert.ok(loopError instanceof StopRequestedError, `the loop must be stopped by the signal, got ${loopError}`);
  assert.ok(manifest.length >= 1 && manifest.length < 50, `loop ran ${manifest.length} inserts`);
  const cleanupAt = order.indexOf("cleanup");
  assert.ok(cleanupAt > 0);
  assert.ok(order.indexOf("fatal reported") < cleanupAt);
  assert.ok(order.slice(cleanupAt + 1).every((e) => !e.startsWith("insert")), `an insert ran after cleanup: ${order.join(", ")}`);
  assert.equal(order.filter((e) => e.startsWith("insert")).length, manifest.length, "every insert that ran is in the manifest before cleanup");
  assert.equal(exitCode, 1);
});

/** Lifecycle on a fake process with a deferred cleanup; returns the pieces the signal tests inspect. */
function signalRig({ cleanupOk = true, holdCleanup = false, drainTimeoutMs = 1000 } = {}) {
  const proc = new EventEmitter();
  const gate = createStopGate();
  const order = [];
  const exits = [];
  const cleanupGate = deferred();
  let cleanups = 0;
  const written = [];
  const lc = createLifecycle({
    gate,
    drainTimeoutMs,
    cleanup: async () => {
      cleanups++;
      order.push("cleanup");
      if (holdCleanup) await cleanupGate.promise;
      return { ok: cleanupOk, steps: [] };
    },
    writeResults: async (payload) => {
      written.push(payload);
      order.push(`results:${payload.reason}`);
    },
    log: (m) => order.push(`log:${m}`),
  });
  const exited = new Promise((resolve) => {
    lc.installSignalHandlers(proc, {
      onSignal: (signal) => order.push(`signal ${signal}`),
      onSecondSignal: (signal) => order.push(`second ${signal}`),
      exit: (code) => {
        exits.push(code);
        resolve(code);
      },
    });
  });
  return { proc, gate, lc, order, exits, exited, cleanupGate, counts: () => ({ cleanups, written: written.length }), written };
}

test("SIGINT: stop gate raised synchronously, in-flight creation drained, cleanup once, results written, exit 130", async () => {
  const rig = signalRig();
  const creation = deferred();
  rig.gate.register(creation.promise.then(() => rig.order.push("creation settled")));
  rig.proc.emit("SIGINT");
  assert.equal(rig.gate.stopping, true);
  assert.equal(rig.gate.reason, "signal:SIGINT");
  assert.throws(() => rig.gate.check(), StopRequestedError);
  setTimeout(() => creation.resolve(), 10);
  assert.equal(await rig.exited, 130);
  assert.deepEqual(rig.order.filter((e) => !e.startsWith("log:")), ["signal SIGINT", "creation settled", "cleanup", "results:signal:SIGINT"]);
  assert.deepEqual(rig.counts(), { cleanups: 1, written: 1 });
  assert.equal(rig.written[0].reason, "signal:SIGINT");
  assert.equal(rig.written[0].fatal, null, "a signal is not a FATAL");
});

test("SIGTERM follows the same path; an incomplete cleanup exits 3 instead of 130", async () => {
  const rig = signalRig({ cleanupOk: false });
  rig.proc.emit("SIGTERM");
  assert.equal(await rig.exited, 3);
  assert.equal(rig.gate.reason, "signal:SIGTERM");
  assert.deepEqual(rig.counts(), { cleanups: 1, written: 1 });
});

test("a second SIGINT during the cleanup aborts the wait: exit 130 immediately, cleanup not re-run, manifest kept (logged)", async () => {
  const rig = signalRig({ holdCleanup: true });
  rig.proc.emit("SIGINT");
  await new Promise((r) => setTimeout(r, 5)); // first finalisation is now waiting inside cleanup()
  assert.equal(rig.counts().cleanups, 1);
  rig.proc.emit("SIGINT");
  assert.equal(await rig.exited, 130);
  assert.deepEqual(rig.exits, [130]);
  assert.ok(rig.order.includes("second SIGINT"));
  assert.ok(rig.order.some((e) => /second signal SIGINT: cleanup aborted, manifest kept/.test(e)));
  assert.equal(rig.counts().cleanups, 1, "no new cleanup started by the second signal");
  assert.equal(rig.counts().written, 0, "results not written: the finalisation was abandoned by the second signal");
  // Releasing the held cleanup afterwards must not trigger a second exit.
  rig.cleanupGate.resolve();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(rig.exits, [130], "the process exits once");
  assert.equal(rig.lc.exited.origin, "signal:SIGINT:second");
});

test("SIGINT then a crash during the finalisation: one cleanup, one exit (the signal path decides, 130)", async () => {
  const proc = new EventEmitter();
  const gate = createStopGate();
  const cleanupGate = deferred();
  let cleanups = 0;
  const exits = [];
  const lc = createLifecycle({
    gate,
    cleanup: async () => {
      cleanups++;
      await cleanupGate.promise;
      return { ok: true, steps: [] };
    },
    writeResults: async () => {},
  });
  const exited = new Promise((resolve) => {
    const exit = (code) => {
      exits.push(code);
      resolve();
    };
    lc.installCrashHandlers(proc, { onFatal: () => {}, codeFor: fatalExitCode, exit });
    lc.installSignalHandlers(proc, { exit });
  });
  proc.emit("SIGINT");
  await new Promise((r) => setTimeout(r, 5));
  proc.emit("unhandledRejection", new Error("Target page, context or browser has been closed")); // late Playwright rejection while cleaning up
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(cleanups, 1, "the crash handler joined the running finalisation");
  cleanupGate.resolve();
  await exited;
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(exits, [130], "exactly one exit, decided by the first path (the signal)");
  assert.equal(lc.fatal.origin, "unhandledRejection", "the late crash is still recorded in the results");
});

test("a signal after the normal finalisation does not clean up twice", async () => {
  const rig = signalRig();
  await rig.lc.finalize("completed");
  rig.proc.emit("SIGINT");
  assert.equal(await rig.exited, 130);
  assert.deepEqual(rig.counts(), { cleanups: 1, written: 1 });
});

test("fatalExitCode", () => {
  assert.equal(fatalExitCode({ origin: "x" }, { ok: true }), 1);
  assert.equal(fatalExitCode({ origin: "x" }, { ok: false }), 3);
  assert.equal(fatalExitCode(null, { ok: true }), 0);
  assert.equal(fatalExitCode({ origin: "x" }, null), 1);
});
