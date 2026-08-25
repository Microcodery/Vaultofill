import { Vault } from "../../core/details/vault";
import {
  DerivedKey,
  DerivedKeyBytes,
  decodeEnvelope,
  decrypt,
  deriveKey,
  encrypt,
  exportDerivedKey,
  importDerivedKey,
  isEncrypted,
  randomSalt,
} from "../../core/crypto/vaultCipher";
import { VaultStore } from "./vaultStore";
import { RawVaultStore } from "./browserStorageBackend";
import { StorageArea } from "./storageArea";
import { EncryptionConfig } from "./encryptionConfig";

const SESSION_KEY = "vaultofill:sessionKey";

function isDerivedKeyBytes(v: unknown): v is DerivedKeyBytes {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as DerivedKeyBytes).key === "string" &&
    typeof (v as DerivedKeyBytes).salt === "string" &&
    typeof (v as DerivedKeyBytes).iter === "number"
  );
}

/** A SessionKeyStore backed by browser.storage.session (see the interface's doc
 *  for the tradeoff). Pass `undefined` when session storage is unavailable (old
 *  Firefox MV3): the returned store is a no-op, so "session" unlock degrades to
 *  prompting once per panel open — the key never persists anywhere. */
export function createSessionKeyStore(area: StorageArea | undefined): SessionKeyStore {
  if (!area) return { async get() { return null; }, async set() {}, async clear() {} };
  return {
    async get() {
      const stored = await area.get(SESSION_KEY);
      const v = stored[SESSION_KEY];
      return isDerivedKeyBytes(v) ? v : null;
    },
    async set(bytes) {
      await area.set({ [SESSION_KEY]: bytes });
    },
    async clear() {
      await area.set({ [SESSION_KEY]: null });
    },
  };
}

/** The stored vault is encrypted and no usable key is available (the user
 *  cancelled the unlock prompt, or storage.session was cleared). The panel shows
 *  a locked state and must NOT save a plaintext vault over the encrypted blob. */
export class VaultLockedError extends Error {
  constructor() {
    super("vault is locked");
    this.name = "VaultLockedError";
  }
}

/** The supplied password could not decrypt the vault (GCM auth failure). Distinct
 *  from the corrupt-JSON path — the blob decrypts to nothing, it isn't malformed
 *  storage. Never wipe the vault on this; re-prompt instead. */
export class WrongPasswordError extends Error {
  constructor() {
    super("Incorrect password");
    this.name = "WrongPasswordError";
  }
}

/** Prompts the user for the vault password. Resolves with the password, or null
 *  if they cancel (→ locked). `error` is set to re-prompt after a wrong attempt. */
export type PasswordPrompt = (opts: { error?: string }) => Promise<string | null>;

/** The persisted-config accessor, injected so the store is testable without
 *  real browser.storage. */
export interface EncryptionConfigStore {
  load(): Promise<EncryptionConfig>;
  save(cfg: EncryptionConfig): Promise<void>;
}

/** Caches an exported "session" unlock key in browser.storage.session (cleared
 *  on browser close). Storing the raw key bytes here is the accepted tradeoff
 *  for session mode — see vaultCipher's threat-model note. When session storage
 *  is unavailable (old Firefox), inject a no-op store: session mode then degrades
 *  to prompting once per panel open (i.e. behaves like "always"). */
export interface SessionKeyStore {
  get(): Promise<DerivedKeyBytes | null>;
  set(bytes: DerivedKeyBytes): Promise<void>;
  clear(): Promise<void>;
}

export interface EncryptedVaultStoreDeps {
  /** Plaintext delegate (LocalVaultStore) — used when encryption is off or the
   *  stored blob is plaintext, preserving its corrupt-blob handling. */
  inner: VaultStore;
  /** Raw envelope IO for the encrypted path. */
  raw: RawVaultStore;
  config: EncryptionConfigStore;
  prompt: PasswordPrompt;
  session: SessionKeyStore;
  /** Minimum set-password length when enabling encryption. */
  minPasswordLength?: number;
}

export const DEFAULT_MIN_PASSWORD_LENGTH = 8;

