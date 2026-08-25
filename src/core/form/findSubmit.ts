import { SubmitSpec } from "../types";
import { isVisibleField } from "./visibility";
import { createVofIdAssigner } from "./vofId";

const SUBMIT_TEXT =
  /\b(submit|send|continue|next|book|reserve|apply|save|sign\s?up|register|confirm|check\s?out|place\s+order|complete|finish|done)\b/i;

function controlText(el: Element): string {
  const value = el instanceof HTMLInputElement ? el.value : "";
  return (el.textContent || value || el.getAttribute("aria-label") || "").trim();
}

/**
 * Deterministically pick the control that submits the form, in priority order:
 *   1. an explicit submit control (`type="submit"` / image button),
 *   2. a `<button>` inside a form with no `type` (default action is submit),
 *   3. any button whose visible text reads like a submit action.
 * Only visible controls are considered. Anchor / role="button" submits (common
 * in SPAs) are out of scope; getSchema surfaces "no submit control found".
 */
function pickSubmit(doc: Document): Element | null {
  const explicit = doc.querySelectorAll<HTMLElement>(
    'button[type="submit"], input[type="submit"], input[type="image"]',
  );
  for (const el of explicit) if (isVisibleField(el, doc)) return el;

  // A typeless button only defaults to submit inside a form; document-wide it
  // would wrongly match nav/menu/close buttons on SPA pages.
  for (const el of doc.querySelectorAll<HTMLButtonElement>("form button:not([type])")) {
    if (isVisibleField(el, doc)) return el;
  }

  for (const el of doc.querySelectorAll<HTMLElement>('button, input[type="button"]')) {
    if (isVisibleField(el, doc) && SUBMIT_TEXT.test(controlText(el))) return el;
  }

  return null;
}

/**
 * Find the form's submit control and return a DOM submit spec pointing at its
 * stable `data-vof` id (assigning one past the highest existing index if the
 * control lacks it). Returns null when no submit control is found. Intended to
 * run after `sweepFields`, so it seeds its index past the swept field ids.
 */
export function findSubmit(doc: Document): SubmitSpec | null {
  const el = pickSubmit(doc);
  if (!el) return null;

  return { kind: "dom", elementId: createVofIdAssigner(doc)(el) };
}
