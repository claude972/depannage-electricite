// QA-PWA-LIFECYCLE-002 — child-server controller with a process registry (contract §4/§5, pilot P2).
// Every child PID is registered before anything else happens; the stop gate is checked immediately
// before spawning and during the readiness wait; `stopAll()` is what the single idempotent finalize
// drains: SIGTERM, bounded wait, SIGKILL, wait for exit, verify the port is released. All I/O is
// injected (spawn, probe, portListening, sleep) so the behaviour is unit-tested with fakes.
import { StopRequestedError } from "../qa/lib/lifecycle.mjs";

export function createServerController({ spawn, probe, portListening, gate, port, timeoutMs = 90000, graceMs = 15000, killMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, now = () => new Date().toISOString() }) {
  const entries = [];

  /** Public, serialisable view of the registry (no child handles). */
  const snapshot = () => entries.map(({ child, ...rest }) => ({ ...rest }));

  /** Per-child verdict only: SIGTERM, bounded wait, SIGKILL, bounded wait. Returns whether it exited. */
  async function terminate(entry) {
    if (entry.stopped) return true;
    const exited = new Promise((resolve) => (entry.stopped ? resolve(true) : entry.child.once("exit", () => resolve(true))));
    entry.child.kill("SIGTERM");
    const graceful = await Promise.race([exited, sleep(Math.min(graceMs, timeoutMs)).then(() => false)]);
    if (!graceful) {
      log(`${entry.label} server pid ${entry.pid} ignored SIGTERM: SIGKILL`);
      entry.child.kill("SIGKILL");
      await Promise.race([exited, sleep(killMs).then(() => false)]);
    }
    return Boolean(entry.stopped);
  }

  /** Waits (bounded) for the shared port to be released; ONE readback for the whole registry. */
  async function awaitPortReleased() {
    for (let i = 0; i < 20 && (await portListening(port)); i++) await sleep(250);
    return !(await portListening(port));
  }

  /** Stops ONE child and reads the port back: only valid when no other registered child is meant to keep the port. */
  async function stop(entry) {
    if (!entry) return { stopped: true, portReleased: await awaitPortReleased() };
    const exited = await terminate(entry);
    const portReleased = await awaitPortReleased();
    entry.port_released = portReleased;
    entry.proven_stopped = Boolean(exited && portReleased);
    return { stopped: entry.proven_stopped, portReleased };
  }

  async function start(label, build) {
    // Refuse to spawn once the run is stopping: a signal during the previous stop must never
    // leave a fresh child behind the finalisation. The gate is re-checked AFTER every await,
    // because a signal can land while a probe is suspended (pilot REV-001).
    gate.check();
    const foreign = await portListening(port);
    gate.check(); // the signal may have arrived while the port probe was pending
    if (foreign) throw new Error(`port ${port} is bound by a process the runner does not own; refusing to start ${label}`);
    gate.check(); // immediately before spawn: no await between this check and the spawn call
    const child = spawn(build, { port });
    const entry = { label, pid: child.pid, dir: build.dir, started_at: now(), ready_at: null, stopped_at: null, exit: null, stopped: false, port_released: null, proven_stopped: false, child };
    entries.push(entry); // registered BEFORE any await: finalize can always find it
    child.once("exit", (code, signal) => {
      entry.exit = { code, signal };
      entry.stopped = true;
      entry.stopped_at = now();
    });
    const abortIfStopping = async () => {
      if (!gate.stopping) return;
      await stop(entry); // the just-spawned child is stopped before any success is reported
      throw new StopRequestedError(gate.reason);
    };
    await abortIfStopping(); // a signal between the spawn call and here
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await abortIfStopping();
      if (entry.stopped) throw new Error(`${label} server exited before becoming ready (${JSON.stringify(entry.exit)})`);
      const ready = await probe();
      await abortIfStopping(); // the signal may have arrived while the readiness probe was pending
      if (ready) {
        entry.ready_at = now();
        return entry;
      }
      await sleep(300);
      await abortIfStopping();
    }
    await stop(entry);
    throw new Error(`${label} server not ready within ${timeoutMs} ms`);
  }

  /**
   * Drains the whole registry (pilot REV-004): every child is terminated FIRST (per-child verdict =
   * exited), then the shared port is read back ONCE at the end — an already-exited old child must
   * never be blamed for the port still held by the new child that is stopped right after it.
   * `ok` only when every child exited AND the port is released.
   */
  async function stopAll() {
    const exitedByPid = new Map();
    for (const entry of entries) exitedByPid.set(entry.pid, await terminate(entry));
    const portFree = await awaitPortReleased();
    const steps = entries.map((entry) => {
      // Verdict = exited by the END of the drain: a child whose exit landed during the global port
      // readback (after its own bounded SIGTERM/SIGKILL wait) is exited, not an orphan.
      const exited = exitedByPid.get(entry.pid) === true || entry.stopped === true;
      entry.port_released = portFree;
      entry.proven_stopped = exited && portFree;
      return { label: entry.label, pid: entry.pid, exited, stopped: entry.proven_stopped, port_released: portFree, exit: entry.exit };
    });
    return { ok: steps.every((s) => s.exited) && portFree, port_released: portFree, steps };
  }

  return { start, stop, stopAll, snapshot, get entries() { return entries; } };
}
