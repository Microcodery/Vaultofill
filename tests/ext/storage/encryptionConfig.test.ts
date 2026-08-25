import { describe, it, expect } from "vitest";
import { loadEncryptionConfig, saveEncryptionConfig, defaultEncryptionConfig } from "../../../src/ext/storage/encryptionConfig";
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

describe("encryptionConfig", () => {
  it("round-trips enabled + unlock mode", async () => {
    const storage = makeFakeStorageArea();
    await saveEncryptionConfig(storage, { enabled: true, unlock: "always" });
    expect(await loadEncryptionConfig(storage)).toEqual({ enabled: true, unlock: "always" });
  });

  it("defaults to disabled/session when nothing is saved", async () => {
    expect(await loadEncryptionConfig(makeFakeStorageArea())).toEqual(defaultEncryptionConfig());
    expect(defaultEncryptionConfig()).toEqual({ enabled: false, unlock: "session" });
  });

  it("degrades to defaults on a malformed value", async () => {
    const storage = makeFakeStorageArea();
    await storage.set({ "vaultofill:encryptionConfig": "not json" });
    expect(await loadEncryptionConfig(storage)).toEqual(defaultEncryptionConfig());
  });

  it("coerces unknown/invalid fields to safe defaults", async () => {
    const storage = makeFakeStorageArea();
    await storage.set({ "vaultofill:encryptionConfig": JSON.stringify({ enabled: "yes", unlock: "weekly" }) });
    // enabled must be a real boolean; an unknown unlock mode falls back to "session".
    expect(await loadEncryptionConfig(storage)).toEqual({ enabled: false, unlock: "session" });
  });

  it("does not clobber other keys in the same storage area", async () => {
    const storage = makeFakeStorageArea();
    await storage.set({ other: "keep-me" });
    await saveEncryptionConfig(storage, { enabled: true, unlock: "session" });
    expect(await storage.get("other")).toEqual({ other: "keep-me" });
  });
});
