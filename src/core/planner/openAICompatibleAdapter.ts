import { ModelClient, CompletionRequest } from "./modelClient";
import { decodeJson } from "./jsonCodec";

type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class OpenAICompatibleAdapter implements ModelClient {
  constructor(private cfg: { baseUrl: string; model: string; apiKey?: string; temperature?: number; fetchFn?: FetchFn }) {}

  async complete<T>(req: CompletionRequest): Promise<T> {
    const f: FetchFn = this.cfg.fetchFn ?? ((url, init) => globalThis.fetch(url, init) as any);
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await f(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.cfg.model,
        stream: false,
        temperature: this.cfg.temperature,
        messages: [{ role: "system", content: req.system }, ...req.messages],
        ...(req.responseSchema
          ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: req.responseSchema } } }
          : {}),
      }),
    });
    if (!res.ok) throw new Error("model request failed: " + res.status);
    const body = await res.json();
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("no choices[0].message.content in response");
    return decodeJson<T>(content);
  }
}
