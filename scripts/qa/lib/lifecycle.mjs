// Run lifecycle: ONE idempotent finalisation (cleanup unless kept, then results) that runs on
// normal completion, on a suite crash, on an unhandled rejection and on an uncaught exception.
// Pure enough to be unit-tested with fakes; nothing here knows Playwright or Supabase.
export function createLifecycle({ cleanup, writeResults, keepFixtures = false, log = () => {} }) {
  let finalizing = null;
  let cleanupResult = null;
  let fatal = null;

  async function finalize(reason = "completed") {
    if (finalizing) return finalizing;
    finalizing = (async () => {
      if (!keepFixtures && cleanup) {
        try {
          cleanupResult = await cleanup();
        } catch (error) {
          cleanupResult = { ok: false, steps: [], error: String(error?.message || error) };
        }
      }
      try {
        await writeResults({ cleanup: cleanupResult, fatal, reason });
      } catch (error) {
        log(`writing results failed: ${String(error?.message || error)}`);
      }
      return { cleanup: cleanupResult, fatal, reason };
    })();
    return finalizing;
  }

  function recordFatal(error, origin) {
    if (!fatal) fatal = { origin, error };
    return fatal;
  }

  /**
   * Installs process-level crash handlers. The first crash records a FATAL, finalises (cleanup +
   * results) and exits via `exit(code)`; `codeFor(fatal, cleanupResult)` decides 1 or 3.
   */
  function installCrashHandlers(proc, { onFatal, codeFor, exit }) {
    let handling = false;
    const handler = (origin) => (reason) => {
      if (handling) return;
      handling = true;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      recordFatal(error, origin);
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
        exit(code);
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

  return {
    finalize,
    recordFatal,
    installCrashHandlers,
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
