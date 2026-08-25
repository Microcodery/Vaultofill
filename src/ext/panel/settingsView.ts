import type { Detail } from "../../core/types";
import { humanizeLabel } from "../../core/labels/humanize";

/** The vault operations the settings view needs — a subset of Vault, so the
 *  view is unit-testable with a fake. */
export interface VaultLike {
  keys(): string[];
  getVariants(label: string): Detail[];
  set(d: Detail): void;
  removeVariant(label: string, variant: string): void;
  remove(canonicalLabel: string): void;
  addAlias(canonicalLabel: string, alias: string): void;
  removeAlias(canonicalLabel: string, alias: string): void;
}

/** View state kept across the in-place re-renders (structural edits) so a quick
 *  scan isn't disrupted: the search query and which labels are expanded. */
interface SettingsState {
  query: string;
  expanded: Set<string>;
}


let settingsBodySeq = 0;

/** The search-box + filterable-card-list scaffolding shared by both settings
 *  sections. Appends a search input and a list container to `container`, wires
 *  live haystack filtering (persisting the query into `state`), and returns the
 *  list element to append cards into plus `register`/`apply` to index each card
 *  and (re)run the current filter. */
function filterableList(
  container: HTMLElement,
  opts: { placeholder: string; ariaLabel: string },
  state: { query: string },
): { list: HTMLElement; register: (el: HTMLElement, haystack: string) => void; apply: () => void } {
  const search = document.createElement("input");
  search.type = "search";
  search.className = "vof-settings-search";
  search.placeholder = opts.placeholder;
  search.setAttribute("aria-label", opts.ariaLabel);
  search.value = state.query;
  container.appendChild(search);

  const list = document.createElement("div");
  list.className = "vof-settings-list";
  container.appendChild(list);

  const cards: { el: HTMLElement; haystack: string }[] = [];
  const apply = (): void => {
    const q = state.query.trim().toLowerCase();
    for (const { el, haystack } of cards) el.hidden = q !== "" && !haystack.includes(q);
  };
  search.addEventListener("input", () => { state.query = search.value; apply(); });

  return {
    list,
    register: (el, haystack) => cards.push({ el, haystack: haystack.toLowerCase() }),
    apply,
  };
}

function iconButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "vof-icon-btn";
  b.textContent = text;
  b.title = title;
  b.setAttribute("aria-label", title); // the visible glyph isn't a usable accessible name
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Render the editable vault as a compact, scannable list: each saved label shows
 * only its name and default value; clicking a row expands it to edit its
 * value(s)/named variants and its recognized-as aliases. A search box filters by
 * label, value, or alias. Every edit calls `persist()` (the caller saves to
 * storage); structural edits re-render in place, preserving the search + which
 * rows are open. This is where a user fixes a wrong learned mapping — e.g.
 * deleting a "Cumulative GPA" alias that got attached to EMAIL.
 */
