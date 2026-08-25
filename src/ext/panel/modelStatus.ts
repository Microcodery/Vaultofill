import { ModelProgressMsg, OffscreenStatusReply } from "../offscreen/offscreenMessages";

/**
 * Decide what a panel opening mid-warm should paint from the offscreen model's
 * status probe. `ready`/`failed` are authoritative; `lastProgress` is trusted
 * only for the live loading %. This is what keeps a stale "error" left over from
 * a failure that's already retrying (so `failed` is back to false) from being
 * painted as an error — which would wrongly latch the fill onto the endpoint.
 * Returns the message to render, or undefined to keep the "warming…" placeholder
 * (still starting, no live progress yet).
 */
export function pickOpenProgress(status: OffscreenStatusReply): ModelProgressMsg | undefined {
  if (status.ready) return { kind: "vof:modelProgress", status: "ready", text: "", progress: 1 };
  if (status.failed) return status.lastProgress; // genuine current failure (error/unavailable)
  if (status.lastProgress?.status === "loading") return status.lastProgress;
  return undefined;
}
