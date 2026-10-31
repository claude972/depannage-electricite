// Run lifecycle: ONE idempotent finalisation (stop signal → drain of in-flight fixture creations →
// cleanup unless kept → results) that runs on normal completion, on a suite crash, on an unhandled
// rejection and on an uncaught exception.
// Pure enough to be unit-tested with fakes; nothing here knows Playwright or Supabase.

/** Thrown by fixture helpers when a creation is attempted after the stop signal. */
export class StopRequestedError extends Error {
  constructor(reason) {
    super(`fixture creation refused: the run is stopping (${reason || "finalising"})`);
    this.name = "StopRequestedError";
    this.code = "QA_STOP_REQUESTED";
  }
}

/**
 * Stop gate shared by the lifecycle and the fixture registry (QA-003). `stop(reason)` aborts the
 * signal so that every fixture-creation helper refuses its next insert; `register(promise)`
 * records an in-flight creation; `drain(timeoutMs)` waits for every in-flight creation to settle
 * (success or failure) so that ids created while the signal was raised are in the manifest
 * BEFORE the cleanup deletion starts. A creation that is still pending after the timeout is
 * reported (`timedOut: true`, `pending`), never silently forgotten.
 */
export function createStopGate() {
  const controller = new AbortController();
  const inFlight = new Set();
  let stopReason = null;
  const gate = {
    get signal() {
      return controller.signal;
    },
    get stopping() {
      return controller.signal.aborted;
    },
    get reason() {
      return stopReason;
    },
    get pending() {
      return inFlight.size;
    },
    /** Throws StopRequestedError once the signal is raised; call before every insert. */
    check() {
      if (controller.signal.aborted) throw new StopRequestedError(stopReason);
    },
    stop(reason = "stop") {
      if (controller.signal.aborted) return false;
      stopReason = String(reason);
      controller.abort(new StopRequestedError(stopReason));
      return true;
    },
    register(promise) {
      const tracked = Promise.resolve(promise);
      inFlight.add(tracked);
      // `then(done, done)` never rejects: a failing creation is the caller's to handle, not a leak.
      const done = () => inFlight.delete(tracked);
      tracked.then(done, done);
      return promise;
    },
    async drain(timeoutMs = 0) {
      const started = Date.now();
      const count = inFlight.size;
      if (!count) return { pending: 0, settled: 0, timedOut: false, waitedMs: 0 };
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), Math.max(0, timeoutMs));
        if (typeof timer.unref === "function") timer.unref();
      });
      const settled = Promise.allSettled([...inFlight]).then(() => "settled");
      const outcome = await Promise.race([settled, timeout]);
      clearTimeout(timer);
      return { pending: inFlight.size, settled: count - inFlight.size, timedOut: outcome === "timeout", waitedMs: Date.now() - started };
    },
  };
  return gate;
}

