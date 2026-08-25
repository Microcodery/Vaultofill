import { describe, it, expect, vi } from "vitest";
import { ensureContentScript } from "../../../src/ext/panel/ensureContentScript";

describe("ensureContentScript", () => {
  it("returns without injecting when the ping succeeds", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const executeScript = vi.fn().mockResolvedValue(undefined);

    await ensureContentScript(7, { sendMessage, executeScript });

    expect(sendMessage).toHaveBeenCalledWith(7, { action: "ping" });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("injects the content script when the ping fails", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    const executeScript = vi.fn().mockResolvedValue(undefined);

    await ensureContentScript(7, { sendMessage, executeScript });

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content/contentScript.js"],
    });
  });

  it("throws a friendly error when ping and injection both fail", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
    const executeScript = vi.fn().mockRejectedValue(new Error("Cannot access a chrome:// URL"));

    await expect(ensureContentScript(7, { sendMessage, executeScript })).rejects.toThrow(
      "can't run on this page",
    );
  });
});
