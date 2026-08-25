import type { FieldControl, FieldOption, Volatility } from "../../core/types";

const VOLATILITY_LABELS: [Volatility, string][] = [
  ["stable", "Permanent"],
  ["volatile", "Temporary"],
  ["ephemeral", "One-time"],
];

const TIER_ORDER: Volatility[] = VOLATILITY_LABELS.map(([v]) => v);
const TIER_LABEL = Object.fromEntries(VOLATILITY_LABELS) as Record<Volatility, string>;

/**
 * A compact storage-tier badge ("type": Permanent/Temporary/One-time) that
 * CYCLES on click. `data-tier` drives its colour. getValue() returns the current
 * tier; setValue re-seeds it.
 */
export function buildTierBadge(current: Volatility): {
  element: HTMLButtonElement;
  getValue: () => Volatility;
  setValue: (v: Volatility) => void;
} {
  let value = current;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "vof-tier-badge";
  badge.title =
    "Where this value is saved (click to change) — Permanent: your vault; Temporary: this session, reused across sites; One-time: not saved";
  const render = (): void => {
    badge.textContent = TIER_LABEL[value];
    badge.dataset.tier = value;
  };
  render();
  badge.addEventListener("click", () => {
    value = TIER_ORDER[(TIER_ORDER.indexOf(value) + 1) % TIER_ORDER.length]!;
    render();
  });
  return { element: badge, getValue: () => value, setValue: (v) => { value = v; render(); } };
}

let comboboxSeq = 0;

/**
 * A value text input with a native suggestions dropdown (datalist) of a label's
 * saved variants (personal / work). Picking or typing a value that matches a
 * variant selects it; editing a value keeps the currently-selected variant (so
 * persist upserts that variant). getVariant() returns the selected variant name.
 */
export function buildVariantCombobox(
  variants: { variant?: string; value: string }[],
  currentValue: string,
  currentVariant: string | undefined,
): { element: HTMLElement; getValue: () => string; getVariant: () => string | undefined } {
  const wrap = document.createElement("span");
  wrap.className = "vof-combo";
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentValue;
  const listId = `vof-variants-${comboboxSeq++}`;
  input.setAttribute("list", listId);
  const list = document.createElement("datalist");
  list.id = listId;
  for (const v of variants) {
    const option = document.createElement("option");
    option.value = v.value;
    option.label = v.variant || "default"; // shown as the suggestion's hint
    list.appendChild(option);
  }
  wrap.append(input, list);

  let selected = currentVariant; // the variant the current value represents
  input.addEventListener("input", () => {
    const match = variants.find((v) => v.value === input.value);
    if (match) selected = match.variant; // picked/typed an existing variant's value
  });
  return {
    element: wrap,
    getValue: () => input.value,
    getVariant: () => selected,
  };
}

/**
 * A "⋮" trigger plus a popover panel the caller fills with per-row actions (save
 * a new variant, include/exclude). Opens on click, closes on outside-click or
 * Escape.
 */
export function buildRowMenu(): { trigger: HTMLButtonElement; panel: HTMLDivElement } {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "vof-menu-btn";
  trigger.textContent = "⋮";
  trigger.title = "More options";
  const panel = document.createElement("div");
  panel.className = "vof-menu";

  const onOutside = (e: Event): void => {
    if (!panel.contains(e.target as Node) && e.target !== trigger) close();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
  function close(): void {
    panel.classList.remove("open");
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("keydown", onKey);
  }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.classList.contains("open")) return close();
    panel.classList.add("open");
    document.addEventListener("click", onOutside, true);
    document.addEventListener("keydown", onKey);
  });
  return { trigger, panel };
}

/** A titled section for the row menu: a small muted heading above its content. */
export function buildMenuSection(title: string): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "vof-menu-section";
  const heading = document.createElement("div");
  heading.className = "vof-menu-heading";
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

export interface BuiltControl {
  element: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
}

// Input types worth mirroring in the review (give a date/email picker); anything
// else (text, password, search, …) falls back to a plain text box so the value
// stays visible and editable. NOTE: "number" is deliberately NOT here — a
// type="number" control silently blanks any value its parser rejects (a comma
// decimal, whitespace, formatting), which hid values in the review even when the
// same string filled the page fine. Numeric fields render as text with a numeric
// input-mode hint instead (see buildControl), so the value always shows.
const MIRRORED_INPUT_TYPES = new Set(["date", "datetime-local", "month", "week", "time", "email", "tel", "url"]);

function mirroredInputType(type: string | undefined): string {
  return type && MIRRORED_INPUT_TYPES.has(type) ? type : "text";
}

/**
 * Build the review control that mirrors the page field: a `<select>` with the
 * same options, a typed `<input>` (date/number/…), or a `<textarea>`; otherwise
 * a text input. `value` seeds it (for a select, matched by option value then by
 * label, injected if neither matches so the intended value is still shown).
 * Returns the element plus a getValue() the caller reads on submit.
 */
