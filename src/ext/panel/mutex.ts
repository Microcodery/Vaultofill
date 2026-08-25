/**
 * A minimal async mutex: `run(fn)` executes each `fn` only after the previous
 * one settles, so read-modify-write sequences and shared-state mutations can't
 * interleave. A rejected task never poisons the chain — later tasks still run.
 */
export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createMutex(): Mutex {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      // Run fn whether the prior task resolved or rejected, but keep the chain
      // itself resolved (a swallowed branch) so one failure can't block the rest.
      const result = chain.then(fn, fn);
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
