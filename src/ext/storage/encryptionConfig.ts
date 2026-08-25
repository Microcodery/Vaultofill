import { StorageArea } from "./storageArea";

/** Non-secret at-rest-encryption metadata. The salt/iv live in the vault
 *  envelope and the password/key are NEVER persisted here — only whether
 *  encryption is on and how often to prompt for the password. */
export interface EncryptionConfig {
  enabled: boolean;
  /** "session": prompt once per browser session (key cached in storage.session).
   *  "always": prompt on every fresh vault load; the key is never persisted. */
  unlock: "session" | "always";
}

const CONFIG_KEY = "vaultofill:encryptionConfig";

export function defaultEncryptionConfig(): EncryptionConfig {
  return { enabled: false, unlock: "session" };
}

/** Load the encryption config, degrading to defaults on a missing/malformed
 *  value (e.g. written by an older/incompatible build). */
export async function loadEncryptionConfig(storage: StorageArea): Promise<EncryptionConfig> {
  const stored = await storage.get(CONFIG_KEY);
  const raw = stored[CONFIG_KEY];
  if (typeof raw !== "string") return defaultEncryptionConfig();
  try {
    const parsed = JSON.parse(raw) as Partial<EncryptionConfig>;
    return {
      enabled: parsed.enabled === true,
      unlock: parsed.unlock === "always" ? "always" : "session",
    };
  } catch {
    return defaultEncryptionConfig();
  }
}

export async function saveEncryptionConfig(storage: StorageArea, cfg: EncryptionConfig): Promise<void> {
  await storage.set({ [CONFIG_KEY]: JSON.stringify(cfg) });
}
