export interface EnsureDeps {
  sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  executeScript: (opts: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
}

export async function ensureContentScript(tabId: number, deps: EnsureDeps): Promise<void> {
  try {
    await deps.sendMessage(tabId, { action: "ping" });
    return;
  } catch {
    // No content script listening yet — fall through to inject one.
  }

  try {
    await deps.executeScript({ target: { tabId }, files: ["content/contentScript.js"] });
  } catch {
    throw new Error(
      "Vaultofill can't run on this page. Open the form on a normal website (not a browser page or local file) and reload it.",
    );
  }
}