/**
 * Wraps a VaultStore with at-rest encryption at the serialize/deserialize
 * boundary. Vault stays pure — this decorator owns the cipher.
 *
 * Unlock modes (from EncryptionConfig):
 *  - "session": after the first unlock the key bytes are cached in
 *    storage.session, so reopening the panel within the browser session does not
 *    re-prompt. The in-memory key (memKey) short-circuits within a panel lifetime.
 *  - "always": the key is never persisted; it lives only in memKey for the panel
 *    lifetime (prompt once per fresh load), so closing the panel discards it.
 *
 * No-clobber guard: when encryption is enabled but no key can be obtained
 * (cancelled prompt / lost session key), loadVault throws VaultLockedError and
 * saveVault throws rather than writing a plaintext vault over the ciphertext.
 */
export class EncryptedVaultStore implements VaultStore {
  private memKey: DerivedKey | null = null; // per-instance; never persisted

  constructor(private readonly deps: EncryptedVaultStoreDeps) {}

  async loadVault(): Promise<Vault> {
    const raw = await this.deps.raw.loadVaultRaw();
    // Nothing stored, or a plaintext blob → delegate (keeps corrupt handling).
    if (raw === undefined || !isEncrypted(raw)) {
      // A plaintext blob while config says enabled is a torn DISABLE (enable always
      // writes the envelope before flipping config, so this ordering can't be a torn
      // enable). Heal the config so saves aren't locked out (encryptedOnDisk=false +
      // no key → VaultLockedError on every autosave otherwise).
      if (raw !== undefined) {
        const cfg = await this.deps.config.load();
        if (cfg.enabled) await this.deps.config.save({ ...cfg, enabled: false }).catch(() => {});
      }
      return this.deps.inner.loadVault();
    }

    const cfg = await this.deps.config.load();
    const unlocked = await this.obtainKey(raw, cfg);
    if (!unlocked) throw new VaultLockedError(); // user cancelled — stay locked, don't clobber
    const { plaintext } = unlocked; // the decryption that proved the key — no second decrypt
    // Reconcile a torn enable (envelope written but config not yet flipped): an
    // envelope we can decrypt means encryption really is on, so a later save must
    // not downgrade it to plaintext.
    if (!cfg.enabled) await this.deps.config.save({ ...cfg, enabled: true }).catch(() => {});
    const vault = new Vault();
    const dropped = vault.load(plaintext);
    // Preserve the recoverable ENVELOPE (ciphertext, not the plaintext) if records
    // dropped, so a schema drift that empties the vault can't let a later save
    // overwrite it — mirroring the plaintext path's corrupt-blob backup.
    if (dropped !== 0) await this.deps.raw.backupCorruptVault(raw, dropped);
    return vault;
  }

  async saveVault(vault: Vault): Promise<void> {
    const cfg = await this.deps.config.load();
    const raw = await this.deps.raw.loadVaultRaw();
    const encryptedOnDisk = raw !== undefined && isEncrypted(raw);
    // Plaintext only when NEITHER the config nor an on-disk envelope says encrypted.
    // Keying save off the envelope too (not just cfg.enabled) means a torn disable or
    // a stale config can never silently overwrite ciphertext with plaintext.
    if (!cfg.enabled && !encryptedOnDisk) return this.deps.inner.saveVault(vault);
    // With an existing envelope, obtain (and verify) a key against it. Right after
    // enableEncryption there is one, so obtainKey reuses the in-memory key; the
    // memKey fallback covers the (transient) enabled-but-no-envelope-yet case.
    const key = encryptedOnDisk ? (await this.obtainKey(raw!, cfg))?.key ?? null : this.memKey;
    if (!key) throw new VaultLockedError(); // locked → refuse to overwrite the ciphertext
    await this.deps.raw.saveVaultRaw(await encrypt(vault.serialize(), key));
  }

  /** Turn on encryption: derive a fresh-salt key from `password`, encrypt the
   *  current vault, persist the envelope + config, and cache the key per mode. */
  async enableEncryption(vault: Vault, password: string, unlock: EncryptionConfig["unlock"]): Promise<void> {
    const min = this.deps.minPasswordLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
    if (password.length < min) throw new Error(`Password must be at least ${min} characters`);
    const key = await deriveKey(password, randomSalt());
    await this.deps.raw.saveVaultRaw(await encrypt(vault.serialize(), key));
    await this.deps.config.save({ enabled: true, unlock });
    this.memKey = key;
    if (unlock === "session") await this.deps.session.set(await exportDerivedKey(key)).catch(() => {});
  }