export function renderSettings(
  container: HTMLElement,
  vault: VaultLike,
  persist: () => void,
  confirmDelete: (message: string) => boolean = (m) => window.confirm(m),
  state: SettingsState = { query: "", expanded: new Set() },
): void {
  const commit = (): void => persist();
  // Persist + re-render, then restore keyboard focus to a stable anchor so a
  // keyboard/screen-reader user keeps their place: the edited label's expand
  // button (or its add-alias input), falling back to the search box when the row
  // is gone (label deleted).
  const commitAndRerender = (focus?: { label: string; alias?: boolean }): void => {
    persist();
    renderSettings(container, vault, persist, confirmDelete, state);
    if (!focus) return;
    const card = container.querySelector<HTMLElement>(`[data-card-label="${CSS.escape(focus.label)}"]`);
    const target = focus.alias
      ? card?.querySelector<HTMLElement>(".vof-settings-addalias input")
      : card?.querySelector<HTMLElement>(".vof-expand");
    (target ?? container.querySelector<HTMLElement>(".vof-settings-search"))?.focus();
  };

  container.innerHTML = "";

  const labels = vault.keys().sort();
  if (labels.length === 0) {
    const empty = document.createElement("p");
    empty.className = "vof-settings-empty";
    empty.textContent = "No saved values yet — fill a form and they'll appear here.";
    container.appendChild(empty);
    return;
  }

  const { list, register, apply: applyFilter } = filterableList(
    container,
    { placeholder: "Search labels, values, aliases…", ariaLabel: "Search saved values" },
    state,
  );

  for (const label of labels) {
    const variants = vault.getVariants(label);
    const aliases = variants[0]?.aliases ?? []; // the alias list lives on the default variant

    const bodyId = `vof-settings-body-${settingsBodySeq++}`;

    const card = document.createElement("div");
    card.className = "vof-settings-card";
    card.dataset.cardLabel = label; // lets commitAndRerender refocus this card after a re-render

    // Collapsed head: an expand BUTTON (chevron · label · default value) that
    // reveals the details, plus a separate delete button. A real button keeps it
    // keyboard-operable with aria-expanded/aria-controls (not a clickable div).
    const head = document.createElement("div");
    head.className = "vof-settings-head";
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "vof-expand";
    expandBtn.setAttribute("aria-controls", bodyId);
    // No aria-label: let the visible label + value form the accessible name (the
    // chevron is aria-hidden), so screen readers announce the value too.
    const chevron = document.createElement("span");
    chevron.className = "vof-chevron";
    chevron.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "vof-settings-label";
    name.textContent = humanizeLabel(label);
    const preview = document.createElement("span");
    preview.className = "vof-settings-preview";
    preview.textContent = variants[0]?.value ?? "";
    expandBtn.append(chevron, name, preview);
    const del = iconButton("🗑", "Delete this label and all its values", () => {
      if (!confirmDelete(`Delete "${humanizeLabel(label)}" and all its saved values?`)) return;
      vault.remove(label);
      state.expanded.delete(label);
      commitAndRerender({ label }); // row gone → focus falls back to the search box
    });
    head.append(expandBtn, del);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "vof-settings-body";
    body.id = bodyId;

    // Value(s) / named variants.
    for (const detail of variants) {
      const row = document.createElement("div");
      row.className = "vof-settings-variant";
      const vname = document.createElement("span");
      vname.className = "vof-settings-vname";
      vname.textContent = detail.variant || "default";
      const value = document.createElement("input");
      value.type = "text";
      value.className = "vof-settings-value";
      value.setAttribute("aria-label", `${humanizeLabel(label)}${detail.variant ? ` (${detail.variant})` : ""} value`);
      value.value = detail.value;
      value.addEventListener("change", () => {
        vault.set({ ...detail, value: value.value });
        if (detail === variants[0]) preview.textContent = value.value; // keep the collapsed row's preview in sync
        commit(); // no re-render — keep focus/caret
      });
      row.append(vname, value, iconButton("✕", "Delete this value", () => {
        if (!confirmDelete(`Delete the ${humanizeLabel(label)}${detail.variant ? ` (${detail.variant})` : ""} value?`)) return;
        vault.removeVariant(label, detail.variant ?? "");
        commitAndRerender({ label });
      }));
      body.appendChild(row);
    }

    // Aliases (recognized-as phrasings).
    const aliasWrap = document.createElement("div");
    aliasWrap.className = "vof-settings-aliases";
    const sub = document.createElement("div");
    sub.className = "vof-settings-subhead";
    sub.textContent = "Recognized as:";
    aliasWrap.appendChild(sub);
    for (const alias of aliases) {
      const chip = document.createElement("span");
      chip.className = "vof-alias-chip";
      chip.textContent = alias;
      chip.appendChild(iconButton("✕", "Remove this alias", () => {
        if (!confirmDelete(`Remove the recognized phrasing "${alias}"?`)) return;
        vault.removeAlias(label, alias);
        commitAndRerender({ label });
      }));
      aliasWrap.appendChild(chip);
    }
    const addRow = document.createElement("div");
    addRow.className = "vof-settings-addalias";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "add a phrasing…";
    addInput.setAttribute("aria-label", `Add a recognized phrasing for ${humanizeLabel(label)}`);
    const addAlias = (): void => {
      const a = addInput.value.trim();
      if (!a) return;
      vault.addAlias(label, a);
      commitAndRerender({ label, alias: true }); // keep focus in the add box to add another
    };
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", addAlias);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addAlias(); });
    addRow.append(addInput, addBtn);
    aliasWrap.appendChild(addRow);
    body.appendChild(aliasWrap);

    card.appendChild(body);

    const applyExpand = (): void => {
      const open = state.expanded.has(label);
      body.hidden = !open;
      chevron.textContent = open ? "▾" : "▸";
      expandBtn.setAttribute("aria-expanded", open ? "true" : "false");
      card.classList.toggle("expanded", open);
    };
    applyExpand();
    expandBtn.addEventListener("click", () => {
      if (state.expanded.has(label)) state.expanded.delete(label);
      else state.expanded.add(label);
      applyExpand();
    });

    list.appendChild(card);
    register(card, [humanizeLabel(label), label, ...variants.map((v) => v.value), ...aliases].join(" "));
  }

  applyFilter();
}

