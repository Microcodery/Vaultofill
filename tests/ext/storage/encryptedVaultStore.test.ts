import { describe, it, expect, vi } from "vitest";
import {
  EncryptedVaultStore,
  EncryptionConfigStore,
  PasswordPrompt,
  SessionKeyStore,
  VaultLockedError,
} from "../../../src/ext/storage/encryptedVaultStore";
import { BrowserStorageBackend } from "../../../src/ext/storage/browserStorageBackend";
import { StorageArea } from "../../../src/ext/storage/storageArea";
import { LocalVaultStore } from "../../../src/ext/storage/vaultStore";
import { Vault } from "../../../src/core/details/vault";
import { EncryptionConfig } from "../../../src/ext/storage/encryptionConfig";
import { deriveKey, encrypt, exportDerivedKey, isEncrypted, randomSalt } from "../../../src/core/crypto/vaultCipher";
import { Detail } from "../../../src/core/types";

const CORRUPT_KEY = "vaultofill:vault:corrupt";

const VAULT_KEY = "vaultofill:vault";
const PASSWORD = "correct horse battery";

function makeFakeStorageArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(obj: Record<string, unknown>) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
  };
}

function makeConfigStore(initial: EncryptionConfig): EncryptionConfigStore & { cfg: EncryptionConfig } {
  const box = { cfg: { ...initial } };
  return {
    get cfg() {
      return box.cfg;
    },
    async load() {
      return { ...box.cfg };
    },
    async save(cfg: EncryptionConfig) {
      box.cfg = { ...cfg };
    },
  };
}

function makeSessionStore(): SessionKeyStore & { count: () => number } {
  let bytes: import("../../../src/core/crypto/vaultCipher").DerivedKeyBytes | null = null;
  let sets = 0;
  return {
    count: () => sets,
    async get() {
      return bytes;
    },
    async set(b) {
      bytes = b;
      sets++;
    },
    async clear() {
      bytes = null;
    },
  };
}

/** A no-op session store — models storage.session being unavailable (old FF). */
function makeNoopSessionStore(): SessionKeyStore {
  return { async get() { return null; }, async set() {}, async clear() {} };
}

const D = (canonicalLabel: string, value: string): Detail => ({
  canonicalLabel,
  value,
  aliases: [],
  sensitivity: "private",
  volatility: "stable",
});

function scriptedPrompt(...answers: (string | null)[]): PasswordPrompt & { calls: number } {
  const state = { i: 0 };
  const fn = (): Promise<string | null> => {
    const a = state.i < answers.length ? answers[state.i] : null;
    state.i++;
    return Promise.resolve(a ?? null);
  };
  Object.defineProperty(fn, "calls", { get: () => state.i });
  return fn as unknown as PasswordPrompt & { calls: number };
}

interface Harness {
  area: ReturnType<typeof makeFakeStorageArea>;
  store: EncryptedVaultStore;
  config: ReturnType<typeof makeConfigStore>;
  session: ReturnType<typeof makeSessionStore>;
}

function makeStore(opts: {
  config?: EncryptionConfig;
  prompt?: PasswordPrompt;
  session?: SessionKeyStore & { count?: () => number };
  area?: ReturnType<typeof makeFakeStorageArea>;
} = {}): Harness {
  const area = opts.area ?? makeFakeStorageArea();
  const backend = new BrowserStorageBackend(area);
  const inner = new LocalVaultStore(backend);
  const config = makeConfigStore(opts.config ?? { enabled: false, unlock: "session" });
  const session = (opts.session as ReturnType<typeof makeSessionStore>) ?? makeSessionStore();
  const store = new EncryptedVaultStore({
    inner,
    raw: backend,
    config,
    prompt: opts.prompt ?? scriptedPrompt(PASSWORD),
    session,
    minPasswordLength: 8,
  });
  return { area, store, config, session };
}

