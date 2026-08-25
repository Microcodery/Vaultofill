import { DemoBridge } from "./demoBridge";

/**
 * Runs INSIDE the form iframe. The bridge's DOM checks (sweepFields / fill use
 * `instanceof HTMLInputElement`) only hold within the realm that created the
 * elements, so the bridge must be constructed here — against the iframe's own
 * `document` — not from the top-level page. The top-level app (demo.ts) injects
 * this script after the fixture loads and then reads `window.__vofBridge` to drive
 * the real pipeline across the same-origin boundary.
 */
declare global {
  interface Window {
    __vofBridge?: DemoBridge;
  }
}

window.__vofBridge = new DemoBridge(document);
