// Static, bundled web-llm worker. Loaded from a packaged extension URL
// (script-src 'self'), NOT a blob: URL — which is what lets on-device inference
// clear the MV3 CSP on Chrome and Firefox alike. The heavy WebGPU/TVM runtime
// lives here, off the panel's main thread.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
