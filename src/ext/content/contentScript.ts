import browser from "webextension-polyfill";
import { countFillableFields } from "../../core/form/sweepFields";
import { handleMessage } from "./pageActions";
import { installAutofillPrompt } from "./autofillPrompt";

// On a form-heavy page, warm the on-device model (Chrome: in a background
// offscreen document) so it's ready by the time the user opens the panel to fill.
const WARM_FIELD_THRESHOLD = 2;
if (countFillableFields(document) >= WARM_FIELD_THRESHOLD) {
  void browser.runtime.sendMessage({ kind: "vof:warmModel" }).catch(() => {});
}

// VERIFY-AGAINST-INSTALLED: browser.runtime.onMessage listener signature and
// return-value-as-promise behavior differ subtly between Chrome's native
// chrome.runtime and the webextension-polyfill shim — confirm against the
// installed Chrome/Firefox versions before shipping.
browser.runtime.onMessage.addListener((message: unknown) => handleMessage(message));

installAutofillPrompt(document, () => {
  // A content-script click can't open the side panel: Chrome doesn't propagate
  // its user gesture to the service worker, so sidePanel.open() there always
  // rejects. Instead we PRIME the pending fill — the panel auto-runs on this tab
  // once the user opens it via a reliable trigger (the toolbar icon, the
  // right-click "Autofill this page" menu, or the Alt+Shift+F shortcut).
  void browser.runtime.sendMessage({ action: "openPanelAndStart" });
});
