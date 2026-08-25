import { sweepFields } from "../src/core/form/sweepFields";
import { findSubmit } from "../src/core/form/findSubmit";
import { FormReadout, PageBridge } from "../src/core/page/pageBridge";

/** Confidence color → CSS color, matching DomFormSource's palette. */
const HIGHLIGHT_CSS: Record<string, { outline: string; shadow: string }> = {
  green: { outline: "#1a7f37", shadow: "rgba(26,127,55,0.35)" },
  yellow: { outline: "#9a6700", shadow: "rgba(154,103,0,0.35)" },
  red: { outline: "#d1242f", shadow: "rgba(209,36,47,0.35)" },
};

/**
 * A PageBridge that drives a live form Document directly — the demo's stand-in
 * for the extension's content script. It MUST run in the same realm as `doc`
 * (its `instanceof HTMLInputElement` etc. checks, via sweepFields and fill, only
 * hold within one realm), so the demo instantiates it INSIDE the form iframe
 * (see demoFrame.ts) and the top-level app calls it across the same-origin
 * boundary. In the jsdom test it's constructed directly against the parsed doc.
 *
 * readForm/fill/setChecked mirror src/ext/content/pageActions.ts' fill semantics
 * (input + change events, select included) so the demo exercises the real path;
 * they no-op on a missing element (the sweep guarantees ids) where pageActions
 * throws. highlight and clickSubmit differ deliberately — highlight paints a
 * confidence ring, and clickSubmit never submits (it shows a "(submit simulated)"
 * toast).
 */
export class DemoBridge implements PageBridge {
  constructor(private doc: Document) {}

  private el(elementId: string): HTMLElement | null {
    return this.doc.querySelector<HTMLElement>(`[data-vof="${elementId}"]`);
  }

  async readForm(): Promise<FormReadout> {
    // sweepFields assigns data-vof ids to fields; findSubmit seeds its id past them.
    return { fields: sweepFields(this.doc), submit: findSubmit(this.doc) };
  }

  async fill(elementId: string, value: string): Promise<void> {
    const el = this.el(elementId);
    if (!el) return;
    const isFormControl =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (isFormControl) el.value = value;
    else el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    // <select> commits on `change`, not `input`, and lots of sites listen only for
    // `change` — mirror pageActions and fire both for every form control.
    if (isFormControl) el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async setChecked(elementId: string, checked: boolean): Promise<void> {
    const el = this.el(elementId);
    if (el instanceof HTMLInputElement) {
      el.checked = checked;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async highlight(elementId: string, color: string): Promise<void> {
    const el = this.el(elementId);
    if (!el) return;
    const css = HIGHLIGHT_CSS[color] ?? HIGHLIGHT_CSS.green!;
    el.style.outline = `2px solid ${css.outline}`;
    el.style.outlineOffset = "1px";
    el.style.boxShadow = `0 0 0 3px ${css.shadow}`;
    el.style.borderRadius = el.style.borderRadius || "3px";
  }

  /** The demo never actually submits — clicking would navigate away from the
   *  fixture. Flash a toast over the form so the action is still visible. */
  async clickSubmit(_elementId: string): Promise<void> {
    const doc = this.doc;
    const toast = doc.createElement("div");
    toast.textContent = "(submit simulated)";
    toast.setAttribute(
      "style",
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;" +
        "background:#1a7f37;color:#fff;font:600 13px system-ui,sans-serif;padding:8px 14px;" +
        "border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity .4s;",
    );
    doc.body?.appendChild(toast);
    const view = doc.defaultView;
    if (view) {
      view.setTimeout(() => { toast.style.opacity = "0"; }, 1400);
      view.setTimeout(() => toast.remove(), 1900);
    }
  }

  currentDomain(): string {
    return "vaultofill.demo";
  }
}
