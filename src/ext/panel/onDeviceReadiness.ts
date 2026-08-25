/**
 * Resolve to whether the on-device model became usable: true when it signals
 * ready, false when it signals failure (WebGPU unavailable / load error) or when
 * `timeoutMs` elapses first — so a fill falls back to the endpoint promptly
 * instead of waiting the whole timeout on a model that will never load.
 *
 * Pure and injectable (the timer is a parameter) so the ready/failed/timeout
 * decision is unit-testable without the browser messaging around it.
 */
export function raceReadiness(
  whenReady: Promise<unknown>,
  whenFailed: Promise<unknown>,
  timeoutMs: number,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): Promise<boolean> {
  return Promise.race([
    whenReady.then(() => true),
    whenFailed.then(() => false),
    new Promise<boolean>((resolve) => schedule(() => resolve(false), timeoutMs)),
  ]);
}