export function buildControl(
  control: FieldControl | undefined,
  value: string,
  opts: { disabled?: boolean; placeholder?: string } = {},
): BuiltControl {
  if (control?.tag === "select") {
    const select = document.createElement("select");
    for (const o of control.options ?? []) {
      const option = document.createElement("option");
      option.value = o.value;
      option.textContent = o.label;
      select.appendChild(option);
    }
    selectValue(select, value);
    if (opts.disabled) select.disabled = true;
    return { element: select, getValue: () => select.value, setValue: (v) => selectValue(select, v) };
  }

  if (control?.tag === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    if (opts.disabled) textarea.disabled = true;
    if (opts.placeholder) textarea.placeholder = opts.placeholder;
    return { element: textarea, getValue: () => textarea.value, setValue: (v) => { textarea.value = v; } };
  }

  if (control?.tag === "radio" || control?.tag === "checkbox") {
    return buildChoiceGroup(control.tag === "checkbox", control.options ?? [], value, opts.disabled);
  }

  const input = document.createElement("input");
  input.type = mirroredInputType(control?.inputType);
  // Numeric fields are text (see MIRRORED_INPUT_TYPES) but hint a numeric keyboard.
  if (control?.inputType === "number") input.inputMode = "decimal";
  input.value = value;
  if (opts.disabled) input.disabled = true;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  return { element: input, getValue: () => input.value, setValue: (v) => { input.value = v; } };
}

// Unique name per rendered radio group so distinct fields don't share selection
// (radio grouping is by name, form-wide, and the panel has no form).
let choiceGroupSeq = 0;

/**
 * Render a radio (single-select) or checkbox (multi-select) group as real
 * inputs mirroring the page. The seed `value` is a single option value for a
 * radio, or newline-joined values for a checkbox group; getValue() returns the
 * same shape from what's checked.
 */
function buildChoiceGroup(
  multiple: boolean,
  options: FieldOption[],
  value: string,
  disabled?: boolean,
): BuiltControl {
  const norm = (s: string): string => s.trim().toLowerCase();
  const groupName = `vof-choice-${choiceGroupSeq++}`;
  const container = document.createElement("div");
  container.className = "vof-choices";
  // Seed/re-seed by option LABEL then VALUE (case-insensitive): a stored preference
  // holds the human-readable label, a same-site re-seed holds the option value.
  // Each token checks at most ONE option (label preferred) so a token that matches
  // one option's label and another's value can't check both (getValue still
  // returns the checked options' values).
  const check = (items: { input: HTMLInputElement; opt: FieldOption }[], v: string): void => {
    const tokens = (multiple ? v.split("\n") : [v]).map(norm).filter(Boolean);
    for (const { input } of items) input.checked = false;
    for (const t of tokens) {
      const match = items.find(({ opt }) => norm(opt.label) === t) ?? items.find(({ opt }) => norm(opt.value) === t);
      if (match) match.input.checked = true;
    }
  };
  const items: { input: HTMLInputElement; opt: FieldOption }[] = [];
  for (const o of options) {
    const label = document.createElement("label");
    label.className = "vof-choice";
    const input = document.createElement("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = groupName;
    input.value = o.value;
    if (disabled) input.disabled = true;
    items.push({ input, opt: o });
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${o.label}`));
    container.appendChild(label);
  }
  check(items, value);
  return {
    element: container,
    getValue: () => {
      const checked = items.filter(({ input }) => input.checked).map(({ input }) => input.value);
      return multiple ? checked.join("\n") : checked[0] ?? "";
    },
    setValue: (v) => check(items, v),
  };
}

/**
 * Point the select at `value`: by option value, then by visible label, else
 * inject it (best-effort display — the page select may lack that option, so it
 * won't round-trip; the user can pick a real one). For an empty value, ensure a
 * blank option is selected so an unfilled select reads as "" (not silently the
 * first option's value, which the submit path would treat as a chosen value).
 */
function selectValue(select: HTMLSelectElement, value: string): void {
  if (!value) {
    if (![...select.options].some((o) => o.value === "")) {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "— Select —";
      select.insertBefore(blank, select.firstChild);
    }
    select.value = "";
    return;
  }
  select.value = value;
  if (select.value === value) return;
  // Match by visible label — exact first, then case/space-insensitive so a stored
  // preference label (e.g. "King") selects a differently-cased site option.
  const want = value.trim().toLowerCase();
  const byLabel =
    [...select.options].find((o) => o.textContent === value) ??
    [...select.options].find((o) => (o.textContent ?? "").trim().toLowerCase() === want);
  if (byLabel) {
    select.value = byLabel.value;
    return;
  }
  const injected = document.createElement("option");
  injected.value = value;
  injected.textContent = value;
  select.insertBefore(injected, select.firstChild);
  select.value = value;
}
