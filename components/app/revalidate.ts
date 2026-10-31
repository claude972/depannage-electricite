// Foreground revalidation scheduler. Every focus/visibility signal is honoured: if a
// revalidation is already running, a trailing one is scheduled for when it ends; if the last
// run is recent, the next run is delayed to the end of the quiet window instead of being
// dropped. No signal is ever lost, no concurrent duplicate runs. Pure, covered by tests/ui.
export type RevalidationScheduler = {
  /** A focus/visibility signal: returns immediately; the run happens now, later or after the current one. */
  signal(): void;
  /** Cancel pending timers (unmount / identity change). */
  cancel(): void;
  /** For tests and diagnostics. */
  state(): { running: boolean; trailing: boolean; scheduled: boolean };
};
export function createRevalidationScheduler(
  run: () => Promise<void>,
  options: { minIntervalMs: number; now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void },
): RevalidationScheduler {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let running = false;
  let trailing = false;
  let lastEnd = -Infinity;
  let timer: unknown = null;
  let cancelled = false;
  async function execute() {
    running = true;
    try {
      await run();
    } catch {
      /* the run reports its own errors */
    } finally {
      running = false;
      lastEnd = now();
      if (trailing && !cancelled) {
        trailing = false;
        schedule(); // the signal that arrived during the run is honoured after the quiet window
      }
    }
  }
  function schedule() {
    if (cancelled) return;
    if (running) {
      trailing = true; // coalesce: one trailing run after the current one
      return;
    }
    if (timer !== null) return; // already scheduled
    const wait = Math.max(0, options.minIntervalMs - (now() - lastEnd));
    if (wait === 0) {
      void execute();
      return;
    }
    timer = setTimer(() => {
      timer = null;
      void execute();
    }, wait);
  }
  return {
    signal: schedule,
    cancel() {
      cancelled = true;
      trailing = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    state: () => ({ running, trailing, scheduled: timer !== null }),
  };
}
