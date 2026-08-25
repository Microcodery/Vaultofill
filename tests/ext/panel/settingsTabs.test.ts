// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderTabs } from "../../../src/ext/panel/settingsTabs";

const TABS = [
  { id: "general", label: "General" },
  { id: "values", label: "Saved values" },
  { id: "learned", label: "Learned fields" },
];

const tabsOf = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

describe("renderTabs", () => {
  it("builds an accessible tablist with a panel per tab, first active by default", () => {
    const c = document.createElement("div");
    const panels = renderTabs(c, TABS);
    expect(c.querySelector('[role="tablist"]')).toBeTruthy();
    const tabs = tabsOf(c);
    expect(tabs.map((t) => t.textContent)).toEqual(["General", "Saved values", "Learned fields"]);
    // First tab active; its panel shown, others hidden; roving tabindex.
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
    expect(panels.general!.hidden).toBe(false);
    expect(panels.values!.hidden).toBe(true);
    // Each tab is associated with its panel both ways.
    expect(tabs[0]!.getAttribute("aria-controls")).toBe(panels.general!.id);
    expect(panels.general!.getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
  });

  it("honors an explicit active tab and falls back to the first for an unknown one", () => {
    const c = document.createElement("div");
    expect(renderTabs(c, TABS, { active: "learned" }).learned!.hidden).toBe(false);

    const c2 = document.createElement("div");
    expect(renderTabs(c2, TABS, { active: "nope" }).general!.hidden).toBe(false);
  });

  it("clicking a tab switches the visible panel and selection", () => {
    const c = document.createElement("div");
    const panels = renderTabs(c, TABS);
    const tabs = tabsOf(c);
    tabs[1]!.click();
    expect(panels.values!.hidden).toBe(false);
    expect(panels.general!.hidden).toBe(true);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[0]!.tabIndex).toBe(-1);
  });

  it("keeps the selected tab across a content re-render into its panel", () => {
    const c = document.createElement("div");
    const panels = renderTabs(c, TABS);
    const tabs = tabsOf(c);
    tabs[1]!.click(); // switch to a non-default tab

    // Simulate the caller re-rendering content into a panel (renderSettings etc.
    // clear via innerHTML=""); the tab bar + hidden state must survive.
    panels.values!.innerHTML = "<span>fresh content</span>";
    expect(panels.values!.hidden).toBe(false);
    expect(panels.general!.hidden).toBe(true);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("arrow keys move selection and focus, wrapping at the ends", () => {
    const c = document.createElement("div");
    document.body.appendChild(c); // attach so focus() / activeElement work
    const panels = renderTabs(c, TABS);
    const tabs = tabsOf(c);

    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);

    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); // wrap first → last
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    expect(panels.learned!.hidden).toBe(false);
    c.remove();
  });
});