export function createLifecycle({ cleanup, writeResults, keepFixtures = false, log = () => {}, gate = createStopGate(), drainTimeoutMs = 90000 }) {
  let finalizing = null;
  let cleanupResult = null;
  let drainResult = null;
  let fatal = null;
  let exited = null;
  /** The process exits once: whichever path (crash, signal) finishes first decides the code. */
  const exitOnce = (exit, code, origin) => {
    if (exited) return false;
    exited = { code, origin };
    exit(code);
    return true;
  };

  async function finalize(reason = "completed") {
    if (finalizing) return finalizing;
    finalizing = (async () => {
      // 1. Stop signal: from now on every fixture helper refuses to insert (StopRequestedError).
      gate.stop(reason);
      // 2. Drain: creations already in flight settle and record their ids in the manifest first.
      try {
        drainResult = await gate.drain(drainTimeoutMs);
      } catch (error) {
        drainResult = { pending: gate.pending, settled: 0, timedOut: false, error: String(error?.message || error) };
      }
      if (drainResult.pending > 0) log(`drain: ${drainResult.pending} fixture creation(s) still pending after ${drainResult.waitedMs ?? drainTimeoutMs} ms; cleanup proceeds with the manifest as written`);
      // 3. Cleanup (unless kept), then 4. results — both unconditional, never thrown through.
      if (!keepFixtures && cleanup) {
        try {
          cleanupResult = await cleanup();
        } catch (error) {
          cleanupResult = { ok: false, steps: [], error: String(error?.message || error) };
        }
        if (cleanupResult && drainResult.pending > 0) {
          cleanupResult = { ...cleanupResult, ok: false, drain: drainResult, error: cleanupResult.error || `${drainResult.pending} fixture creation(s) did not settle before cleanup: ids may be missing from the manifest` };
        }
      }
      try {
        await writeResults({ cleanup: cleanupResult, fatal, reason, drain: drainResult });
      } catch (error) {
        log(`writing results failed: ${String(error?.message || error)}`);
      }
      return { cleanup: cleanupResult, fatal, reason, drain: drainResult };
    })();
    return finalizing;
  }

  function recordFatal(error, origin) {
    if (!fatal) fatal = { origin, error };
    return fatal;
  }

  /**
   * Installs process-level crash handlers. The first crash records a FATAL, raises the stop
   * signal, finalises (drain + cleanup + results) and exits via `exit(code)`;
   * `codeFor(fatal, cleanupResult)` decides 1 or 3.
   */
  function installCrashHandlers(proc, { onFatal, codeFor, exit }) {
    let handling = false;
    const handler = (origin) => (reason) => {
      if (handling) return;
      handling = true;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      recordFatal(error, origin);
      gate.stop(`fatal:${origin}`); // raised before any reporting: no new insert can start meanwhile
      (async () => {
        let result = null;
        try {
          try {
            await onFatal?.(error, origin); // reporting may itself fail…
          } finally {
            result = await finalize(`fatal:${origin}`); // …cleanup still runs, unconditionally
          }
        } catch (finalError) {
          log(`finalisation after FATAL failed: ${String(finalError?.message || finalError)}`);
        }
        let code = 1;
        try {
          code = codeFor(result?.fatal ?? fatal, result?.cleanup ?? cleanupResult);
        } catch {}
        exitOnce(exit, code, origin);
      })();
    };
    const onRejection = handler("unhandledRejection");
    const onException = handler("uncaughtException");
    proc.on("unhandledRejection", onRejection);
    proc.on("uncaughtException", onException);
    return () => {
      proc.off("unhandledRejection", onRejection);
      proc.off("uncaughtException", onException);
    };
  }

  /**
   * Installs SIGINT/SIGTERM handlers. The FIRST signal raises the stop gate, then finalises
   * exactly once through the same idempotent `finalize` as the crash path (drain → cleanup →
   * results; a crash handler firing meanwhile joins the same finalisation, never a second
   * cleanup) and exits via `exit(codeFor(signal, cleanupResult))` — default 130, or 3 when the
   * cleanup is incomplete. A SECOND signal aborts the wait: `onSecondSignal` runs (the manifest
   * on disk is kept for `--cleanup-manifest`) and the process exits 130 immediately.
   */
  function installSignalHandlers(proc, { onSignal, onSecondSignal, codeFor, exit, signals = ["SIGINT", "SIGTERM"] }) {
    let first = null;
    const decide = codeFor || ((signal, cleanupResult) => (cleanupResult && cleanupResult.ok === false ? 3 : 130));
    const handler = (signal) => () => {
      if (first) {
        log(`second signal ${signal}: cleanup aborted, manifest kept on disk for --cleanup-manifest`);
        try {
          onSecondSignal?.(signal, first);
        } catch {}
        exitOnce(exit, 130, `signal:${signal}:second`);
        return;
      }
      first = signal;
      gate.stop(`signal:${signal}`); // raised synchronously: no new fixture insert can start
      (async () => {
        let result = null;
        try {
          try {
            await onSignal?.(signal); // reporting may fail…
          } finally {
            result = await finalize(`signal:${signal}`); // …cleanup still runs, exactly once
          }
        } catch (finalError) {
          log(`finalisation after ${signal} failed: ${String(finalError?.message || finalError)}`);
        }
        let code = 130;
        try {
          code = decide(signal, result?.cleanup ?? cleanupResult);
        } catch {}
        exitOnce(exit, code, `signal:${signal}`);
      })();
    };
    const handlers = signals.map((signal) => [signal, handler(signal)]);
    for (const [signal, fn] of handlers) proc.on(signal, fn);
    return () => {
      for (const [signal, fn] of handlers) proc.off(signal, fn);
    };
  }

  return {
    finalize,
    recordFatal,
    installCrashHandlers,
    installSignalHandlers,
    gate,
    get exited() {
      return exited;
    },
    get stopping() {
      return gate.stopping;
    },
    get fatal() {
      return fatal;
    },
    get finalized() {
      return finalizing !== null;
    },
  };
}

/** Exit code after a FATAL: 1 unless the cleanup is incomplete (3). */
export function fatalExitCode(fatal, cleanupResult) {
  if (cleanupResult && cleanupResult.ok === false) return 3;
  return fatal ? 1 : 0;
}
