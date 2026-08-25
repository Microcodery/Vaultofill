import { describe, it, expect } from "vitest";
import { OpenAICompatibleAdapter } from "../../../src/core/planner/openAICompatibleAdapter";

describe("OpenAICompatibleAdapter", () => {
  it("posts to <baseUrl>/chat/completions when baseUrl has no trailing slash", async () => {
    let calledUrl = "";
    const fetchFn = async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://host:1234/v1", model: "m", fetchFn });
    await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(calledUrl).toBe("http://host:1234/v1/chat/completions");
  });

  it("posts to <baseUrl>/chat/completions when baseUrl has a trailing slash (no double slash)", async () => {
    let calledUrl = "";
    const fetchFn = async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://host:1234/v1/", model: "m", fetchFn });
    await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(calledUrl).toBe("http://host:1234/v1/chat/completions");
  });

  it("sends Authorization: Bearer <key> when apiKey is given", async () => {
    let capturedInit: any;
    const fetchFn = async (_url: string, init?: any) => {
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", apiKey: "sk-123", fetchFn });
    await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(capturedInit.headers.Authorization).toBe("Bearer sk-123");
  });

  it("sends no Authorization header when apiKey is omitted", async () => {
    let capturedInit: any;
    const fetchFn = async (_url: string, init?: any) => {
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn });
    await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(capturedInit.headers.Authorization).toBeUndefined();
  });

  it("sends no Authorization header when apiKey is an empty string", async () => {
    let capturedInit: any;
    const fetchFn = async (_url: string, init?: any) => {
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", apiKey: "", fetchFn });
    await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(capturedInit.headers.Authorization).toBeUndefined();
  });

  it("sends a body with model, stream:false, and the system message first", async () => {
    let capturedInit: any;
    const fetchFn = async (_url: string, init?: any) => {
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }) };
    };
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "gpt-test", fetchFn });
    await a.complete<{ tool: string }>({
      system: "be helpful",
      messages: [{ role: "user", content: "hi" }],
      supportsGrammar: false,
    });
    const body = JSON.parse(capturedInit.body);
    expect(body.model).toBe("gpt-test");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("parses choices[0].message.content through decodeJson and returns the typed object", async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"tool":"finish"}' } }] }),
    });
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn });
    const result = await a.complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(result).toEqual({ tool: "finish" });
  });

  it("throws with the status code in the message when !res.ok", async () => {
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn });
    await expect(
      a.complete<unknown>({ system: "s", messages: [], supportsGrammar: false })
    ).rejects.toThrow("503");
  });

  it("throws when the response has no choices[0].message.content", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });
    const a = new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn });
    await expect(
      a.complete<unknown>({ system: "s", messages: [], supportsGrammar: false })
    ).rejects.toThrow("no choices");
  });

  it("includes temperature when set and omits it otherwise", async () => {
    let init: any;
    const fetchFn = async (_url: string, i?: any) => {
      init = i;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "[]" } }] }) };
    };
    await new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", temperature: 0, fetchFn }).complete<unknown>({ system: "s", messages: [], supportsGrammar: false });
    expect(JSON.parse(init.body).temperature).toBe(0);
    await new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn }).complete<unknown>({ system: "s", messages: [], supportsGrammar: false });
    expect("temperature" in JSON.parse(init.body)).toBe(false);
  });

  it("includes response_format json_schema when responseSchema is set and omits it otherwise", async () => {
    let init: any;
    const fetchFn = async (_url: string, i?: any) => {
      init = i;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "[]" } }] }) };
    };
    const schema = { type: "array" };
    await new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn }).complete<unknown>({ system: "s", messages: [], supportsGrammar: false, responseSchema: schema });
    const withSchema = JSON.parse(init.body);
    expect(withSchema.response_format.type).toBe("json_schema");
    expect(withSchema.response_format.json_schema.schema).toEqual(schema);
    await new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m", fetchFn }).complete<unknown>({ system: "s", messages: [], supportsGrammar: false });
    expect("response_format" in JSON.parse(init.body)).toBe(false);
  });

  it("constructs with default fetch without throwing", () => {
    expect(() => new OpenAICompatibleAdapter({ baseUrl: "http://x", model: "m" })).not.toThrow();
  });
});