describe("EncryptedVaultStore", () => {
  it("passes through plaintext when encryption is disabled", async () => {
    const { area, store } = makeStore();
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await store.saveVault(vault);

    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(false);
    expect((await store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
  });

  it("enableEncryption encrypts the blob at rest and load decrypts it", async () => {
    const { area, store, config } = makeStore();
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await store.enableEncryption(vault, PASSWORD, "session");

    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(true);
    expect(config.cfg).toEqual({ enabled: true, unlock: "session" });
    expect((await store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
  });

  it("saveVault re-encrypts under a stable salt (fresh IV each time)", async () => {
    const { area, store } = makeStore();
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await store.enableEncryption(vault, PASSWORD, "session");
    const first = JSON.parse(area.data.get(VAULT_KEY) as string);

    vault.set(D("PHONE", "555"));
    await store.saveVault(vault);
    const second = JSON.parse(area.data.get(VAULT_KEY) as string);

    expect(second.salt).toBe(first.salt); // stable salt → same derived key reusable
    expect(second.iv).not.toBe(first.iv); // fresh IV per encryption
    expect((await store.loadVault()).getByCanonical("PHONE")?.value).toBe("555");
  });

  it('rejects enabling with a too-short password', async () => {
    const { store } = makeStore();
    await expect(store.enableEncryption(new Vault(), "short", "session")).rejects.toThrow(/at least 8/);
  });

  it("session mode: reuses the cached key across a new store instance (no re-prompt)", async () => {
    const area = makeFakeStorageArea();
    const session = makeSessionStore();
    const first = makeStore({ area, session });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(vault, PASSWORD, "session");

    // A fresh store instance (panel reopen) with the SAME session store must not prompt.
    const prompt = scriptedPrompt(); // no answers — a call would return null → locked
    const reopened = makeStore({ area, session, config: { enabled: true, unlock: "session" }, prompt });
    expect((await reopened.store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(prompt.calls).toBe(0);
  });

  it("always mode: never caches to session and prompts on a fresh instance", async () => {
    const area = makeFakeStorageArea();
    const session = makeSessionStore();
    const first = makeStore({ area, session });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(vault, PASSWORD, "always");
    expect(session.count()).toBe(0); // always mode does not persist the key

    const prompt = scriptedPrompt(PASSWORD);
    const reopened = makeStore({ area, session, config: { enabled: true, unlock: "always" }, prompt });
    expect((await reopened.store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(prompt.calls).toBe(1);
    expect(session.count()).toBe(0);
  });

  it("re-prompts on a wrong password, then unlocks", async () => {
    const area = makeFakeStorageArea();
    const first = makeStore({ area });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(vault, PASSWORD, "always");

    const prompt = scriptedPrompt("nope", "still-wrong", PASSWORD);
    const reopened = makeStore({ area, config: { enabled: true, unlock: "always" }, prompt });
    expect((await reopened.store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(prompt.calls).toBe(3);
  });

  it("throws VaultLockedError when the user cancels the unlock prompt", async () => {
    const area = makeFakeStorageArea();
    const first = makeStore({ area });
    await first.store.enableEncryption(new Vault(), PASSWORD, "always");

    const prompt = scriptedPrompt(null); // cancel
    const reopened = makeStore({ area, config: { enabled: true, unlock: "always" }, prompt });
    await expect(reopened.store.loadVault()).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("no-clobber: saveVault refuses to overwrite the ciphertext while locked", async () => {
    const area = makeFakeStorageArea();
    const first = makeStore({ area });
    const original = new Vault();
    original.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(original, PASSWORD, "always");
    const ciphertextBefore = area.data.get(VAULT_KEY) as string;

    // A fresh (locked) instance that cancels the prompt must not write plaintext.
    const prompt = scriptedPrompt(null);
    const locked = makeStore({ area, config: { enabled: true, unlock: "always" }, prompt });
    const empty = new Vault();
    await expect(locked.store.saveVault(empty)).rejects.toBeInstanceOf(VaultLockedError);

    expect(area.data.get(VAULT_KEY)).toBe(ciphertextBefore); // untouched
    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(true);
  });

  it("disableEncryption decrypts and re-saves plaintext with the right password", async () => {
    const area = makeFakeStorageArea();
    const { store, config, session } = makeStore({ area });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await store.enableEncryption(vault, PASSWORD, "session");

    const restored = await store.disableEncryption(PASSWORD);
    expect(restored.getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(false);
    expect(config.cfg.enabled).toBe(false);
    expect(await session.get()).toBeNull(); // cached key cleared
  });

  it("disableEncryption throws on a wrong password and leaves the ciphertext intact", async () => {
    const area = makeFakeStorageArea();
    const { store } = makeStore({ area });
    await store.enableEncryption(new Vault(), PASSWORD, "session");
    const before = area.data.get(VAULT_KEY);

    await expect(store.disableEncryption("wrong-password")).rejects.toThrow();
    expect(area.data.get(VAULT_KEY)).toBe(before);
    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(true);
  });

  it("setUnlockMode switches frequency with no password, managing the session cache", async () => {
    const area = makeFakeStorageArea();
    const session = makeSessionStore();
    const { store, config } = makeStore({ area, session });
    await store.enableEncryption(new Vault(), PASSWORD, "session");
    expect(await session.get()).not.toBeNull(); // cached on enable

    await store.setUnlockMode("always");
    expect(config.cfg).toEqual({ enabled: true, unlock: "always" });
    expect(await session.get()).toBeNull(); // "always" never persists the key

    await store.setUnlockMode("session");
    expect(config.cfg.unlock).toBe("session");
    expect(await session.get()).not.toBeNull(); // re-cached from the in-memory key
  });

  it("never downgrades an on-disk envelope to plaintext, even if config wrongly says disabled (torn enable)", async () => {
    const area = makeFakeStorageArea();
    const { store, config } = makeStore({ area, config: { enabled: false, unlock: "session" }, prompt: scriptedPrompt(PASSWORD) });
    // Torn enable: an envelope on disk but config still says disabled.
    const key = await deriveKey(PASSWORD, randomSalt());
    area.data.set(VAULT_KEY, await encrypt(JSON.stringify([]), key));

    const v = await store.loadVault(); // unlocks + reconciles the config
    expect(v.keys()).toEqual([]);
    expect(config.cfg.enabled).toBe(true);

    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await store.saveVault(vault);
    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(true); // stayed encrypted
  });

  it("heals the config after a torn disable (plaintext on disk but config still enabled)", async () => {
    const area = makeFakeStorageArea();
    const { store, config } = makeStore({ area, config: { enabled: true, unlock: "session" } });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    area.data.set(VAULT_KEY, vault.serialize()); // plaintext blob, but config says enabled

    const loaded = await store.loadVault();
    expect(loaded.getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(config.cfg.enabled).toBe(false); // reconciled → saves aren't locked out

    await store.saveVault(loaded); // must succeed and stay plaintext
    expect(isEncrypted(area.data.get(VAULT_KEY) as string)).toBe(false);
  });

  it("backs up the recoverable envelope when a decrypted vault drops records", async () => {
    const area = makeFakeStorageArea();
    const session = makeSessionStore();
    const key = await deriveKey(PASSWORD, randomSalt());
    // Plaintext with one vault-invalid record (ephemeral in the vault) → load drops it.
    const plaintext = JSON.stringify([
      { canonicalLabel: "EMAIL", value: "a@b.com", aliases: [], sensitivity: "private", volatility: "stable" },
      { canonicalLabel: "BAD", value: "x", aliases: [], sensitivity: "private", volatility: "ephemeral" },
    ]);
    area.data.set(VAULT_KEY, await encrypt(plaintext, key));
    await session.set(await exportDerivedKey(key)); // unlock via cache, no prompt

    const { store } = makeStore({ area, session, config: { enabled: true, unlock: "session" } });
    const v = await store.loadVault();
    expect(v.keys()).toEqual(["EMAIL"]); // valid record kept
    // The still-encrypted envelope is preserved so demo-seeding can't clobber it.
    const backup = area.data.get(CORRUPT_KEY);
    expect(typeof backup).toBe("string");
    expect(isEncrypted(backup as string)).toBe(true);
  });

  it("a corrupt iteration count locks (cancel) rather than crashing PBKDF2", async () => {
    const area = makeFakeStorageArea();
    const key = await deriveKey(PASSWORD, randomSalt());
    const envelope = JSON.parse(await encrypt(JSON.stringify([]), key)) as Record<string, unknown>;
    envelope.iter = 0; // hostile/corrupt — would throw OperationError unclamped
    area.data.set(VAULT_KEY, JSON.stringify(envelope));
    const { store } = makeStore({ area, config: { enabled: true, unlock: "always" }, prompt: scriptedPrompt(null) });
    // Recognized as encrypted (no plaintext clobber); a cancelled prompt → locked,
    // NOT an uncaught crypto error.
    await expect(store.loadVault()).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("session mode degrades to prompting when session storage is unavailable", async () => {
    const area = makeFakeStorageArea();
    const first = makeStore({ area, session: makeNoopSessionStore() as ReturnType<typeof makeSessionStore> });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(vault, PASSWORD, "session");

    // No-op session store can't cache → a fresh instance must prompt even in session mode.
    const prompt = scriptedPrompt(PASSWORD);
    const reopened = makeStore({
      area,
      config: { enabled: true, unlock: "session" },
      prompt,
      session: makeNoopSessionStore() as ReturnType<typeof makeSessionStore>,
    });
    expect((await reopened.store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(prompt.calls).toBe(1);
  });

  it("recovers from a stale session-cached key by re-prompting", async () => {
    const area = makeFakeStorageArea();
    const session = makeSessionStore();
    // Seed a bogus cached key so importDerivedKey succeeds but verify fails.
    const first = makeStore({ area, session });
    const vault = new Vault();
    vault.set(D("EMAIL", "a@b.com"));
    await first.store.enableEncryption(vault, PASSWORD, "session");
    // Corrupt the cached key bytes to a different valid-length key.
    await session.set({ ...(await session.get())!, key: btoa("x".repeat(32)) });

    const prompt = scriptedPrompt(PASSWORD);
    const reopened = makeStore({ area, session, config: { enabled: true, unlock: "session" }, prompt });
    expect((await reopened.store.loadVault()).getByCanonical("EMAIL")?.value).toBe("a@b.com");
    expect(prompt.calls).toBe(1); // stale cache dropped → prompted once
  });
});
