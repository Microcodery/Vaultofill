import { StorageArea } from "../storage/storageArea";

export interface PanelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const CONFIG_KEY = "vaultofill:panelConfig";

function emptyConfig(): PanelConfig {
  return { baseUrl: "", model: "", apiKey: "" };
}

/**
 * Loads the persisted OpenAI-compatible endpoint config (base URL, model,
 * API key) through a browser.storage-shaped StorageArea. Returns empty
 * defaults when nothing has been saved, or when the stored value is
 * malformed (e.g. written by an older/incompatible build).
 */
export async function loadConfig(storage: StorageArea): Promise<PanelConfig> {
  const stored = await storage.get(CONFIG_KEY);
  const raw = stored[CONFIG_KEY];
  if (typeof raw !== "string") return emptyConfig();

  try {
    const parsed = JSON.parse(raw) as Partial<PanelConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return emptyConfig();
  }
}

export async function saveConfig(storage: StorageArea, cfg: PanelConfig): Promise<void> {
  await storage.set({ [CONFIG_KEY]: JSON.stringify(cfg) });
}
