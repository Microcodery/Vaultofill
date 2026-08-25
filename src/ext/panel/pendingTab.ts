/**
 * Shared storage key the background script and the side panel use to relay
 * "which tab triggered this panel open" across the message boundary — a
 * side panel window has no direct handle on the tab whose badge was
 * clicked, so the background script stashes it here for the panel to pick
 * up (and clear) on load.
 */
export const PENDING_TAB_STORAGE_KEY = "vaultofill:pendingTabId";
