export interface TabSpec {
  id: string;
  label: string;
}

/**
 * Build an accessible tab bar (WAI-ARIA `tablist` with roving tabindex + arrow-key
 * navigation) and one panel per tab into `container`, returning the panel element
 * for each id so the caller renders content into them. Only the active tab's panel
 * is shown, so a long list in one tab can't push the others off-screen. Built once;
 * callers re-render content into the returned panels without rebuilding the bar.
 */
export function renderTabs(
  container: HTMLElement,
  tabs: TabSpec[],
  opts: { active?: string; idPrefix?: string } = {},
): Record<string, HTMLElement> {
  const prefix = opts.idPrefix ?? "vof-tab";
  const tablist = document.createElement("div");
  tablist.className = "vof-tablist";
  tablist.setAttribute("role", "tablist");

  const panels: Record<string, HTMLElement> = {};
  const buttons: HTMLButtonElement[] = [];

  const select = (id: string): void => {
    tabs.forEach((t, idx) => {
      const active = t.id === id;
      buttons[idx]!.setAttribute("aria-selected", String(active));
      buttons[idx]!.tabIndex = active ? 0 : -1; // roving tabindex: only the active tab is in tab order
      panels[t.id]!.hidden = !active;
    });
  };

  tabs.forEach((t, i) => {
    const tabId = `${prefix}-${t.id}`;
    const panelId = `${tabId}-panel`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vof-tab";
    btn.id = tabId;
    btn.textContent = t.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", panelId);
    btn.addEventListener("click", () => select(t.id));
    btn.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const j = (i + dir + tabs.length) % tabs.length;
      buttons[j]!.focus();
      select(tabs[j]!.id);
    });
    buttons.push(btn);
    tablist.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "vof-tabpanel";
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabId);
    panel.tabIndex = 0; // focusable so a panel with no focusable content is still keyboard-reachable
    panels[t.id] = panel;
  });

  container.appendChild(tablist);
  for (const t of tabs) container.appendChild(panels[t.id]!);

  const active = tabs.some((t) => t.id === opts.active) ? opts.active! : tabs[0]?.id;
  if (active) select(active);
  return panels;
}
