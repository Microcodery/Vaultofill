import browser from "webextension-polyfill";
import {
  CreateWebWorkerMLCEngine,
  type MLCEngineInterface,
  type InitProgressReport,
} from "@mlc-ai/web-llm";
import type { WebLlmChatEngine } from "../../core/planner/webLlmModelClient";

// Hard cap on generated tokens. Labeling replies are a short JSON array, so this
// is ample — but it's really a safety rail: unbounded on-device generation pegs
// the GPU, and since Chrome's UI shares the GPU process, that freezes the browser.
const MAX_TOKENS = 512;

/**
 * Load an on-device web-llm model into a bundled static worker and adapt it to
 * the WebLlmChatEngine seam. First load downloads the model weights (cached by
 * web-llm for subsequent runs). `onProgress` reports download/compile progress.
 */
export async function createWebLlmEngine(
  modelId: string,
  onProgress?: (text: string, progress: number) => void,
): Promise<WebLlmChatEngine> {
  const worker = new Worker(browser.runtime.getURL("webllm-worker.js"), { type: "module" });
  let engine: MLCEngineInterface;
  try {
    engine = await CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: onProgress ? (r: InitProgressReport) => onProgress(r.text, r.progress) : undefined,
    });
  } catch (err) {
    worker.terminate(); // don't leak the worker (GPU/module context) on a failed load
    throw err;
  }

  // Warm up while the loading UI is still shown. The first inference otherwise
  // lazily compiles every WebGPU compute pipeline (WGSL → driver) — slow,
  // especially on Linux drivers (the "hangs for minutes on first fill" symptom).
  // A throwaway 2-token, temperature-0 generation compiles the prefill AND decode
  // pipelines now, matching the real argmax path, so the first real fill is fast.
  // Best-effort: a warm-up failure must not deny an otherwise-usable engine —
  // the first real inference just compiles lazily instead.
  onProgress?.("Compiling shaders (first load only — can take a minute)…", 0.99);
  try {
    await engine.chat.completions.create({
      messages: [{ role: "system", content: "" }, { role: "user", content: "hi" }],
      temperature: 0,
      max_tokens: 2,
      stream: false,
    });
  } catch {
    /* lazily compiled on first real use instead */
  }

  // The side panel's document can be destroyed at any time (user closes it).
  // Tearing that down while the worker holds a live GPU device — especially mid
  // inference — can crash Chrome's GPU process (and the whole browser). Terminate
  // the worker on unload so its GPU context is released before the document dies.
  let terminated = false;
  const dispose = (): void => {
    if (terminated) return; // terminate() is idempotent, but guard anyway
    terminated = true;
    worker.terminate();
  };
  if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
    self.addEventListener("pagehide", dispose, { once: true });
  }

  type CreateParams = Parameters<typeof engine.chat.completions.create>[0];
  const complete = async (params: CreateParams): Promise<string> => {
    const res = await engine.chat.completions.create(params);
    return "choices" in res ? (res.choices[0]?.message?.content ?? "") : "";
  };

  return {
    dispose,
    async chatCompletion({ messages, temperature }) {
      // Deliberately no response_format: constrained decoding over our top-level
      // array schema pegged the GPU (runaway/pathological generation) and froze
      // the browser. The prompt asks for a JSON array and sanitize() coerces the
      // reply, so we rely on that plus the token cap to keep generation bounded.
      return complete({
        messages: messages as CreateParams["messages"],
        temperature,
        stream: false as const,
        max_tokens: MAX_TOKENS,
      });
    },
  };
}
