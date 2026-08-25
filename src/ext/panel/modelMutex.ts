import { ModelClient } from "../../core/planner/modelClient";
import { createMutex } from "./mutex";

/**
 * Serializes access to the single shared model. Multiple tabs can be mid-review
 * at once, but they share one engine (the offscreen document on Chrome, the
 * sidebar's engine on Firefox), which handles one generation at a time. `wrap`
 * funnels every complete() through one mutex so concurrent reads queue instead
 * of colliding — the deterministic (non-model) paint still runs immediately, so
 * only the LLM step waits its turn.
 */
export function createModelMutex(): { wrap(client: ModelClient): ModelClient } {
  const mutex = createMutex();
  return {
    wrap: (client) => ({ complete: (req) => mutex.run(() => client.complete(req)) }),
  };
}
