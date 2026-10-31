import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createLifecycle, fatalExitCode } from "../lib/lifecycle.mjs";

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

test("fatalExitCode", () => {
  assert.equal(fatalExitCode({ origin: "x" }, { ok: true }), 1);
  assert.equal(fatalExitCode({ origin: "x" }, { ok: false }), 3);
  assert.equal(fatalExitCode(null, { ok: true }), 0);
  assert.equal(fatalExitCode({ origin: "x" }, null), 1);
});