/** The label-registry operations the view needs — a subset of LabelRegistry, so
 *  the view is unit-testable with a fake. */
export interface RegistryLike {
  entries(): { name: string; aliases: string[] }[];
  remove(name: string): void;
}

/**
 * Render the learned label vocabulary: the labels the model INVENTED for novel
 * fields (kept so it reuses them next site — see LabelRegistry), each with the
 * question phrasings it saw them as. Read-only except for delete: this is where a
 * user prunes a junk invention so it stops being offered to the model. A search
 * box filters; deletes confirm and re-render (preserving the search).
 */
export function renderLabelRegistry(
  container: HTMLElement,
  registry: RegistryLike,
  persist: () => void,
  confirmDelete: (message: string) => boolean = (m) => window.confirm(m),
  state: { query: string } = { query: "" },
): void {
  const rerender = (): void => {
    persist();
    renderLabelRegistry(container, registry, persist, confirmDelete, state);
    // Keep focus in the section: the search box, or the empty-state note once the
    // last label is deleted (so a keyboard/screen-reader user isn't dropped to body).
    container.querySelector<HTMLElement>(".vof-settings-search, .vof-settings-empty")?.focus();
  };

  container.innerHTML = "";

  const entries = registry.entries().sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "vof-settings-empty";
    empty.tabIndex = -1; // focusable target for rerender after the last delete
    empty.textContent = "No learned fields yet — as you fill novel fields the model invents a label for each here, so it reuses the same name next time.";
    container.appendChild(empty);
    return;
  }

  const { list, register, apply: applyFilter } = filterableList(
    container,
    { placeholder: "Search learned fields…", ariaLabel: "Search learned fields" },
    state,
  );

  for (const { name, aliases } of entries) {
    const card = document.createElement("div");
    card.className = "vof-settings-card";
    card.dataset.registryLabel = name;

    const head = document.createElement("div");
    head.className = "vof-settings-head vof-registry-head";
    const nameEl = document.createElement("span");
    nameEl.className = "vof-settings-label";
    nameEl.textContent = humanizeLabel(name);
    const count = document.createElement("span");
    count.className = "vof-settings-preview";
    count.textContent = aliases.length === 1 ? "1 phrasing" : `${aliases.length} phrasings`;
    const del = iconButton("🗑", `Forget the learned label "${humanizeLabel(name)}"`, () => {
      if (!confirmDelete(`Forget the learned label "${humanizeLabel(name)}"? The model may re-learn it next time you fill a matching field.`)) return;
      registry.remove(name);
      rerender();
    });
    head.append(nameEl, count, del);
    card.appendChild(head);

    // The question phrasings this label was seen as — read-only.
    if (aliases.length) {
      const wrap = document.createElement("div");
      wrap.className = "vof-settings-aliases vof-registry-phrasings";
      for (const alias of aliases) {
        const chip = document.createElement("span");
        chip.className = "vof-alias-chip";
        chip.textContent = alias;
        wrap.appendChild(chip);
      }
      card.appendChild(wrap);
    }

    list.appendChild(card);
    register(card, [humanizeLabel(name), name, ...aliases].join(" "));
  }

  applyFilter();
}