  /** Change the unlock mode while encryption stays ON (no re-encrypt, no password —
   *  the vault is already unlocked). Switching to "session" caches the current key;
   *  to "always" drops any cached key so it's never persisted. No-op when off. */
  async setUnlockMode(unlock: EncryptionConfig["unlock"]): Promise<void> {
    const cfg = await this.deps.config.load();
    if (!cfg.enabled) return;
    await this.deps.config.save({ enabled: true, unlock });
    if (unlock === "session") {
      if (this.memKey) await this.deps.session.set(await exportDerivedKey(this.memKey)).catch(() => {});
    } else {
      await this.deps.session.clear().catch(() => {});
    }
  }

  /** Turn off encryption: verify `password` by decrypting, then re-save the vault
   *  as plaintext and clear the cached key. Returns the decrypted vault. Throws on
   *  a wrong password (never wipes the vault). */
  async disableEncryption(password: string): Promise<Vault> {
    const raw = await this.deps.raw.loadVaultRaw();
    const disable = async (): Promise<void> => {
      await this.deps.config.save({ enabled: false, unlock: (await this.deps.config.load()).unlock });
      this.memKey = null;
      await this.deps.session.clear().catch(() => {});
    };
    if (raw === undefined || !isEncrypted(raw)) {
      // Already plaintext — just make the config consistent.
      await disable();
      return this.deps.inner.loadVault();
    }
    const meta = decodeEnvelope(raw)!;
    let plaintext: string;
    try {
      const key = await deriveKey(password, meta.salt, meta.iter);
      plaintext = await decrypt(raw, key.key);
    } catch {
      throw new WrongPasswordError();
    }
    const vault = new Vault();
    vault.load(plaintext);
    await this.deps.raw.saveVaultRaw(plaintext);
    await disable();
    return vault;
  }

  /** Obtain a key that decrypts `raw` (a known envelope): in-memory → session
   *  cache → prompt loop. Each candidate proves itself by actually decrypting the
   *  envelope, so a stale cached key falls through to a prompt rather than
   *  surfacing an error — and the successful decryption's plaintext is returned
   *  alongside the key so callers never decrypt twice. Null if the user cancels. */
  private async obtainKey(raw: string, cfg: EncryptionConfig): Promise<{ key: DerivedKey; plaintext: string } | null> {
    if (this.memKey) {
      const plaintext = await this.tryDecrypt(raw, this.memKey);
      if (plaintext !== null) return { key: this.memKey, plaintext };
      this.memKey = null;
    }

    if (cfg.unlock === "session") {
      const cached = await this.deps.session.get().catch(() => null);
      if (cached) {
        const key = await importDerivedKey(cached).catch(() => null);
        const plaintext = key === null ? null : await this.tryDecrypt(raw, key);
        if (key !== null && plaintext !== null) return { key: (this.memKey = key), plaintext };
        await this.deps.session.clear().catch(() => {}); // stale/invalid → drop it
      }
    }

    const meta = decodeEnvelope(raw)!; // iter already clamped to a safe range
    let error: string | undefined;
    for (;;) {
      const password = await this.deps.prompt({ error });
      if (password === null) return null; // cancelled → locked
      const key = await deriveKey(password, meta.salt, meta.iter).catch(() => null);
      const plaintext = key === null ? null : await this.tryDecrypt(raw, key);
      if (key !== null && plaintext !== null) {
        this.memKey = key;
        if (cfg.unlock === "session") await this.deps.session.set(await exportDerivedKey(key)).catch(() => {});
        return { key, plaintext };
      }
      error = "Incorrect password";
    }
  }

  /** Decrypt `raw` with `key`, or null on a wrong key / tampered blob. */
  private async tryDecrypt(raw: string, key: DerivedKey): Promise<string | null> {
    try {
      return await decrypt(raw, key.key);
    } catch {
      return null;
    }
  }
}
