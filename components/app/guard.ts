// Identity-generation guard used by the session controller. Every mutation chain captures the
// generation it started in; when the identity changes (logout, other account, demo switch) the
// generation is bumped and the chain's deferred effects (notices, navigation, data, busy reset)
// are dropped instead of leaking into the next session. Pure module, covered by tests/ui.
export type Guard = {
  generation(): number;
  /** Invalidate every chain started before now. */
  bump(): number;
  alive(generation: number): boolean;
  /** Wrap a side effect so it only runs while its generation is current. */
  bind<A extends unknown[]>(generation: number, effect: (...args: A) => void): (...args: A) => void;
};
export function createGuard(): Guard {
  let current = 0;
  return {
    generation: () => current,
    bump: () => ++current,
    alive: (g) => g === current,
    bind:
      (g, effect) =>
      (...args) => {
        if (g === current) effect(...args);
      },
  };
}
export type RunEffects = {
  setBusy(value: boolean): void;
  setError(message: string): void;
  setNotice(message: string): void;
};
export type RunContext = {
  /** True while the identity that started this chain is still the current one. */
  alive(): boolean;
  generation: number;
  notice(message: string): void;
  error(message: string): void;
  /** Runs `effect` only when the chain is still alive. */
  when<A extends unknown[]>(effect: (...args: A) => void): (...args: A) => void;
  /** For a chain that itself creates the new identity (login): continue as that identity. */
  rebind(): void;
};
export type Runner = {
  run(task: (ctx: RunContext) => Promise<void>): Promise<boolean>;
  /** Called by the identity reset: drops the busy flag of a chain that no longer matters. */
  reset(): void;
  isBusy(): boolean;
};
// Serialises mutations (one at a time) and binds their completion to the starting identity.
export function createRunner(guard: Guard, effects: RunEffects): Runner {
  let busy = false;
  return {
    isBusy: () => busy,
    reset() {
      busy = false;
      effects.setBusy(false);
    },
    async run(task) {
      if (busy) return false;
      let g = guard.generation();
      busy = true;
      effects.setBusy(true);
      effects.setError("");
      effects.setNotice("");
      const when =
        <A extends unknown[]>(effect: (...args: A) => void) =>
        (...args: A) => {
          if (guard.alive(g)) effect(...args);
        };
      const ctx: RunContext = {
        alive: () => guard.alive(g),
        get generation() {
          return g;
        },
        notice: when(effects.setNotice),
        error: when(effects.setError),
        when,
        rebind() {
          g = guard.generation();
          busy = true;
          effects.setBusy(true);
        },
      };
      try {
        await task(ctx);
        return guard.alive(g);
      } catch (e) {
        if (guard.alive(g)) effects.setError((e as Error).message);
        return false;
      } finally {
        // A chain from a previous identity never clears the current session's busy state.
        if (guard.alive(g)) {
          busy = false;
          effects.setBusy(false);
        }
      }
    },
  };
}

// Runs a task that produces a value. The value is returned only when the chain completed
// while its identity was still current; a failed or stale chain yields null, so callers can
// never navigate or announce on behalf of a previous account.
export async function runForResult<T>(
  runner: Runner,
  task: (ctx: RunContext) => Promise<T | undefined>,
): Promise<T | null> {
  let value: T | undefined;
  const completed = await runner.run(async (ctx) => {
    const result = await task(ctx);
    if (ctx.alive()) value = result;
  });
  return completed && value !== undefined ? value : null;
}
