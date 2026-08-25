import browser, { Runtime } from "webextension-polyfill";
import { PENDING_TAB_STORAGE_KEY } from "./panel/pendingTab";
import { OFFSCREEN_URL, PrepareModelReply } from "./offscreen/offscreenMessages";

// VERIFY-AGAINST-INSTALLED: `chrome.offscreen` is a Chrome-only MV3 API (Firefox
// has no equivalent). Loosely typed so the same background script loads in both;
// on Firefox getChromeOffscreen() is undefined and the model loads in the panel.
interface ChromeOffscreen {
  hasDocument?(): Promise<boolean>;
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

function getChromeOffscreen(): ChromeOffscreen | undefined {
  return (globalThis as { chrome?: { offscreen?: ChromeOffscreen } }).chrome?.offscreen;
}

// Lock so concurrent warm requests don't race to create two documents. NOT a
// success memo: hasDocument() is re-checked every call, so a document that died
// (GPU-process crash, manual close) is recreated rather than assumed present.
let creating: Promise<void> | undefined;

/** Ensure the offscreen document (which hosts the on-device WebGPU model) exists.
 *  Returns false when offscreen isn't supported (Firefox) so the panel loads the
 *  model itself instead. The document starts loading the model on creation. */
async function ensureOffscreen(): Promise<boolean> {
  const off = getChromeOffscreen();
  if (!off) return false;
  if (off.hasDocument && (await off.hasDocument())) return true;
  if (!creating) {
    creating = (async () => {
      try {
        await off.createDocument({
          url: OFFSCREEN_URL,
          reasons: ["WORKERS"], // it spawns the web-llm worker
          justification: "Runs the on-device WebGPU model that maps form fields to labels.",
        });
      } catch (err) {
        // A concurrent create races to "Only a single offscreen document may be
        // created" — that just means it already exists, which is what we want.
        if (!/single offscreen/i.test(String(err))) throw err;
      } finally {
        creating = undefined;
      }
    })();
  }
  await creating;
  return true;
}

// VERIFY-AGAINST-INSTALLED: `chrome.sidePanel` is a Chrome-only MV3 API not
// covered by webextension-polyfill's types (Firefox uses `sidebar_action`,
// which opens automatically and needs no wiring here). This stays a loosely
// typed, best-effort call so the same background script loads unmodified in
// both browsers — confirm the exact API shape against the installed Chrome
// version.
interface ChromeSidePanel {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  open(options: { tabId: number }): Promise<void>;
}

function getChromeSidePanel(): ChromeSidePanel | undefined {
  const g = globalThis as { chrome?: { sidePanel?: ChromeSidePanel } };
  return g.chrome?.sidePanel;
}

// Firefox exposes `browser.sidebarAction`; Chrome does not. Loosely typed so
// the same background script loads in both.
function getSidebarAction(): { open(): Promise<void> } | undefined {
  const g = globalThis as { browser?: { sidebarAction?: { open(): Promise<void> } } };
  return g.browser?.sidebarAction;
}

getChromeSidePanel()
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    // Best-effort: absent on Firefox, and failures here must not break the
    // rest of the extension.
  });

// Firefox: clicking the toolbar action opens the sidebar. `sidebarAction.open()`
// must run inside the click's user-gesture context — calling it directly in the
// listener satisfies that. (Chrome suppresses `action.onClicked` when
// openPanelOnActionClick is set, so this is Firefox-only in practice.)
if (browser.action?.onClicked) {
  browser.action.onClicked.addListener(() => {
    getSidebarAction()?.open().catch(() => {});
  });
}

// Reliable open triggers — a right-click context menu and a keyboard command.
// These events are dispatched by the browser directly to the SW WITH user
// activation, so sidePanel.open() works from them (a content-script click's
// gesture, by contrast, is never propagated to the SW — the tooltip can't open
// the panel, only prime the pending fill). Native chrome so the open stays in the
// activation context. The tab arrives synchronously with the event — never await
// before open(), or the activation is consumed.
interface NativeChrome {
  sidePanel?: ChromeSidePanel;
  storage?: { session?: { set(items: Record<string, unknown>): Promise<void> } };
  contextMenus?: { onClicked?: { addListener(cb: (info: unknown, tab?: { id?: number }) => void): void } };
  commands?: { onCommand?: { addListener(cb: (command: string, tab?: { id?: number }) => void): void } };
}
const nativeChrome = (globalThis as { chrome?: NativeChrome }).chrome;

/** Chrome: open the side panel for a tab (in the trigger's gesture) + prime the
 *  pending fill so the panel auto-runs on that tab. */
function openPanelChrome(tabId: number | undefined): void {
  if (tabId == null || !nativeChrome?.sidePanel?.open) return;
  nativeChrome.sidePanel.open({ tabId }).catch(() => {});
  nativeChrome.storage?.session?.set({ [PENDING_TAB_STORAGE_KEY]: tabId }).catch(() => {});
}

/** Firefox: open the sidebar (in the gesture, before any await) + prime the
 *  pending fill. `sidebarAction.open()` needs no tabId. */
function openSidebarFirefox(tabId: number | undefined): void {
  getSidebarAction()?.open()?.catch(() => {});
  if (tabId != null) void browser.storage.session.set({ [PENDING_TAB_STORAGE_KEY]: tabId }).catch(() => {});
}

const MENU_ID = "vof-autofill";

// Context menus persist across SW restarts once created; onInstalled fires on
// install/update (not every wake), which is the standard place to create them.
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create(
    { id: MENU_ID, title: "Autofill this page with Vaultofill", contexts: ["page", "editable"] },
    () => void browser.runtime.lastError, // swallow "duplicate id" if it already exists
  );
});

if (nativeChrome?.sidePanel?.open) {
  nativeChrome.contextMenus?.onClicked?.addListener((_info, tab) => openPanelChrome(tab?.id));
  nativeChrome.commands?.onCommand?.addListener((command, tab) => {
    if (command === "open-panel") openPanelChrome(tab?.id); // tab is passed with the event (Chrome 116+)
  });
} else {
  browser.contextMenus.onClicked.addListener((_info, tab) => openSidebarFirefox(tab?.id));
  browser.commands.onCommand.addListener((command) => {
    if (command === "open-panel") openSidebarFirefox(undefined); // sidebar opens for the current window
  });
}

browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
  const msg = (message ?? {}) as { action?: string; kind?: string };
  // Tooltip click: can't open the panel from a content-script gesture, so just
  // prime the pending fill — the panel auto-runs on this tab when opened via a
  // reliable trigger (toolbar / context menu / shortcut).
  if (msg.action === "openPanelAndStart") {
    const tabId = sender.tab?.id;
    return tabId != null ? browser.storage.session.set({ [PENDING_TAB_STORAGE_KEY]: tabId }).catch(() => {}) : undefined;
  }
  // Content script on a form-heavy page (or the panel): create+warm the model in
  // the background. After ensuring the document exists, nudge it to (re)load so a
  // load that failed the first time retries. Readiness is queried/broadcast.
  if (msg.kind === "vof:warmModel") {
    return ensureOffscreen()
      .then((ok) => {
        if (ok) void browser.runtime.sendMessage({ kind: "vof:offscreen:warm" }).catch(() => {});
        return ok;
      })
      .catch(() => false);
  }
  // Panel asks which model backend to use — offscreen (Chrome) or local (Firefox).
  // Capability check only; no side effect (warming is form-aware, via warmModel).
  if (msg.kind === "vof:prepareModel") {
    return Promise.resolve<PrepareModelReply>({ backend: getChromeOffscreen() ? "offscreen" : "local" });
  }
  return undefined;
});
