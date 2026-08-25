import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("webextension-polyfill", () => ({ default: { runtime: { sendMessage } } }));

import { OffscreenChatEngine } from "../../../src/ext/panel/offscreenModelClient";

describe("OffscreenChatEngine", () => {
  beforeEach(() => sendMessage.mockReset());

  it("sends a chat to the offscreen document and returns its text", async () => {
    sendMessage.mockResolvedValue({ text: "EMAIL" });
    const out = await new OffscreenChatEngine().chatCompletion({
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
    });
    expect(out).toBe("EMAIL");
    expect(sendMessage).toHaveBeenCalledWith({
      kind: "vof:offscreen:chat",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
    });
  });

  it("throws on an error reply", async () => {
    sendMessage.mockResolvedValue({ error: "boom" });
    await expect(new OffscreenChatEngine().chatCompletion({ messages: [], temperature: 0 })).rejects.toThrow("boom");
  });

  it("throws when there is no response (offscreen document absent)", async () => {
    sendMessage.mockResolvedValue(undefined);
    await expect(new OffscreenChatEngine().chatCompletion({ messages: [], temperature: 0 })).rejects.toThrow(/No response/);
  });
});
