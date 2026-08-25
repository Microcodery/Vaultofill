import { isOptionControl } from "../../core/fill/persistReview";
import { evaluate } from "../../core/gate/gate";
import { DEFAULT_POLICY, FilledEntry, FormField, Volatility } from "../../core/types";
import { volatilityFor } from "../../core/labels/canonicalLabels";
import { humanizeLabel } from "../../core/labels/humanize";
import { UNKNOWN } from "../../core/labels/labelQuestions";
import { buildControl, buildTierBadge, buildVariantCombobox, buildRowMenu, buildMenuSection } from "./renderControl";

export interface ReviewRow {
  entry: FilledEntry;
  getValue?: () => string;
  getVolatility?: () => Volatility;
  getVariant?: () => string | undefined;
  getNewLabel?: () => string;
  includeCheckbox?: HTMLInputElement;
}

/** A field's label if it's persistable (so its storage tier + label chip are
 *  meaningful) — a matched/seed label, a model-invented one, or a question-
 *  derived fallback — excluding only UNKNOWN/empty. Option controls persist the
 *  chosen option's portable label (see persistReview/portableOptionValue). */
export function persistableLabel(entry: FilledEntry): string | undefined {
  const label = entry.detail?.canonicalLabel ?? entry.field.label;
  if (!label || label === UNKNOWN) return undefined;
  return label;
}

/** Build one interactive review row for a classified entry (green/yellow/red):
 *  label · value · cycling tier badge · "⋮" menu. Variant fields get a combobox
 *  (datalist suggestions) only when there are 2+ variants; the ⋮ menu holds a new
 *  variant and include/exclude. Two lines: [label · tier badge · ⋮] on top, the
 *  full-width value below. In `preview` mode the value is read-only, no controls. */
