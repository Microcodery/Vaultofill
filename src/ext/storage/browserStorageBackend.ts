import { Vault } from "../../core/details/vault";
import { ActiveContext } from "../../core/details/activeContext";
import { LabelRegistry } from "../../core/labels/labelRegistry";
import { Detail } from "../../core/types";
import { StorageArea } from "./storageArea";

const VAULT_KEY = "vaultofill:vault";
const ACTIVE_CONTEXT_KEY = "vaultofill:activeContext";
const LABEL_REGISTRY_KEY = "vaultofill:labelRegistry";

/**
 * Persists the Vault and ActiveContext through a browser.storage-shaped
 * StorageArea. Vault has its own serialize()/load(); ActiveContext doesn't,
 * so its Details are serialized here via its keys()/get()/set() surface.
 */
/** The raw-string vault seam the encryption decorator writes envelopes through,
 *  bypassing Vault's serialize()/load() so it can persist opaque ciphertext. */
export interface RawVaultStore {
  loadVaultRaw(): Promise<string | undefined>;
  saveVaultRaw(raw: string): Promise<void>;
  /** Back up a raw vault blob under the `:corrupt` key + log, before a subsequent
   *  save can overwrite a (possibly recoverable) original with degraded data. The
   *  encryption decorator uses this when a DECRYPTED vault drops records — it backs
   *  up the still-encrypted envelope, so demo-seeding can't clobber the recoverable
   *  ciphertext. `dropped`: -1 unreadable, else count of skipped records. */
  backupCorruptVault(raw: string, dropped: number): Promise<void>;
}

export class BrowserStorageBackend implements RawVaultStore {
  constructor(private readonly area: StorageArea) {}

  /** The raw stored vault blob (plaintext JSON or an encrypted envelope), or
   *  undefined when nothing has been saved. */
  async loadVaultRaw(): Promise<string | undefined> {
    const stored = await this.area.get(VAULT_KEY);
    const raw = stored[VAULT_KEY];
    return typeof raw === "string" ? raw : undefined;
  }

  async saveVaultRaw(raw: string): Promise<void> {
    await this.area.set({ [VAULT_KEY]: raw });
  }

  backupCorruptVault(raw: string, dropped: number): Promise<void> {
    return this.preserveCorrupt(VAULT_KEY, raw, dropped);
  }

  async saveVault(vault: Vault): Promise<void> {
    await this.saveVaultRaw(vault.serialize());
  }

  /** Preserve a corrupt/partial raw blob under a backup key and log it, BEFORE the
   *  next save can overwrite the (possibly hand-recoverable) original with the
   *  degraded data. `dropped`: -1 unreadable, else count of skipped records. */
  private async preserveCorrupt(key: string, raw: string, dropped: number): Promise<void> {
    console.error(
      `[[VAULTOFILL]] "${key}" was ${dropped < 0 ? "unreadable" : `missing ${dropped} invalid record(s)`}; ` +
        `kept a backup at "${key}:corrupt" and continued with what loaded`,
    );
    await this.area.set({ [`${key}:corrupt`]: raw }).catch(() => {});
  }

  async loadVault(): Promise<Vault> {
    const raw = await this.loadVaultRaw();
    const vault = new Vault();
    if (raw === undefined) return vault;
    const dropped = vault.load(raw);
    if (dropped !== 0) await this.preserveCorrupt(VAULT_KEY, raw, dropped);
    return vault;
  }

  async saveActiveContext(ctx: ActiveContext): Promise<void> {
    const entries: [string, Detail][] = ctx.keys().map(key => [key, ctx.get(key)!]);
    await this.area.set({ [ACTIVE_CONTEXT_KEY]: JSON.stringify(entries) });
  }

  async loadActiveContext(): Promise<ActiveContext> {
    const stored = await this.area.get(ACTIVE_CONTEXT_KEY);
    const raw = stored[ACTIVE_CONTEXT_KEY];
    const ctx = new ActiveContext();
    if (typeof raw !== "string") return ctx;
    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch {
      await this.preserveCorrupt(ACTIVE_CONTEXT_KEY, raw, -1);
      return ctx; // corrupt blob → empty rather than failing panel init
    }
    if (!Array.isArray(entries)) {
      await this.preserveCorrupt(ACTIVE_CONTEXT_KEY, raw, -1);
      return ctx;
    }
    let dropped = 0;
    for (const pair of entries as [string, Detail][]) {
      try {
        ctx.set(pair[0], pair[1]);
      } catch {
        dropped++; // schema-drifted / invalid entry
      }
    }
    if (dropped !== 0) await this.preserveCorrupt(ACTIVE_CONTEXT_KEY, raw, dropped);
    return ctx;
  }

  async saveLabelRegistry(registry: LabelRegistry): Promise<void> {
    await this.area.set({ [LABEL_REGISTRY_KEY]: registry.serialize() });
  }

  async loadLabelRegistry(): Promise<LabelRegistry> {
    const stored = await this.area.get(LABEL_REGISTRY_KEY);
    const raw = stored[LABEL_REGISTRY_KEY];
    const registry = new LabelRegistry();
    if (typeof raw === "string") registry.load(raw); // load() degrades to empty on a corrupt blob
    return registry;
  }
}
