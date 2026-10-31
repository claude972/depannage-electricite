// Workspace refresh coordinator (WEB-DEEPLINK-REFRESH-001, contract A3/A4). Pure, no React.
//
// Causal freshness: every cause that needs proof (post-write, manual « Actualiser », realtime
// event, focus revalidation, deep link to an absent id) takes a BARRIER — a monotone checkpoint.
// A waiter is satisfied only by a read that STARTED at or after its checkpoint, in its context.
// A read that started before the cause (it may hold an older snapshot) never satisfies it.
//
// Single flight: at most one read in flight and at most ONE pending trailing read. Causes
// registered before a read actually starts share it (the start is deferred to a microtask);
// causes after the start coalesce into the single trailing read. Never two concurrent reads,
// never an unbounded queue.

/** What one workspace read observed. `superseded` = its result was not applied (newer read / reset). */
export type ReadResult =
  | { kind: "loaded" }
  | { kind: "failed"; status: number; reason?: "invalid_response" }
  | { kind: "signed_out" }
  | { kind: "superseded" };

/** What a waiter learns. `loaded` is the only outcome that proves the CURRENT state of its context. */
export type RefreshOutcome =
  | { kind: "loaded"; checkpoint: number; contextKey: string }
  | { kind: "failed"; status: number; reason?: "invalid_response" }
  | { kind: "signed_out" }
  | { kind: "superseded" };

export type RefreshCoordinatorDeps = {
  /** Performs one workspace read and applies it. Must not throw (map errors to ReadResult). */
  read(): Promise<ReadResult>;
  /** Identity generation + role + active organisation + site, read at call time. */
  contextKey(): string;
  /** Defers the start of a read so that same-tick causes share it (default: microtask). */
  defer?(start: () => void): void;
};

type Waiter = { need: number; context: string; resolve: (outcome: RefreshOutcome) => void };
type Flight = { startedAt: number; context: string };

export type RefreshCoordinator = {
  /**
   * `barrier: true` (default for every cause) ⇒ satisfied only by a read started after now.
   * `barrier: false` (passive render/bootstrap) ⇒ may join the current flight of its context.
   */
  request(options?: { barrier?: boolean }): Promise<RefreshOutcome>;
  /** Observability for tests: reads started so far, flight/pending state. */
  stats(): { reads: number; inFlight: boolean; pending: boolean; checkpoint: number };
};

export function createRefreshCoordinator(deps: RefreshCoordinatorDeps): RefreshCoordinator {
  const defer = deps.defer ?? ((start: () => void) => void Promise.resolve().then(start));
  let checkpoint = 0;
  let reads = 0;
  let flight: Flight | null = null;
  let scheduled = false; // a start is deferred (not yet sent) — same-tick causes join it
  const waiters: Waiter[] = [];

  function schedule() {
    if (scheduled || flight) return; // a running flight schedules its own trailing read on settle
    scheduled = true;
    defer(start);
  }

  function start() {
    scheduled = false;
    if (flight || waiters.length === 0) return;
    const current: Flight = { startedAt: checkpoint, context: deps.contextKey() };
    flight = current;
    reads += 1;
    let result: Promise<ReadResult>;
    try {
      result = deps.read();
    } catch {
      result = Promise.resolve({ kind: "failed", status: 0 });
    }
    void result
      .catch((): ReadResult => ({ kind: "failed", status: 0 }))
      .then((r) => settle(current, r));
  }

  function settle(done: Flight, result: ReadResult) {
    flight = null;
    const now = deps.contextKey();
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      // The waiter's context is gone (identity, role, organisation or site changed): its data
      // would belong to another perimeter. No attempt is consumed, no « introuvable ».
      if (w.context !== now) {
        waiters.splice(i, 1);
        w.resolve({ kind: "superseded" });
        continue;
      }
      // Not proof for this waiter: older than its cause, or read for another context.
      if (done.startedAt < w.need || done.context !== w.context) continue;
      if (result.kind === "superseded") {
        // The read was discarded although the context is unchanged (e.g. session reset in
        // progress): resolve rather than loop forever on reads that are never applied.
        waiters.splice(i, 1);
        w.resolve({ kind: "superseded" });
        continue;
      }
      waiters.splice(i, 1);
      if (result.kind === "loaded") w.resolve({ kind: "loaded", checkpoint: done.startedAt, contextKey: done.context });
      else w.resolve(result);
    }
    // Causes that arrived during this read still wait: ONE trailing read serves all of them.
    if (waiters.length > 0) schedule();
  }

  return {
    request(options) {
      const barrier = options?.barrier ?? true;
      const context = deps.contextKey();
      // Passive join: any read of this context that is running or about to start will do.
      // Otherwise the cause takes a new checkpoint that only a later read can satisfy.
      const need = barrier ? ++checkpoint : flight && flight.context === context ? flight.startedAt : checkpoint;
      return new Promise<RefreshOutcome>((resolve) => {
        waiters.push({ need, context, resolve });
        schedule();
      });
    },
    stats: () => ({ reads, inFlight: flight !== null, pending: scheduled || (flight !== null && waiters.some((w) => w.need > (flight as Flight).startedAt)), checkpoint }),
  };
}

/** Context of a refresh: a read for one context is never proof for another. */
export const refreshContextKey = (generation: number, role: string, organizationId: string, siteId: string) =>
  `${generation}|${role}|${organizationId}|${siteId}`;