export function buildEntryRow(entry: FilledEntry, opts: { preview?: boolean } = {}): { rowEl: HTMLElement; row: ReviewRow } {
  const row: ReviewRow = { entry };
  const rowEl = document.createElement("div");
  rowEl.className = `vof-row vof-${entry.confidence}`;

  // Line 1: the page's field label, the vault label we matched it to (so the user
  // sees WHY it filled — key for yellow "maybe" matches), then the tier badge + ⋮.
  const head = document.createElement("div");
  head.className = "vof-row-head";
  const label = document.createElement("label");
  label.className = "vof-field-label";
  label.textContent = entry.field.humanReadable || entry.field.label;
  head.appendChild(label);
  // The label chip: matched rows show the vault label they filled from ("why");
  // a red row shows the label it WILL save under, so its first line reads the
  // same as a matched row's.
  const chipLabel = entry.detail ? entry.detail.canonicalLabel : entry.confidence === "missing" ? persistableLabel(entry) : undefined;
  if (chipLabel) {
    const used = document.createElement("span");
    used.className = "vof-used-label";
    used.textContent = humanizeLabel(chipLabel);
    used.title = entry.detail
      ? `Filled from your saved "${humanizeLabel(chipLabel)}"`
      : `New field — labeled "${humanizeLabel(chipLabel)}" (the tier badge sets whether it's saved)`;
    head.appendChild(used);
  }
  const meta = document.createElement("span");
  meta.className = "vof-row-meta";
  head.appendChild(meta);
  rowEl.appendChild(head);

  const isMissing = entry.confidence === "missing";
  const variants = entry.variants ?? [];
  // Only offer the suggestions dropdown when there's an actual choice (2+ variants).
  const useCombobox = !isMissing && !opts.preview && variants.length >= 2 && !isOptionControl(entry.field);

  // Line 2: the value control — a variant combobox (datalist suggestions) or the
  // mirrored control. All values are editable — an edit overwrites on submit.
  let combo: ReturnType<typeof buildVariantCombobox> | undefined;
  let valueEl: HTMLElement;
  if (useCombobox) {
    combo = buildVariantCombobox(variants, entry.value ?? "", entry.variant);
    valueEl = combo.element;
    row.getValue = combo.getValue;
    row.getVariant = combo.getVariant;
  } else {
    const control = buildControl(entry.field.control, isMissing ? "" : entry.value ?? "", {
      placeholder: isMissing ? "Enter value" : undefined,
      disabled: opts.preview,
    });
    valueEl = control.element;
    row.getValue = control.getValue;
  }
  valueEl.classList.add("vof-value");
  rowEl.appendChild(valueEl);

  // Preview rows are read-only value previews until the final review renders.
  if (opts.preview) return { rowEl, row };

  // Cycling tier badge ("type": Permanent/Temporary/One-time) — only for rows
  // with a canonical label to save the value under (persistableLabel). A truly
  // unrecognized red row has no canonical label, so no badge and no persistence;
  // a red row the model DID label (but which has no stored value yet) still gets
  // a badge and persists on fill.
  const persistLabel = persistableLabel(entry);
  if (persistLabel) {
    // entry.volatility (a red row's default tier, e.g. One-time for a question-
    // derived fallback) wins, then the matched detail's stored tier, then the
    // label default.
    const tierBadge = buildTierBadge(entry.volatility ?? entry.detail?.volatility ?? volatilityFor(persistLabel));
    row.getVolatility = tierBadge.getValue;
    meta.appendChild(tierBadge.element);
  }

  // The "⋮" menu — attached only if it ends up with content.
  const menu = buildRowMenu();
  let menuHasContent = false;

  // Save the current value under a NEW named variant (blank = keep current one).
  // Not offered for option controls: there's no variant picker for them yet (the
  // combobox is text-only), so a non-default variant would be write-only.
  if (persistLabel && !isOptionControl(entry.field)) {
    const section = buildMenuSection("Save as new variant");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "vof-new-variant";
    nameInput.placeholder = "new variant name";
    section.appendChild(nameInput);
    menu.panel.appendChild(section);
    menuHasContent = true;
    const baseGetVariant = combo ? combo.getVariant : () => entry.variant;
    row.getVariant = () => nameInput.value.trim() || baseGetVariant();
  }

  // Save as a NEW / different label — correct a wrong match (e.g. a GPA field that
  // matched EMAIL): on fill, this reassigns the field to the typed label, unlearns
  // the old question→label mapping, and clears the (wrong) value so it isn't saved
  // under the new label. Also works on red rows to name an unrecognized field.
  if (!isOptionControl(entry.field)) {
    const section = buildMenuSection("Save as new label");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "vof-new-label";
    labelInput.placeholder = entry.detail ? "this is actually…" : "name this field…";
    section.appendChild(labelInput);
    menu.panel.appendChild(section);
    menuHasContent = true;
    row.getNewLabel = () => labelInput.value.trim();
  }

  // The gate (single source of truth) decides what needs confirmation — a matched
  // detail's sensitivity, else derived from the label, so a model-invented sensitive
  // label (SSN/CVV/CARD…) or a detail-less option control is still gated behind the
  // lock, not silently filled.
  if (evaluate(entry, DEFAULT_POLICY) === "needsConfirmation") {
    // Sensitive (card/passport/etc.): EXCLUDED by default — opt-in. A visible lock
    // in the row toggles inclusion (one click), so it's never silently filled.
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    row.includeCheckbox = checkbox; // detached; read by the submit handler
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "vof-sensitive";
    const renderLock = (): void => {
      lock.textContent = checkbox.checked ? "🔓" : "🔒";
      lock.title = checkbox.checked ? "Sensitive — included; click to exclude" : "Sensitive — excluded; click to include";
    };
    renderLock();
    lock.addEventListener("click", () => { checkbox.checked = !checkbox.checked; renderLock(); });
    meta.appendChild(lock);
  } else if (entry.confidence === "connected") {
    // Uncertain (yellow) match: included by default; uncheck to reject the guess.
    const section = buildMenuSection("Match");
    const toggle = document.createElement("label");
    toggle.className = "vof-menu-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    toggle.append(checkbox, document.createTextNode(" Include this field"));
    section.appendChild(toggle);
    row.includeCheckbox = checkbox;
    menu.panel.appendChild(section);
    menuHasContent = true;
  }

  if (menuHasContent) {
    meta.appendChild(menu.trigger);
    rowEl.appendChild(menu.panel); // positioned absolute relative to the row
  }

  return { rowEl, row };
}

/** Build a placeholder row for a field still being labeled: two lines matching
 *  buildEntryRow (label + "labeling…" on top, disabled value below). */
export function buildPendingRow(field: FormField): HTMLElement {
  const rowEl = document.createElement("div");
  rowEl.className = "vof-row vof-pending";
  const head = document.createElement("div");
  head.className = "vof-row-head";
  const label = document.createElement("label");
  label.className = "vof-field-label";
  label.textContent = field.humanReadable || field.label || "(no label)";
  const mark = document.createElement("span");
  mark.className = "vof-pending-mark";
  mark.textContent = "labeling…";
  head.append(label, mark);
  rowEl.appendChild(head);
  const control = buildControl(field.control, "", { disabled: true, placeholder: "…" });
  control.element.classList.add("vof-value");
  rowEl.appendChild(control.element);
  return rowEl;
}
