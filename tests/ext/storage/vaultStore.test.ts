import { describe, it, expect, vi } from "vitest";
import {
  NativeCompanionStore,
  LocalVaultStore,
  createVaultStore,
  VaultStore,
} from "../../../src/ext/storage/vaultStore";
import { Vault } from "../../../src/core/details/vault";

function serializedVaultFixture(): string {
  const v = new Vault();
  v.set({ canonicalLabel: "FIRST_NAME", value: "Ada", aliases: [], sensitivity: "private", volatility: "stable" });
  return v.serialize();
}

describe("NativeCompanionStore", () => {
  it("loadVault builds a Vault from the native reply", async () => {
    const serialized = serializedVaultFixture();
    const sendNative = vi.fn().mockResolvedValue({ ok: true, vault: serialized });
    const store = new NativeCompanionStore(sendNative);

    const vault = await store.loadVault();

    expect(sendNative).toHaveBeenCalledWith({ op: "get" });
    expect(vault.findByLabel("FIRST_NAME")?.value).toBe("Ada");
    expect(vault.getByCanonical("FIRST_NAME")?.value).toBe("Ada");
  });

  it("loadVault returns an empty Vault when reply vault is null", async () => {
    const sendNative = vi.fn().mockResolvedValue({ ok: true, vault: null });
    const store = new NativeCompanionStore(sendNative);

    const vault = await store.loadVault();

    expect(vault.keys()).toEqual([]);
  });

  it("loadVault returns an empty Vault when reply vault is missing", async () => {
    const sendNative = vi.fn().mockResolvedValue({ ok: true });
    const store = new NativeCompanionStore(sendNative);

    const vault = await store.loadVault();

    expect(vault.keys()).toEqual([]);
  });

  it("saveVault sends the serialized vault as a set op", async () => {
    const sendNative = vi.fn().mockResolvedValue({ ok: true });
    const store = new NativeCompanionStore(sendNative);

    const vault = new Vault();
    vault.set({ canonicalLabel: "EMAIL", value: "ada@example.com", aliases: [], sensitivity: "private", volatility: "stable" });

    await store.saveVault(vault);

    expect(sendNative).toHaveBeenCalledWith({ op: "set", vault: vault.serialize() });
  });
});

function makeFakeLocalStore(): VaultStore & { loadVault: ReturnType<typeof vi.fn>; saveVault: ReturnType<typeof vi.fn> } {
  return {
    loadVault: vi.fn().mockResolvedValue(new Vault()),
    saveVault: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createVaultStore", () => {
  it("returns a native-backed store when the probe resolves", async () => {
    const sendNative = vi.fn().mockResolvedValue({ ok: true, vault: null });
    const local = makeFakeLocalStore();

    const store = await createVaultStore({ sendNative, local });

    const vault = new Vault();
    await store.saveVault(vault);

    expect(sendNative).toHaveBeenCalledWith({ op: "set", vault: vault.serialize() });
    expect(local.saveVault).not.toHaveBeenCalled();
  });

  it("returns the local store when the probe rejects", async () => {
    const sendNative = vi.fn().mockRejectedValue(new Error("no native host"));
    const local = makeFakeLocalStore();

    const store = await createVaultStore({ sendNative, local });

    const vault = new Vault();
    await store.saveVault(vault);

    expect(local.saveVault).toHaveBeenCalledWith(vault);
    expect(sendNative).toHaveBeenCalledTimes(1);
    expect(sendNative).toHaveBeenCalledWith({ op: "get" });
  });
});

describe("LocalVaultStore", () => {
  it("delegates loadVault/saveVault to the wrapped backend", async () => {
    const backend = {
      loadVault: vi.fn().mockResolvedValue(new Vault()),
      saveVault: vi.fn().mockResolvedValue(undefined),
    };
    const store = new LocalVaultStore(backend as any);

    const vault = new Vault();
    await store.saveVault(vault);
    await store.loadVault();

    expect(backend.saveVault).toHaveBeenCalledWith(vault);
    expect(backend.loadVault).toHaveBeenCalled();
  });
});
