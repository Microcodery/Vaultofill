import { describe, it, expect, vi } from "vitest";
import { WebLlmModelClient, WebLlmChatEngine } from "../../../src/core/planner/webLlmModelClient";

type ChatParams = Parameters<WebLlmChatEngine["chatCompletion"]>[0];

function fakeEngine(reply: string) {
  const chatCompletion = vi.fn(async (_params: ChatParams): Promise<string> => reply);
  return { engine: { chatCompletion } as WebLlmChatEngine, chatCompletion };
}

describe("WebLlmModelClient", () => {
  it("prepends the system message and forwards the user messages", async () => {
    const { engine, chatCompletion } = fakeEngine('{"ok":true}');
    await new WebLlmModelClient(engine).complete({
      system: "you map fields",
      messages: [{ role: "user", content: "hi" }],
      supportsGrammar: false,
    });
    expect(chatCompletion.mock.calls[0]![0].messages).toEqual([
      { role: "system", content: "you map fields" },
      { role: "user", content: "hi" },
    ]);
  });

  it("defaults temperature to 0 and overrides it from opts", async () => {
    const a = fakeEngine("{}");
    await new WebLlmModelClient(a.engine).complete({ system: "s", messages: [], supportsGrammar: false });
    expect(a.chatCompletion.mock.calls[0]![0].temperature).toBe(0);

    const b = fakeEngine("{}");
    await new WebLlmModelClient(b.engine, { temperature: 0.7 }).complete({ system: "s", messages: [], supportsGrammar: false });
    expect(b.chatCompletion.mock.calls[0]![0].temperature).toBe(0.7);
  });

  it("decodes the engine's JSON reply into the typed result", async () => {
    const { engine } = fakeEngine('{"tool":"finish"}');
    const result = await new WebLlmModelClient(engine).complete<{ tool: string }>({ system: "s", messages: [], supportsGrammar: false });
    expect(result).toEqual({ tool: "finish" });
  });

  it("decodes a bare array reply (labeling shape)", async () => {
    const { engine } = fakeEngine('["EMAIL","PHONE"]');
    const result = await new WebLlmModelClient(engine).complete<string[]>({ system: "s", messages: [], supportsGrammar: false });
    expect(result).toEqual(["EMAIL", "PHONE"]);
  });
});
