import { sweepFields, countFillableFields } from "../../core/form/sweepFields";
import { findSubmit } from "../../core/form/findSubmit";

export type PageAction = "ping" | "readForm" | "fieldCount" | "fill" | "setChecked" | "highlight" | "clickSubmit";

export interface Request {
  action: PageAction;
  args: unknown[];
}

export function findByVofId(elementId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-vof="${elementId}"]`);
  if (!el) throw new Error(`No element found for data-vof="${elementId}"`);
  return el;
}

export function fill(elementId: string, value: string): void {
  const el = findByVofId(elementId);
  const isFormControl =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  if (isFormControl) el.value = value;
  else el.textContent = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  // <select> commits on `change`, not `input`, and lots of sites (and their
  // validation / enable-submit logic) listen only for `change` — without it the
  // filled value silently doesn't register. Mirror setChecked and fire both.
  if (isFormControl) el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function setChecked(elementId: string, checked: boolean): void {
  const el = findByVofId(elementId);
  if (el instanceof HTMLInputElement) {
    el.checked = checked;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function highlight(elementId: string, color: string): void {
  findByVofId(elementId).style.outline = `2px solid ${color}`;
}

export function clickSubmit(elementId: string): void {
  findByVofId(elementId).click();
}

export async function handleMessage(message: unknown): Promise<unknown> {
  const { action, args } = message as Request;
  switch (action) {
    case "ping":
      return { ok: true };
    case "readForm":
      // sweepFields assigns data-vof ids to fields; findSubmit seeds its id past them.
      return { fields: sweepFields(document), submit: findSubmit(document) };
    case "fieldCount":
      // Cheap, non-mutating "is this form-heavy?" probe for preloading the model.
      return countFillableFields(document);
    case "fill":
      fill(args[0] as string, args[1] as string);
      return undefined;
    case "setChecked":
      setChecked(args[0] as string, args[1] as boolean);
      return undefined;
    case "highlight":
      highlight(args[0] as string, args[1] as string);
      return undefined;
    case "clickSubmit":
      clickSubmit(args[0] as string);
      return undefined;
    default:
      throw new Error(`Unknown action: ${String(action)}`);
  }
}
