import { Vault } from "../../core/details/vault";
import { BrowserStorageBackend } from "./browserStorageBackend";

export interface VaultStore {
  loadVault(): Promise<Vault>;
  saveVault(vault: Vault): Promise<void>;
}

export const NATIVE_HOST = "com.vaultofill.host";

type SendNative = (msg: unknown) => Promise<any>;

interface NativeGetReply {
  ok: true;
  vault?: string | null;
}

// Lazily imported so this module (and its tests, which always inject a fake
// sendNative) can load under plain Node — webextension-polyfill throws at
// import time outside a real extension context.
const defaultSendNative: SendNative = async msg => {
  const { default: browser } = await import("webextension-polyfill");
  return browser.runtime.sendNativeMessage(NATIVE_HOST, msg);
};

/**
 * Talks to the native-messaging companion host, which owns the vault shared
 * across browsers. Whole-vault protocol: {op:"get"} -> {ok, vault}, and
 * {op:"set", vault} -> {ok}.
 */
export class NativeCompanionStore implements VaultStore {
  constructor(private readonly sendNative: SendNative = defaultSendNative) {}

  async loadVault(): Promise<Vault> {
    const reply = (await this.sendNative({ op: "get" })) as NativeGetReply;
    const vault = new Vault();
    if (typeof reply.vault === "string" && reply.vault.length > 0) vault.load(reply.vault);
    return vault;
  }

  async saveVault(vault: Vault): Promise<void> {
    await this.sendNative({ op: "set", vault: vault.serialize() });
  }
}

/** Falls back to browser.storage.local (via BrowserStorageBackend) when no native host is installed. */
export class LocalVaultStore implements VaultStore {
  constructor(private readonly backend: Pick<BrowserStorageBackend, "loadVault" | "saveVault">) {}

  loadVault(): Promise<Vault> {
    return this.backend.loadVault();
  }

  saveVault(vault: Vault): Promise<void> {
    return this.backend.saveVault(vault);
  }
}

export interface CreateVaultStoreOptions {
  sendNative?: SendNative;
  local: VaultStore;
}

/**
 * Probes for the native companion host and prefers it when present; falls
 * back to the given local store when the host isn't installed/registered
 * (sendNativeMessage rejects in that case).
 */
export async function createVaultStore(opts: CreateVaultStoreOptions): Promise<VaultStore> {
  const sendNative = opts.sendNative ?? defaultSendNative;
  try {
    await sendNative({ op: "get" });
    return new NativeCompanionStore(sendNative);
  } catch {
    return opts.local;
  }
}
