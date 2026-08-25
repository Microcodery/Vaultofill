import browser from "webextension-polyfill";
import { createWebLlmEngine } from "../panel/webLlmEngine";
import { webGpuInfo } from "../panel/webGpu";
import { pickModelId } from "../panel/webLlmModels";
import type { WebLlmChatEngine } from "../../core/planner/webLlmModelClient";
import { ModelProgressMsg, OffscreenChatMsg, OffscreenChatReply, OffscreenStatusReply } from "./offscreenMessages";

// The offscreen document: a hidden DOM context (unlike the service worker, which
// has no `navigator.gpu`) that hosts the on-device WebGPU model so it can load
// and stay resident in the background, independent of the side panel. The panel
// sends chat completions here; progress is broadcast back for the panel's UI.

// The most recent progress, kept so the panel can pull the live state on open
// (it misses broadcasts fired before it was opened, e.g. a content-script warm).
let lastProgress: ModelProgressMsg | undefined;

function broadcast(status: ModelProgressMsg["status"], text: string, progress: number): void {
  lastProgress = { kind: "vof:modelProgress", status, text, progress };
  // No panel open → no receiver → sendMessage rejects; ignore.
  void browser.runtime.sendMessage(lastProgress).catch(() => {});
}

// Single in-flight/loaded engine, shared by every chat. Cleared on failure so a
// later warm/chat retries the load.
let enginePromise: Promise<WebLlmChatEngine> | undefined;
// State the panel can query on open (it may have missed the one-shot broadcast,
// e.g. the content script warmed the model before the panel was opened).
let engineReady = false;
let engineFailed = false;

async function loadEngine(): Promise<WebLlmChatEngine> {
  engineFailed = false; // retrying clears a prior failure
  const { available, shaderF16, adapter } = await webGpuInfo();
  if (!available) {
    // The panel's footer GPU diagnostic shows the flags to fix this; keep this brief.
    broadcast("unavailable", "On-device model unavailable — WebGPU isn't usable here.", 0);
    throw new Error("WebGPU unavailable in offscreen document");
  }
  // Surface the adapter (a software renderer like llvmpipe/lavapipe explains slow
  // compiles / freezes) before the long shader-compile phase begins.
  if (adapter) broadcast("loading", `Adapter: ${adapter}`, 0);
  const engine = await createWebLlmEngine(pickModelId(shaderF16), (text, progress) => broadcast("loading", text, progress));
  engineReady = true;
  broadcast("ready", "On-device model ready (loaded in the background).", 1);
  return engine;
}

function ensureEngine(): Promise<WebLlmChatEngine> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((err) => {
      enginePromise = undefined; // allow a later warm/chat to retry
      engineFailed = true;
      broadcast("error", String(err), 0);
      throw err;
    });
  }
  return enginePromise;
}

// Start loading as soon as the document is created — this is the background warm.
void ensureEngine().catch(() => {});

browser.runtime.onMessage.addListener((message: unknown): Promise<OffscreenChatReply | OffscreenStatusReply> | undefined => {
  const kind = (message as { kind?: string })?.kind;
  // Readiness probe: answer synchronously so the panel can tell if the model is
  // already loaded, or has failed (→ fall back to the endpoint immediately).
  if (kind === "vof:offscreen:status") {
    return Promise.resolve({ ready: engineReady, failed: engineFailed, lastProgress } satisfies OffscreenStatusReply);
  }
  // (Re)trigger a load — retries a prior failure. Fire-and-forget (no reply).
  if (kind === "vof:offscreen:warm") {
    void ensureEngine().catch(() => {});
    return undefined;
  }
  if (kind !== "vof:offscreen:chat") return undefined; // not ours
  const chat = message as OffscreenChatMsg;
  return (async () => {
    try {
      const engine = await ensureEngine();
      return { text: await engine.chatCompletion({ messages: chat.messages, temperature: chat.temperature }) };
    } catch (err) {
      return { error: String(err) };
    }
  })();
});
