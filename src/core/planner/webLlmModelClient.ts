import { ModelClient, CompletionRequest } from "./modelClient";
import { decodeJson } from "./jsonCodec";

/**
 * Minimal seam over a web-llm engine's OpenAI-style chat completion. The real
 * engine (@mlc-ai/web-llm) is browser + WebGPU only, so the client depends on
 * this interface instead — keeping the request-shaping/JSON-decoding logic
 * testable in Node with a fake engine.
 */
export interface WebLlmChatEngine {
  chatCompletion(params: {
    messages: { role: string; content: string }[];
    temperature: number;
  }): Promise<string>;
  /** Release the engine's resources (e.g. terminate its worker / free GPU VRAM).
   *  Optional so test fakes needn't implement it. */
  dispose?(): void;
}

/**
 * ModelClient backed by an on-device web-llm engine. Same port as the
 * OpenAI-compatible adapter, so the fill pipeline is agnostic to whether the
 * model runs in-browser (WebGPU) or behind an endpoint.
 */
export class WebLlmModelClient implements ModelClient {
  constructor(
    private readonly engine: WebLlmChatEngine,
    private readonly opts: { temperature?: number } = {},
  ) {}

  async complete<T>(req: CompletionRequest): Promise<T> {
    const messages = [{ role: "system", content: req.system }, ...req.messages];
    const text = await this.engine.chatCompletion({
      messages,
      temperature: this.opts.temperature ?? 0,
    });
    return decodeJson<T>(text);
  }
}
