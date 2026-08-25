import { describe, it, expect } from "vitest";
import { loadConfig, saveConfig } from "../../../src/ext/panel/panelConfig";
import { StorageArea } from "../../../src/ext/storage/storageArea";

function makeFakeStorageArea(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    async get(key: string) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(obj: Record<string, unknown>) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
  };
}

describe("panelConfig", () => {
  it("round-trips baseUrl, model, and apiKey", async () => {
    const storage = makeFakeStorageArea();
    await saveConfig(storage, { baseUrl: "https://llm.wildelab.com/api", model: "qwen3-coder", apiKey: "sk-abc" });

    const loaded = await loadConfig(storage);
    expect(loaded).toEqual({ baseUrl: "https://llm.wildelab.com/api", model: "qwen3-coder", apiKey: "sk-abc" });
  });

  it("round-trips an empty apiKey", async () => {
    const storage = makeFakeStorageArea();
    await saveConfig(storage, { baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiKey: "" });

    const loaded = await loadConfig(storage);
    expect(loaded).toEqual({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiKey: "" });
  });

  it("loadConfig returns empty defaults when nothing has been saved", async () => {
    const storage = makeFakeStorageArea();
    const loaded = await loadConfig(storage);
    expect(loaded).toEqual({ baseUrl: "", model: "", apiKey: "" });
  });

  it("loadConfig returns empty defaults when the stored value is malformed", async () => {
    const storage = makeFakeStorageArea();
    await storage.set({ "vaultofill:panelConfig": "not json" });
    const loaded = await loadConfig(storage);
    expect(loaded).toEqual({ baseUrl: "", model: "", apiKey: "" });
  });

  it("saveConfig does not clobber other keys in the same storage area", async () => {
    const storage = makeFakeStorageArea();
    await storage.set({ other: "keep-me" });
    await saveConfig(storage, { baseUrl: "http://x", model: "m", apiKey: "" });
    expect(await storage.get("other")).toEqual({ other: "keep-me" });
  });
});
