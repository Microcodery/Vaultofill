import { describe, it, expect } from "vitest";
import { BrowserStorageBackend } from "../../../src/ext/storage/browserStorageBackend";
import { StorageArea } from "../../../src/ext/storage/storageArea";
import { Vault } from "../../../src/core/details/vault";
import { ActiveContext } from "../../../src/core/details/activeContext";
import { Detail } from "../../../src/core/types";

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

const D = (canonicalLabel: string, value: string, aliases: string[] = []): Detail => ({
  canonicalLabel,
  value,
  aliases,
  sensitivity: "private",
  volatility: "stable",
});

describe("BrowserStorageBackend", () => {
  it("round-trips a Vault with a couple of Details, including aliases", async () => {
    const vault = new Vault();
    vault.set(D("FIRST_NAME", "Ada", ["forename", "given name"]));
    vault.set(D("EMAIL", "ada@example.com"));

    const backend = new BrowserStorageBackend(makeFakeStorageArea());
    await backend.saveVault(vault);

    const loaded = await backend.loadVault();
    expect(loaded.getByCanonical("FIRST_NAME")).toMatchObject({ value: "Ada", aliases: ["forename", "given name"] });
    expect(loaded.getByCanonical("EMAIL")).toMatchObject({ value: "ada@example.com" });
    expect(loaded.findByLabel("Forename")?.value).toBe("Ada");
  });

  it("loadVault returns an empty Vault when nothing has been saved", async () => {
    const backend = new BrowserStorageBackend(makeFakeStorageArea());
    const loaded = await backend.loadVault();
    expect(loaded.keys()).toEqual([]);
  });

  it("round-trips an ActiveContext with volatile and ephemeral details", async () => {
    const ctx = new ActiveContext();
    ctx.set("goal", { canonicalLabel: "goal", value: "book room", aliases: [], sensitivity: "private", volatility: "volatile" });
    ctx.set("checkIn", { canonicalLabel: "checkIn", value: "2026-07-16", aliases: [], sensitivity: "private", volatility: "ephemeral" });

    const backend = new BrowserStorageBackend(makeFakeStorageArea());
    await backend.saveActiveContext(ctx);

    const loaded = await backend.loadActiveContext();
    expect(loaded.get("goal")?.value).toBe("book room");
    expect(loaded.get("checkIn")).toMatchObject({ value: "2026-07-16", volatility: "ephemeral" });
  });

  it("loadActiveContext returns an empty ActiveContext when nothing has been saved", async () => {
    const backend = new BrowserStorageBackend(makeFakeStorageArea());
    const loaded = await backend.loadActiveContext();
    expect(loaded.keys()).toEqual([]);
  });

  it("preserves a corrupt vault blob under a backup key instead of silently clobbering it", async () => {
    const area = makeFakeStorageArea();
    await area.set({ "vaultofill:vault": "{not json" }); // a corrupt blob already in storage
    const backend = new BrowserStorageBackend(area);

    const loaded = await backend.loadVault();
    expect(loaded.keys()).toEqual([]); // degraded to empty (didn't throw)
    // The raw blob is kept, so a later saveVault(empty) can't destroy the recoverable data.
    expect((await area.get("vaultofill:vault:corrupt"))["vaultofill:vault:corrupt"]).toBe("{not json");
  });

  it("saveVault does not clobber other keys in the same storage area", async () => {
    const area = makeFakeStorageArea();
    const backend = new BrowserStorageBackend(area);
    const ctx = new ActiveContext();
    ctx.set("goal", { canonicalLabel: "goal", value: "book room", aliases: [], sensitivity: "private", volatility: "volatile" });
    await backend.saveActiveContext(ctx);

    const vault = new Vault();
    vault.set(D("FIRST_NAME", "Ada"));
    await backend.saveVault(vault);

    expect((await backend.loadActiveContext()).get("goal")?.value).toBe("book room");
    expect((await backend.loadVault()).getByCanonical("FIRST_NAME")?.value).toBe("Ada");
  });
});
