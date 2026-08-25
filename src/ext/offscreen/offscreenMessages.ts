// Message protocol between the panel, the service worker, and the offscreen
// document. `browser.runtime.sendMessage` broadcasts to every extension context,
// so each message carries a `kind` discriminant and each context's listener
// handles only its own kinds (returning undefined for the rest, so it doesn't
// claim another context's message/response).

/** Extension-relative URL of the offscreen document (created by the SW). */
export const OFFSCREEN_URL = "offscreen.html";

/** Content script → SW: this tab looks form-heavy; warm the model in the
 *  background (create the offscreen document if needed). Fire-and-forget. */
export interface WarmModelMsg {
  kind: "vof:warmModel";
}

/** Panel → SW: ensure a model backend is ready and tell me which one to use.
 *  Chrome resolves to "offscreen" (background document); Firefox, which has no
 *  offscreen API, resolves to "local" (the panel loads the model itself). */
export interface PrepareModelMsg {
  kind: "vof:prepareModel";
}
export interface PrepareModelReply {
  backend: "offscreen" | "local";
}

/** Panel → offscreen document: run one chat completion. */
export interface OffscreenChatMsg {
  kind: "vof:offscreen:chat";
  messages: { role: string; content: string }[];
  temperature: number;
}
export interface OffscreenChatReply {
  text?: string;
  error?: string;
}

/** Panel → offscreen document: is the model already loaded (or has loading
 *  failed)? Lets the panel learn state on open when it missed the one-shot
 *  "ready"/"error" broadcast. */
export interface OffscreenStatusMsg {
  kind: "vof:offscreen:status";
}
export interface OffscreenStatusReply {
  ready: boolean;
  failed: boolean;
  // The most recent progress broadcast, so a panel opening mid-load can render
  // the live progress immediately instead of a static "warming…" placeholder
  // (it missed the earlier broadcasts, which fired before it opened).
  lastProgress?: ModelProgressMsg;
}

/** SW → offscreen document: (re)trigger the model load. Sent on each warm so a
 *  load that failed the first time (network blip, transient device loss) retries
 *  rather than staying failed for the whole session. */
export interface OffscreenWarmMsg {
  kind: "vof:offscreen:warm";
}

/** Offscreen document → panel (broadcast): model load/inference status, so the
 *  panel can show progress and know when the background model is usable. */
export interface ModelProgressMsg {
  kind: "vof:modelProgress";
  status: "loading" | "ready" | "error" | "unavailable";
  text: string;
  progress: number; // 0..1
}

export function isModelProgress(m: unknown): m is ModelProgressMsg {
  return (m as { kind?: string })?.kind === "vof:modelProgress";
}
