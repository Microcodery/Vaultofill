import { isMeaningfulFillableField } from "./fieldDetect";
import { isVisibleField } from "./visibility";
import { createVofIdAssigner } from "./vofId";
import { FieldControl } from "../types";

export interface SweptField {
  humanReadable: string;
  elementId: string;
  control: FieldControl;
}

/** Describe the control so the review UI can mirror it: a select's options, an
 *  input's type (date/number/…), or a textarea. */
function deriveControl(el: Element): FieldControl {
  if (el instanceof HTMLSelectElement) {
    return { tag: "select", options: [...el.options].map((o) => ({ value: o.value, label: o.text.trim() || o.value })) };
  }
  if (el instanceof HTMLTextAreaElement) {
    return { tag: "textarea" };
  }
  return { tag: "input", inputType: (el instanceof HTMLInputElement && el.type) || "text" };
}

const FILLABLE_SELECTOR = "input, select, textarea";
const CONTROL_SELECTOR = "input, select, textarea, button";
const REQUIRED_MARKER_TEXT = /^\*$|^required$/i;
const TRAILING_ASTERISK = /[\s*]+$/;

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function isRequiredMarkerElement(el: Element): boolean {
  if (el.tagName !== "SPAN" && el.tagName !== "ABBR") return false;
  const text = collapseWhitespace(el.textContent || "");
  return REQUIRED_MARKER_TEXT.test(text);
}

function extractLabelText(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  for (const control of clone.querySelectorAll(CONTROL_SELECTOR)) {
    control.remove();
  }
  for (const marker of clone.querySelectorAll("span, abbr")) {
    if (isRequiredMarkerElement(marker)) marker.remove();
  }
  return collapseWhitespace(clone.textContent || "").replace(TRAILING_ASTERISK, "");
}

function findLabelFor(doc: Document, id: string): Element | null {
  for (const label of doc.querySelectorAll("label")) {
    if (label.getAttribute("for") === id) return label;
  }
  return null;
}

function getAssociatedLabelText(doc: Document, el: Element): string | null {
  if (el.id) {
    const label = findLabelFor(doc, el.id);
    if (label) {
      const text = extractLabelText(label);
      if (text) return text;
    }
  }

  const ancestorLabel = el.closest("label");
  if (ancestorLabel) {
    const text = extractLabelText(ancestorLabel);
    if (text) return text;
  }

  return null;
}

function getAriaLabelledByText(doc: Document, el: Element): string | null {
  const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  if (ids.length === 0) return null;

  const parts: string[] = [];
  for (const id of ids) {
    const target = doc.getElementById(id);
    const text = target ? collapseWhitespace(target.textContent || "") : "";
    if (text) parts.push(text);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

function deriveHumanReadable(doc: Document, el: Element): string {
  const labelText = getAssociatedLabelText(doc, el);
  if (labelText) return labelText;

  const ariaLabel = collapseWhitespace(el.getAttribute("aria-label") || "");
  if (ariaLabel) return ariaLabel;

  const labelledByText = getAriaLabelledByText(doc, el);
  if (labelledByText) return labelledByText;

  const placeholder = collapseWhitespace(el.getAttribute("placeholder") || "");
  if (placeholder) return placeholder;

  const name = collapseWhitespace(el.getAttribute("name") || "");
  if (name) return name;

  return "";
}

/** The per-option label for a radio/checkbox member: its own associated label /
 *  aria text, else its `value`. Deliberately does NOT fall back to the `name`
 *  attribute (which every group member shares) the way deriveHumanReadable does. */
function deriveOptionLabel(doc: Document, el: Element): string {
  const associated = getAssociatedLabelText(doc, el);
  if (associated) return associated;
  const aria = collapseWhitespace(el.getAttribute("aria-label") || "");
  if (aria) return aria;
  const labelledBy = getAriaLabelledByText(doc, el);
  if (labelledBy) return labelledBy;
  return (el as HTMLInputElement).value;
}

/** The shared question for a radio/checkbox group: its fieldset legend, an
 *  aria-labelled group container, else the shared `name`. (Each member's own
 *  label is the per-option text, not the group question.) */
function deriveGroupQuestion(doc: Document, el: Element, name: string): string {
  const legend = el.closest("fieldset")?.querySelector("legend");
  if (legend) {
    const text = extractLabelText(legend); // strips required-marker asterisks
    if (text) return text;
  }
  const group = el.closest('[role="radiogroup"], [role="group"]');
  if (group) {
    const labelled = getAriaLabelledByText(doc, group);
    if (labelled) return labelled;
    const aria = collapseWhitespace(group.getAttribute("aria-label") || "");
    if (aria) return aria;
  }
  return collapseWhitespace(name);
}

type FillableEntry =
  | { kind: "group"; el: HTMLInputElement; type: "radio" | "checkbox"; name: string }
  | { kind: "single"; el: Element };

/** The single traversal both the count and the sweep share: visible fillable
 *  controls, with each named radio/checkbox group yielded once at its first
 *  member and non-meaningful fields (search boxes, buttons, …) skipped. */
function* iterateFillableFields(doc: Document): Generator<FillableEntry> {
  const seenGroups = new Set<string>();
  for (const el of doc.querySelectorAll(FILLABLE_SELECTOR)) {
    if (!isVisibleField(el, doc)) continue;
    const type = el instanceof HTMLInputElement ? el.type : "";
    if (type === "radio" || type === "checkbox") {
      const name = (el as HTMLInputElement).name;
      const key = `${type}::${name}`;
      if (name && seenGroups.has(key)) continue;
      if (name) seenGroups.add(key);
      yield { kind: "group", el: el as HTMLInputElement, type, name };
    } else if (isMeaningfulFillableField(el)) {
      yield { kind: "single", el };
    }
  }
}

/** Count the visible fillable fields (radio/checkbox groups count once) without
 *  mutating the DOM — a cheap "is this a form-heavy page?" signal for preloading. */
export function countFillableFields(doc: Document): number {
  let count = 0;
  for (const _ of iterateFillableFields(doc)) count += 1;
  return count;
}

/**
 * Deterministically sweeps `doc` for meaningful fillable fields and returns each
 * field's best-available human question text alongside a stable `data-vof` id and
 * a control descriptor. Radio and checkbox inputs sharing a `name` are collapsed
 * into ONE field whose control lists the group's options (each with its own id).
 *
 * Existing `data-vof` attributes are preserved, and new ids are seeded past the
 * highest existing `vof-<n>` suffix in the document to avoid collisions (the
 * same scheme `findSubmit` continues from for the submit control).
 */
export function sweepFields(doc: Document): SweptField[] {
  const assignId = createVofIdAssigner(doc);
  const fields: SweptField[] = [];

  for (const entry of iterateFillableFields(doc)) {
    if (entry.kind === "group") {
      const { el, type, name } = entry;
      const members = name
        ? [...doc.querySelectorAll<HTMLInputElement>("input")].filter(
            (m) => m.type === type && m.name === name && isVisibleField(m, doc),
          )
        : [el];

      const options = members.map((m) => ({ value: m.value, label: deriveOptionLabel(doc, m), elementId: assignId(m) }));
      fields.push({
        humanReadable: deriveGroupQuestion(doc, el, name),
        elementId: options[0]!.elementId!,
        control: { tag: type, options },
      });
      continue;
    }

    fields.push({
      humanReadable: deriveHumanReadable(doc, entry.el),
      elementId: assignId(entry.el),
      control: deriveControl(entry.el),
    });
  }

  return fields;
}
